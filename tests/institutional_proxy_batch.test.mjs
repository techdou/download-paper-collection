import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBatch } from '../scripts/institutional_proxy_batch.mjs';

const PDF = Buffer.from('%PDF-1.7\nfixture\n%%EOF\n');

async function runScenario(t, validator, { existing = false, limit = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-batch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, 'archive', 'paper.pdf');
  const temp = path.join(root, 'paper.part');
  const logDir = path.join(root, 'logs');
  const queue = path.join(root, 'queue.json');
  const validateScript = path.join(root, 'validator.py');
  const item = {
    title: 'Fixture 论文', archive_path: archive, temp_path: temp,
    article_url: 'https://example.invalid/article', pdf_url: 'https://example.invalid/paper.pdf',
  };
  fs.writeFileSync(queue, JSON.stringify([item, { ...item, title: 'Next item' }]));
  fs.writeFileSync(validateScript, validator);
  if (existing) {
    fs.mkdirSync(path.dirname(archive));
    fs.writeFileSync(archive, PDF);
  }

  const calls = [];
  // Exercise the real streaming and archive logic without opening a socket.
  const command = async (action, args) => {
    calls.push(action);
    if (action !== 'evaluate') return {};
    const code = args.code;
    let payload;
    if (code.includes('location.href')) payload = { url: item.article_url, body: 'Abstract' };
    else if (code.includes('await fetch(')) payload = { ok: true, contentType: 'application/pdf' };
    else if (code.includes('btoa(binary)')) payload = { done: true, bytes: PDF.length, value: PDF.toString('base64') };
    else if (code.includes('delete window.')) payload = true;
    else assert.fail('unexpected WebBridge command');
    return { value: JSON.stringify(payload) };
  };
  const code = await runBatch({ queue, logDir, validateScript, limit }, { command, wait: async () => {} });
  const manifest = JSON.parse(fs.readFileSync(path.join(logDir, '下载清单.json'), 'utf8'));
  return { code, archive, temp, manifest, calls, quarantine: path.join(path.dirname(archive), '_quarantine') };
}

test('multiline UTF-8 success JSON archives the downloaded PDF', async t => {
  const r = await runScenario(t, `import json\nprint(json.dumps({"valid": True, "pages": 4, "title": "论文"}, ensure_ascii=False, indent=2))`);
  assert.equal(r.code, 0);
  assert.equal(r.manifest[0].status, 'downloaded_verified');
  assert.equal(r.manifest[0].validation.title, '论文');
  assert.deepEqual(fs.readFileSync(r.archive), PDF);
  assert.equal(fs.existsSync(r.temp), false);
  assert.equal(fs.existsSync(r.quarantine), false);
});

test('a valid failure response quarantines the downloaded PDF', async t => {
  const r = await runScenario(t, `print('{"valid":false,"errors":["title_mismatch"]}')\nraise SystemExit(2)`);
  assert.equal(r.code, 0);
  assert.equal(r.manifest[0].status, 'validation_failed');
  assert.deepEqual(r.manifest[0].validation.errors, ['title_mismatch']);
  assert.deepEqual(fs.readFileSync(r.manifest[0].quarantine), PDF);
  assert.equal(fs.existsSync(r.archive), false);
  assert.equal(fs.existsSync(r.temp), false);
});

test('malformed validator output stops without quarantining the staged PDF', async t => {
  const r = await runScenario(t, `print('invalid output')\nraise SystemExit(2)`, { limit: 2 });
  assert.equal(r.code, 1);
  assert.equal(r.manifest.length, 1);
  assert.equal(r.manifest[0].status, 'validator_protocol_error');
  assert.match(r.manifest[0].error, /stdout is not JSON/);
  assert.deepEqual(fs.readFileSync(r.temp), PDF);
  assert.equal(fs.existsSync(r.archive), false);
  assert.equal(fs.existsSync(r.quarantine), false);
  assert.equal(r.calls.at(-1), 'close_tab');
});

test('a protocol error during the second validation leaves the archive intact', async t => {
  const r = await runScenario(t, `
import sys
if sys.argv[2].endswith('.part'):
    print('{"valid":true}')
else:
    print('not JSON')
`);
  assert.equal(r.code, 1);
  assert.equal(r.manifest[0].status, 'validator_protocol_error');
  assert.deepEqual(fs.readFileSync(r.archive), PDF);
  assert.equal(fs.existsSync(r.quarantine), false);
});

test('a mismatched exit/validity for an existing archive stops before navigation', async t => {
  const r = await runScenario(t, `print('{"valid":false}')`, { existing: true });
  assert.equal(r.code, 1);
  assert.equal(r.manifest.length, 1);
  assert.equal(r.manifest[0].status, 'validator_protocol_error');
  assert.match(r.manifest[0].error, /validity flag does not match/);
  assert.deepEqual(fs.readFileSync(r.archive), PDF);
  assert.equal(fs.existsSync(r.quarantine), false);
  assert.deepEqual(r.calls, []);
});
