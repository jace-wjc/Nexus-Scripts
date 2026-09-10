import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import loadTypeScript from '../../../tests/load-typescript.mjs';

test('runtime logos, old bundled logos and deletion markers preserve the URL contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-logo-test-'));
  try {
    const runtime = path.join(root, 'runtime');
    const legacy = path.join(root, 'public');
    for (const directory of [runtime, legacy]) fs.mkdirSync(path.join(directory, 'team-logos'), { recursive: true });
    const paths = loadTypeScript(new URL('./resourceLogoPaths.ts', import.meta.url), { 'node:path': { default: path } }, {
      process: { env: { RESOURCE_LOGO_ROOT: runtime }, cwd: () => root },
    });
    const read = loadTypeScript(new URL('../../app/api/resource-logos/[kind]/[filename]/route.ts', import.meta.url), {
      'node:fs/promises': fsp, 'node:path': { default: path }, '@/lib/server/resourceLogoPaths': paths,
    });
    const get = (filename, kind = 'team-logos') => read.GET(new Request('http://local.invalid'), { params: Promise.resolve({ kind, filename }) });
    fs.writeFileSync(path.join(legacy, 'team-logos', 'group.webp'), 'legacy-synthetic');
    assert.equal(await (await get('group.webp')).text(), 'legacy-synthetic');
    fs.writeFileSync(path.join(runtime, 'team-logos', 'group.webp'), 'runtime-synthetic');
    const updated = await get('group.webp');
    assert.equal(await updated.text(), 'runtime-synthetic');
    assert.equal(updated.headers.get('content-type'), 'image/webp');
    assert.equal(updated.headers.get('x-content-type-options'), 'nosniff');
    const writes = loadTypeScript(new URL('../../app/api/team-resources/logo/route.ts', import.meta.url), {
      'next/server': { NextResponse: Response }, fs: { default: fs }, path: { default: path },
      sharp: { default: () => ({ webp: () => ({ toFile: async filename => fs.writeFileSync(filename, 'new-synthetic') }) }) },
      '@/lib/server/scriptHubSession': { requireFreshScriptHubPermission: async () => ({ session: {} }) },
      '@/lib/server/resourceLogoPaths': paths,
    });
    assert.equal((await writes.DELETE(new Request('http://local.invalid?groupId=group'))).status, 200);
    assert.equal((await get('group.webp')).status, 404);
    assert.equal(fs.readFileSync(path.join(legacy, 'team-logos', 'group.webp'), 'utf8'), 'legacy-synthetic');
    assert.equal((await writes.POST(new Request('http://local.invalid', { method: 'POST', body: JSON.stringify({ groupId: 'group', base64: 'data:image/png;base64,c3lu' }) }))).status, 200);
    assert.equal(await (await get('group.webp')).text(), 'new-synthetic');
    assert.equal((await get('../group.webp')).status, 404);
    assert.equal((await get('group.html')).status, 404);
    assert.equal((await get('group.webp', 'data')).status, 404);
    assert.equal((await get('missing.png')).status, 404);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
