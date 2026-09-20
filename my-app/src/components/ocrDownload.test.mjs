import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import loadTypeScript from '../../tests/load-typescript.mjs';

const file = new URL('./OCRScript.tsx', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let functionSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleDownload') functionSource = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(functionSource);
function harness(downloadUrl, status = 200) {
  const events = [];
  class DownloadURL extends URL {
    static createObjectURL(blob) { events.push(['blob', blob.size]); return 'blob:synthetic'; }
    static revokeObjectURL(url) { events.push(['revoke', url]); }
  }
  const anchor = { click() { events.push(['click', this.download]); }, remove() { events.push(['remove']); } };
  const { run } = loadTypeScript(file, {}, {
    downloadUrl, downloading: false, setDownloading: value => events.push(['loading', value]),
    getApiBaseUrl: () => '/api', URL: DownloadURL,
    window: { location: { href: 'http://localhost:3000/' }, setTimeout: callback => callback() },
    authenticatedFetch: async (url, init) => { events.push(['fetch', url, init.cache]); return new Response('synthetic', { status }); },
    document: { createElement: () => anchor, body: { appendChild() {} } },
    toast: { error: message => events.push(['error', message]) },
    ocr: { messages: { downloadForbidden: 'forbidden', downloadFailed: 'failed' } },
  }, `export const run = ${functionSource};`);
  return { run, events };
}

test('OCR downloads use authenticated fetch and release blob resources', async () => {
  const h = harness('/api/outputs/synthetic.xlsx');
  await h.run();
  assert.deepEqual(h.events, [['loading', true], ['fetch', 'http://localhost:3000/api/outputs/synthetic.xlsx', 'no-store'],
    ['blob', 9], ['click', 'synthetic.xlsx'], ['remove'], ['revoke', 'blob:synthetic'], ['loading', false]]);
});

test('forbidden or external result URLs never create a download', async () => {
  for (const [url, status, error] of [['/api/outputs/synthetic.xlsx', 403, 'forbidden'], ['https://example.invalid/outputs/file.xlsx', 200, 'failed']]) {
    const h = harness(url, status);
    await h.run();
    assert.ok(h.events.some(event => event[0] === 'error' && event[1] === error));
    assert.ok(!h.events.some(event => event[0] === 'click'));
    if (status === 200) assert.ok(!h.events.some(event => event[0] === 'fetch'));
  }
});
