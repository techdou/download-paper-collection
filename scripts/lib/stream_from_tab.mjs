// stream_from_tab.mjs — 通用浏览器内 PDF 流式下载模块
//
// 在已授权的浏览器标签页上下文中 fetch PDF URL，用 ReadableStream 分块读取，
// 每块约 96KB 转 base64 回传 Node 端写盘。解决 CDP/Runtime.evaluate 对大二进制
// 响应的超时问题——整块 arrayBuffer() 会让 CDP 超时，分块则稳定。
//
// 依赖：kimi-webbridge daemon (默认 http://127.0.0.1:10086)
//
// 用法（CLI）:
//   node stream_from_tab.mjs \
//     --pdf-url "https://proxy/stampPDF/getPDF.jsp?arnumber=12345" \
//     --out "/path/to/paper.pdf" \
//     --session "paper-download" \
//     --reader-prefix "ieee"
//
// 用法（import）:
//   import { streamPdf, createCommand } from './stream_from_tab.mjs'
//   const cmd = createCommand({ daemon: 'http://127.0.0.1:10086', session: 'my-task' })
//   const { bytes, sha256 } = await streamPdf(cmd, {
//     pdfUrl: 'https://...',
//     outFile: '/path/to/paper.pdf',
//     readerPrefix: 'myTask',
//   })

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 分块大小：98304 字节 (96KB)。
 *  为什么是这个值：太大（>128KB）时 base64 编码后单次 evaluate 响应可能超 CDP 限制；
 *  太小（<32KB）时轮询次数过多、网络开销大。96KB 是实测稳定值。 */
const CHUNK_LIMIT = 98304;

/** fromCharCode 批量上限：0x8000 (32768)。
 *  超过此值时 String.fromCharCode.apply 会栈溢出，需分批拼接。 */
const FROM_CHAR_BATCH = 0x8000;

/**
 * 创建 WebBridge command 函数
 * @param {{daemon?: string, session: string}} opts
 * @returns {(action: string, args?: object, timeoutMs?: number) => Promise<any>}
 */
export function createCommand({ daemon = 'http://127.0.0.1:10086', session }) {
  const base = daemon.replace(/\/$/, '');
  return async function command(action, args = {}, timeoutMs = 120000) {
    const response = await fetch(`${base}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, args, session }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(`${action} failed: ${JSON.stringify(data).slice(0, 500)}`);
    }
    return data.data;
  };
}

/**
 * 在浏览器标签页上下文中流式下载 PDF
 *
 * @param {function} command - createCommand 返回的函数
 * @param {{
 *   pdfUrl: string,          // 要 fetch 的 PDF URL
 *   outFile: string,          // 本地保存路径
 *   readerPrefix?: string,    // window 变量前缀，避免多任务冲突（默认 'paperStream'）
 *   credentials?: string,     // fetch credentials 模式（默认 'include'）
 * }} opts
 * @returns {Promise<{bytes: number, sha256: string}>}
 * @throws {Error} not_pdf_response | invalid_pdf_signature | pdf_stream_stalled
 */
export async function streamPdf(command, opts) {
  const { pdfUrl, outFile } = opts;
  const prefix = opts.readerPrefix || 'paperStream';
  const credentials = opts.credentials || 'include';

  // 1. 启动 fetch，保存 reader 到 window 上下文
  const initCode = `(async () => {
    if (window.__${prefix}Reader) { try { await window.__${prefix}Reader.cancel(); } catch(e){} }
    const response = await fetch(${JSON.stringify(pdfUrl)}, { credentials: ${JSON.stringify(credentials)} });
    window.__${prefix}Reader = response.body?.getReader();
    window.__${prefix}Pending = new Uint8Array(0);
    window.__${prefix}Done = false;
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      url: response.url
    });
  })()`;

  const initData = await command('evaluate', { code: initCode }, 120000);
  const meta = JSON.parse(initData.value || '{}');

  if (!meta.ok || !String(meta.contentType).toLowerCase().includes('pdf')) {
    throw new Error(`not_pdf_response:${JSON.stringify(meta)}`);
  }

  // 2. 循环读取分块
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  const temp = `${outFile}.part`;
  const output = fs.createWriteStream(temp);
  let total = 0;

  try {
    while (true) {
      const readCode = `(async () => {
        const limit = ${CHUNK_LIMIT};
        let pending = window.__${prefix}Pending || new Uint8Array(0);
        while (pending.length < limit && !window.__${prefix}Done) {
          const next = await window.__${prefix}Reader.read();
          if (next.done) { window.__${prefix}Done = true; break; }
          const joined = new Uint8Array(pending.length + next.value.length);
          joined.set(pending, 0);
          joined.set(next.value, pending.length);
          pending = joined;
        }
        const send = pending.subarray(0, Math.min(limit, pending.length));
        window.__${prefix}Pending = pending.subarray(send.length);
        let binary = '';
        for (let i = 0; i < send.length; i += ${FROM_CHAR_BATCH}) {
          binary += String.fromCharCode.apply(null, send.subarray(i, i + ${FROM_CHAR_BATCH}));
        }
        return JSON.stringify({
          done: window.__${prefix}Done && window.__${prefix}Pending.length === 0,
          bytes: send.length,
          value: btoa(binary)
        });
      })()`;

      const part = await command('evaluate', { code: readCode }, 120000);
      const chunk = JSON.parse(part.value || '{}');

      if (chunk.bytes) {
        const bytes = Buffer.from(chunk.value, 'base64');
        output.write(bytes);
        total += bytes.length;
        // 每 1MB 打一次进度到 stderr
        if (total % (1024 * 1024) < bytes.length) {
          process.stderr.write(`streamed ${total} bytes\n`);
        }
      }
      if (chunk.done) break;
      if (!chunk.bytes) throw new Error('pdf_stream_stalled');
    }

    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on('error', reject);
    });

    // 3. 验证 PDF 签名
    const buf = fs.readFileSync(temp);
    const signature = buf.subarray(0, 8).toString('ascii');
    if (!signature.startsWith('%PDF')) {
      throw new Error(`invalid_pdf_signature: ${JSON.stringify(signature)}`);
    }

    // 4. 原子重命名
    fs.renameSync(temp, outFile);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    return { bytes: buf.length, sha256 };

  } catch (error) {
    output.destroy();
    throw error;
  } finally {
    // 5. 清理 window 上下文中的 reader 变量
    const cleanupCode = `(() => {
      try { window.__${prefix}Reader?.cancel(); } catch {}
      delete window.__${prefix}Reader;
      delete window.__${prefix}Pending;
      delete window.__${prefix}Done;
      return true;
    })()`;
    await command('evaluate', { code: cleanupCode }, 10000).catch(() => {});
  }
}

// ===== CLI 入口 =====
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file:///', '/'))) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
  }
  if (!args.pdfUrl || !args.out) {
    console.error('usage: node stream_from_tab.mjs --pdf-url URL --out FILE [--daemon URL] [--session NAME] [--reader-prefix PREFIX]');
    process.exit(2);
  }
  const command = createCommand({
    daemon: args.daemon || 'http://127.0.0.1:10086',
    session: args.session || 'paper-download',
  });
  // 先找到或导航到授权标签页
  if (args.tabUrl) {
    await command('find_tab', { url: args.tabUrl, active: false }, 30000).catch(() => {});
  }
  const result = await streamPdf(command, {
    pdfUrl: args.pdfUrl,
    outFile: args.out,
    readerPrefix: args.readerPrefix || 'cli',
  });
  console.log(JSON.stringify({ out: path.resolve(args.out), ...result }, null, 2));
}
