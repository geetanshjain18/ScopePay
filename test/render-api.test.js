import {test} from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';

test('hosted owner setup, HTTPS cookies and data survive a new release directory',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'scopepay-render-test-'));
 const disk=join(temp,'disk'),code=join(temp,'release-one'),next=join(temp,'release-two');
 const files=['package.json','server.js','deployment.js','domain.js','payments.js','storage.js','auth.js','public','scripts'];
 for(const file of files)cpSync(new URL('../'+file,import.meta.url),join(code,file),{recursive:true});
 const setupToken='render-owner-setup-token-for-isolated-test';
 const env={...process.env,DATABASE_URL:'',FREE_HOSTING:'',NODE_ENV:'production',RENDER:'true',PORT:'4177',PUBLIC_URL:'https://scopepay.example',DATA_DIR:disk,OWNER_SETUP_TOKEN:setupToken,GEMINI_API_KEY:'',PAYPAL_CLIENT_ID:'',PAYPAL_CLIENT_SECRET:''};
 const launch=cwd=>spawn(process.execPath,['server.js'],{cwd,env,stdio:['ignore','pipe','pipe']});
 const ready=child=>new Promise((ok,no)=>{let errors='';child.stderr.on('data',d=>errors+=d);child.stdout.on('data',d=>{if(d.toString().includes('ScopePay:'))ok()});child.once('error',no);child.once('exit',()=>no(Error(errors||'Server exited before startup')));setTimeout(()=>no(Error('Startup timeout')),10000).unref()});
 const stop=async child=>{if(child&&child.exitCode===null&&!child.killed){const ended=new Promise(ok=>child.once('exit',ok));child.kill();await ended;}};
 const call=(path,body,cookie,origin='https://scopepay.example',host='scopepay.example')=>new Promise((ok,no)=>{
  const req=request({hostname:'127.0.0.1',port:4177,path,method:body?'POST':'GET',headers:{Host:host,...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>ok(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value]))})));});
  req.on('error',no);req.end(body?JSON.stringify(body):undefined);
 });
 let child=launch(code);
 try{
  await ready(child);
  assert.equal((await call('/healthz')).status,200);
  const setup=await (await call('/api/auth')).json();assert.equal(setup.ownerSetupRequired,true);
  const signup={name:'Render test owner',email:'render@example.test',password:'Isolated owner password 2026!',hourlyRate:'25'};
  assert.equal((await call('/api/auth/signup',signup)).status,403);
  const account=await call('/api/auth/signup',{...signup,setupToken});assert.equal(account.status,201);
  const cookie=account.headers.get('set-cookie');assert.match(cookie,/; Secure/);assert.match(cookie,/HttpOnly/);
  const session=cookie.split(';')[0];assert.equal((await (await call('/api/auth')).json()).ownerSetupRequired,false);
  const project=await call('/api/projects',{name:'Persistent Render project',client:'Synthetic client',scope:'Three page website.'},session);assert.equal(project.status,201);
  assert.equal((await call('/api/projects',{name:'Cross-site'},session,'https://evil.example')).status,400);
  const spoof=await call('/',undefined,undefined,undefined,'evil.example');assert.equal(spoof.status,403);
  execFileSync(process.execPath,['scripts/backup.mjs'],{cwd:code,env,stdio:'pipe'});assert.equal(readdirSync(join(disk,'backups')).length,1);
  await stop(child);
  for(const file of files)cpSync(join(code,file),join(next,file),{recursive:true});
  child=launch(next);await ready(child);
  const state=await call('/api/state',undefined,session);assert.equal(state.status,200);
  const stored=await state.json();assert.equal(stored.projects.length,1);assert.equal(stored.projects[0].name,'Persistent Render project');assert.equal(stored.user.hourlyRate,2500);
  const logout=await call('/api/auth/logout',{},session);assert.match(logout.headers.get('set-cookie'),/; Secure/);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 }finally{
  await stop(child);
  const rel=relative(resolve(tmpdir()),resolve(temp));if(rel.startsWith('..')||!rel.startsWith('scopepay-render-test-'))throw Error('Unexpected test cleanup path');
  rmSync(temp,{recursive:true,force:true});
 }
});
