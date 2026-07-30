#!/usr/bin/env node
// institutional_proxy_batch.mjs — 机构代理批处理下载编排
//
// 从 JSON 队列文件串行下载论文，通过 WebBridge 控制已登录机构代理的浏览器标签页，
// 在授权页面上下文中 fetch PDF。含断点续传、挑战检测、深度校验、隔离区、manifest。
//
// 依赖：
//   - kimi-webbridge daemon (http://127.0.0.1:10086)
//   - stream_from_tab.mjs (同目录 lib/)
//   - challenge_detect.mjs (同目录 lib/)
//   - validate_pdf_deep.py (同目录 scripts/)
//   - poppler-utils (pdfinfo, pdftotext)
//
// 队列 JSON 格式（每条记录）:
//   {
//     "title": "[EN] Some Title [中文] 某标题",
//     "doi": "10.xxx/yyy",
//     "article_url": "https://proxy.example.com/document/12345",
//     "pdf_url": "https://proxy.example.com/stampPDF/getPDF.jsp?arnumber=12345",
//     "archive_path": "/output/dir/Some Title.pdf"
//   }
//
// CLI:
//   node institutional_proxy_batch.mjs \
//     --queue queue.json \
//     --session "paper-ieee" \
//     --limit 8 \
//     --delay-min 8000 --delay-max 12000 \
//     --validate-script ../validate_pdf_deep.py \
//     --log-dir ./logs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createCommand, streamPdf } from './lib/stream_from_tab.mjs';
import { checkCurrentPage, isUnexpectedNavigation } from './lib/challenge_detect.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].slice(2);
      const val = process.argv[++i];
      args[key] = isNaN(val) ? val : parseInt(val, 10);
    }
  }
  // 默认值
  args.daemon = args.daemon || 'http://127.0.0.1:10086';
  args.session = args.session || 'institutional-proxy';
  args.limit = args.limit || 999;
  args.delayMin = args['delay-min'] || 8000;
  args.delayMax = args['delay-max'] || 12000;
  args.groupTitle = args['group-title'] || '机构代理论文下载';
  args.validateScript = args['validate-script'] ||
    path.join(__dirname, 'validate_pdf_deep.py');
  args.logDir = args['log-dir'] || path.join(process.cwd(), 'logs');
  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function now() {
  return new Date().toISOString();
}

function safeFilename(s) {
  return s.replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function writeRecord(logPath, manifestPath, record) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
  // 原子更新 manifest JSON 快照
  const latest = new Map();
  const key = record.doi || record.title;
  for (const item of readLog(logPath)) {
    latest.set(item.doi || item.title, item);
  }
  const tmp = manifestPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...latest.values()], null, 2), 'utf8');
  fs.renameSync(tmp, manifestPath);
}

function validatePdf(validateScript, pdfPath, title, doi) {
  const run = spawnSync('python', [
    validateScript, '--pdf', pdfPath, '--title', title, '--doi', doi || '',
  ], { encoding: 'utf8', timeout: 180000, windowsHide: true });

  const lines = (run.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  let result = null;
  try { result = JSON.parse(lines.at(-1) || '{}'); } catch {}
  return {
    ok: run.status === 0 && Boolean(result?.valid),
    result,
    stderr: (run.stderr || '').trim().slice(0, 2000),
  };
}

async function main() {
  const args = parseArgs();

  if (!args.queue) {
    console.error('用法: node institutional_proxy_batch.mjs --queue QUEUE.json [选项]');
    console.error('');
    console.error('必需:');
    console.error('  --queue PATH         队列 JSON 文件路径');
    console.error('');
    console.error('可选:');
    console.error('  --daemon URL         WebBridge daemon 地址 (默认 http://127.0.0.1:10086)');
    console.error('  --session NAME       会话名称 (默认 institutional-proxy)');
    console.error('  --limit N            本次最多处理 N 条 (默认无限制)');
    console.error('  --delay-min MS       篇间最小延迟 (默认 8000)');
    console.error('  --delay-max MS       篇间最大延迟 (默认 12000)');
    console.error('  --validate-script P  validate_pdf_deep.py 路径');
    console.error('  --log-dir DIR        日志和 manifest 输出目录 (默认 ./logs)');
    console.error('  --group-title TXT    浏览器标签组标题');
    process.exit(2);
  }

  const queue = JSON.parse(fs.readFileSync(args.queue, 'utf8'));
  const logPath = path.join(args.logDir, '下载日志.jsonl');
  const manifestPath = path.join(args.logDir, '下载清单.json');
  fs.mkdirSync(args.logDir, { recursive: true });

  const command = createCommand({ daemon: args.daemon, session: args.session });

  // 断点续传：读取已成功记录
  const prior = readLog(logPath);
  const successful = new Set(prior
    .filter(x => x.status === 'downloaded_verified')
    .map(x => x.doi || x.title));

  let attempted = 0;
  let stopReason = '';
  let openedFirst = false;

  for (const item of queue) {
    if (attempted >= args.limit) break;
    if (stopReason) break;

    const itemKey = item.doi || item.title;
    if (successful.has(itemKey)) continue;

    // 已有归档文件则跳过
    if (item.archive_path && fs.existsSync(item.archive_path)) {
      const existing = validatePdf(args.validateScript, item.archive_path, item.title, item.doi);
      if (existing.ok) {
        writeRecord(logPath, manifestPath, {
          ...item, status: 'downloaded_verified', source: 'existing_archive',
          validation: existing.result, recorded_at: now(),
        });
        successful.add(itemKey);
        continue;
      }
    }

    attempted++;
    let opened = false;

    try {
      // 1. 导航到文章页（授权）
      console.log(`[${attempted}] ${itemKey} navigating...`);
      await command('navigate', {
        url: item.article_url,
        newTab: !openedFirst,
        group_title: openedFirst ? undefined : args.groupTitle,
      }, 120000);
      openedFirst = true;
      opened = true;
      await sleep(3000);

      // 2. 安全挑战检测
      const challenge = await checkCurrentPage(command);
      if (challenge.detected) {
        stopReason = `security_challenge:${challenge.type}`;
        console.error(`  CHALLENGE: ${challenge.type} (${challenge.matchedKeyword})`);
        writeRecord(logPath, manifestPath, {
          ...item, status: 'security_challenge',
          challenge_type: challenge.type,
          page: challenge.page,
          recorded_at: now(),
        });
        break; // 遇挑战即停整个批次
      }

      // 3. 意外导航检测
      if (item.url_fragment && isUnexpectedNavigation(challenge.page?.url, item.url_fragment)) {
        console.error(`  unexpected navigation`);
        writeRecord(logPath, manifestPath, {
          ...item, status: 'unexpected_navigation',
          page: challenge.page, recorded_at: now(),
        });
        continue;
      }

      // 4. 流式下载 PDF
      const tempPath = item.temp_path || (item.archive_path + '.part');
      const readerPrefix = `batch${attempted}`;
      const { bytes, sha256 } = await streamPdf(command, {
        pdfUrl: item.pdf_url,
        outFile: tempPath,
        readerPrefix,
      });
      console.log(`  downloaded ${bytes} bytes`);

      // 5. 深度校验
      const checked = validatePdf(args.validateScript, tempPath, item.title, item.doi);
      if (!checked.ok) {
        // 校验失败 → 隔离区
        const quarantineDir = path.join(path.dirname(item.archive_path || tempPath), '_quarantine', 'validation_failed');
        fs.mkdirSync(quarantineDir, { recursive: true });
        const quarantinePath = path.join(quarantineDir, path.basename(tempPath));
        fs.renameSync(tempPath, quarantinePath);
        writeRecord(logPath, manifestPath, {
          ...item, status: 'validation_failed',
          quarantine: quarantinePath,
          validation: checked.result,
          stderr: checked.stderr,
          recorded_at: now(),
        });
        console.error(`  validation failed: ${JSON.stringify(checked.result?.errors)}`);
        continue;
      }

      // 6. 归档
      if (item.archive_path) {
        fs.mkdirSync(path.dirname(item.archive_path), { recursive: true });
        if (fs.existsSync(item.archive_path)) {
          fs.copyFileSync(tempPath, item.archive_path);
        } else {
          fs.renameSync(tempPath, item.archive_path);
        }
        // 归档后二次校验
        const archived = validatePdf(args.validateScript, item.archive_path, item.title, item.doi);
        if (!archived.ok) {
          throw new Error(`archive_validation_failed:${JSON.stringify(archived.result?.errors)}`);
        }
        writeRecord(logPath, manifestPath, {
          ...item, status: 'downloaded_verified',
          transfer: { bytes, sha256 },
          validation: archived.result,
          recorded_at: now(),
        });
        successful.add(itemKey);
        console.log(`  verified: ${archived.result.pages} pages`);
      } else {
        writeRecord(logPath, manifestPath, {
          ...item, status: 'downloaded_verified',
          transfer: { bytes, sha256 },
          validation: checked.result,
          recorded_at: now(),
        });
        successful.add(itemKey);
      }

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      writeRecord(logPath, manifestPath, {
        ...item, status: 'download_failed',
        error: String(error.message).slice(0, 2000),
        recorded_at: now(),
      });
    } finally {
      if (opened) {
        await command('close_tab', {}, 30000).catch(() => {});
      }
    }

    // 篇间随机延迟
    if (attempted < args.limit && !stopReason) {
      const delay = args.delayMin + Math.floor(Math.random() * (args.delayMax - args.delayMin + 1));
      await sleep(delay);
    }
  }

  // 汇总
  const finalLog = readLog(logPath);
  const byStatus = {};
  for (const r of finalLog) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  console.log('\n=== SUMMARY ===');
  console.log(`attempted: ${attempted}`);
  console.log(`successful total: ${successful.size}`);
  console.log(`stop reason: ${stopReason || 'none'}`);
  console.log(`status breakdown: ${JSON.stringify(byStatus)}`);
  if (stopReason) {
    console.error(`\n批次因 ${stopReason} 提前停止。请在浏览器中处理安全挑战后重试。`);
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
