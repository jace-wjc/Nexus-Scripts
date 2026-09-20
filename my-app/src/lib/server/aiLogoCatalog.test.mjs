import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import loadTypeScript from '../../../tests/load-typescript.mjs';

test('AI logo upload, lookup, listing, deletion and reupload use the persistent root with safe legacy fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ai-logo-'));
  const runtime = path.join(root, 'runtime', 'ai-logos');
  const legacy = path.join(root, 'public', 'ai-logos');
  fs.mkdirSync(runtime, {recursive:true}); fs.mkdirSync(legacy, {recursive:true});
  const globals = {process:{env:{RESOURCE_LOGO_ROOT:path.join(root,'runtime')},cwd:()=>root}};
  const paths = loadTypeScript(new URL('./resourceLogoPaths.ts',import.meta.url), {'node:path':{default:path}}, globals);
  let networkCalls = 0;
  const mocks = {'next/server':{NextResponse:Response},fs:{default:fs},path:{default:path},
    '@/lib/server/resourceLogoPaths':paths,
    '@/lib/server/scriptHubSession':{requireFreshScriptHubPermission:async()=>({session:{}})},
    '@/lib/server/networkGuards':{validateExternalHttpUrl:async value=>new URL(value)}};
  const globalValues = {...globals, fetch:async()=>{networkCalls++; return new Response(Buffer.alloc(150,1),{headers:{'content-type':'image/png'}});}};
  const logo = loadTypeScript(new URL('../../app/api/ai-resources/logo/route.ts',import.meta.url),mocks,globalValues);
  const listing = loadTypeScript(new URL('../../app/api/ai-resources/logo-list/route.ts',import.meta.url),mocks,globals);
  const upload = loadTypeScript(new URL('../../app/api/ai-resources/logo-upload/route.ts',import.meta.url),mocks,globals);
  const lookup = async id => (await logo.GET(new Request('http://synthetic?id='+id))).json();
  const list = async () => (await listing.GET(new Request('http://synthetic'))).json();
  const post = body => new Request('http://synthetic',{method:'POST',body:JSON.stringify(body)});
  const uploadFile = async id => {
    const form = new FormData(); form.append('id',id); form.append('file',new File([Buffer.alloc(150,2)],'synthetic.webp'));
    return (await upload.POST(new Request('http://synthetic',{method:'POST',body:form}))).json();
  };
  try {
    fs.writeFileSync(path.join(legacy,'synthetic.png'),Buffer.alloc(160,3));
    fs.writeFileSync(path.join(legacy,'legacy-only.svg'),'<svg/>');
    assert.equal((await lookup('legacy-only')).exists,true);
    assert.equal((await uploadFile('synthetic')).path,'/ai-logos/synthetic.webp');
    assert.equal((await lookup('synthetic')).path,'/ai-logos/synthetic.webp');
    assert.equal((await list()).logos.synthetic,'/ai-logos/synthetic.webp');
    const cached = await (await logo.POST(post({id:'synthetic',logoUrl:'https://example.invalid/logo.png'}))).json();
    assert.equal(cached.path,'/ai-logos/synthetic.webp');
    assert.equal(cached.cached,true);
    assert.equal(networkCalls,0);
    assert.equal((await (await logo.DELETE(post({id:'synthetic'}))).json()).success,true);
    assert.equal((await lookup('synthetic')).exists,false);
    assert.equal((await list()).logos.synthetic,undefined);
    assert.equal(fs.readFileSync(path.join(legacy,'synthetic.png')).length,160);
    assert.equal((await uploadFile('synthetic')).success,true);
    assert.equal((await lookup('synthetic')).path,'/ai-logos/synthetic.webp');
    fs.writeFileSync(path.join(runtime,'private.json'),'{}');
    assert.ok(!('private' in (await list()).logos));
    const downloaded = await (await logo.POST(post({id:'downloaded',logoUrl:'https://example.invalid/logo.png'}))).json();
    assert.equal(downloaded.path,'/ai-logos/downloaded.png');
    assert.equal(networkCalls,1);
    assert.ok(fs.existsSync(path.join(runtime,'downloaded.png')));
    assert.ok(!fs.existsSync(path.join(legacy,'downloaded.png')));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
