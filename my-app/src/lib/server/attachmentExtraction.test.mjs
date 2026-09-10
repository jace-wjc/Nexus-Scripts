import assert from 'node:assert/strict';
import test from 'node:test';
import loadTypeScript from '../../../tests/load-typescript.mjs';

const routeFile = new URL('../../app/api/extract-file/route.ts', import.meta.url);
function route(Parser, allowed = true) {
  return loadTypeScript(routeFile, {
    'next/server': { NextResponse: Response },
    '@/lib/server/scriptHubSession': { requireFreshScriptHubPermission: async () => allowed ? { session: {} } : { response: new Response(null, { status: 403 }) } },
    mammoth: { default: { extractRawText: async () => ({ value: 'docx-preserved' }) } },
    xlsx: { read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }), utils: { sheet_to_csv: () => 'xlsx-preserved' } },
    'pdf-parse': { PDFParse: Parser },
  }, { File });
}
function request(name, content = 'synthetic') {
  const form = new FormData(); form.set('file', new File([content], name));
  return new Request('http://local.invalid/api/extract-file', { method: 'POST', body: form });
}

test('PDF v2 extracts and destroys on success and failure without exposing parser details', async () => {
  for (const fail of [false, true]) {
    let destroyed = 0;
    class Parser {
      constructor(options) { assert.equal(options.data.toString(), 'synthetic'); }
      async getText() { if (fail) throw new Error('private-document-marker'); return { text: 'pdf-preserved' }; }
      async destroy() { destroyed++; }
    }
    const response = await route(Parser).POST(request('test.pdf'));
    assert.equal(response.status, fail ? 500 : 200);
    assert.equal(destroyed, 1);
    assert.doesNotMatch(await response.text(), /private-document-marker/);
  }
});

test('existing text/docx/xlsx and truncation contracts are preserved', async () => {
  for (const [name, content, expected] of [['a.txt','plain','plain'], ['a.docx','mock','docx-preserved'], ['a.xlsx','mock','xlsx-preserved\n']]) {
    assert.equal((await (await route().POST(request(name, content))).json()).text, expected);
  }
  const result = await (await route().POST(request('long.txt', 'x'.repeat(100001)))).json();
  assert.ok(result.text.startsWith('x'.repeat(100000) + '\n\n'));
  assert.equal(result.text.split('\n')[0].length, 100000);
});

test('permission, invalid form entry and size checks precede parsing', async () => {
  class Parser { constructor() { assert.fail('must not parse'); } }
  assert.equal((await route(Parser, false).POST(request('test.pdf'))).status, 403);
  const bad = new FormData(); bad.set('file', 'not-a-file');
  assert.equal((await route(Parser).POST(new Request('http://local.invalid', { method: 'POST', body: bad }))).status, 400);
  const large = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.pdf');
  const response = await route(Parser).POST({ formData: async () => new Map([['file', large]]) });
  assert.equal(response.status, 413);
});
