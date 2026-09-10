import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import loadTypeScript from '../../../tests/load-typescript.mjs';

test('development version does not advertise an old production artifact', async () => {
  const route = loadTypeScript(new URL('../../app/api/system/version/route.ts', import.meta.url), {
    'node:fs/promises': { readFile: () => assert.fail('must not read old build-info.json in development') },
    'node:path': path,
    'next/server': { NextResponse: Response },
    '@/lib/system-version': { parseSystemBuildInfo: value => value },
  }, { process: { env: { NODE_ENV: 'development', NEXT_PUBLIC_BUILD_ID: 'dev' } } });
  const response = await route.GET(new Request('http://local.invalid/api/system/version'));
  const value = await response.json();
  assert.equal(value.buildId, 'dev');
  assert.equal(value.commitSha, '');
  assert.match(response.headers.get('cache-control'), /no-store/);
});
