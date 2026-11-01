import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openPostgresStorage,postgresConnectionOptions} from '../postgres-storage.js';
import {paymentService} from '../payments.js';

async function fixture(){
 const engine=await PGlite.create();let tail=Promise.resolve();
 const query=async(sql,args=[])=>{if(sql.includes('CREATE TABLE')){await engine.exec(sql);return {rows:[]};}return engine.query(sql,args);};
 const pool={query,end:()=>engine.close(),connect:async()=>{const previous=tail;let release;tail=new Promise(ok=>release=ok);await previous;return {query,release};}};
 const store=await openPostgresStorage(null,{pool});return store;
}
const signup=(email,name='Test user')=>({name,email,password:'Postgres test password 2026!',hourlyRate:'25'});

test('PostgreSQL driver verifies TLS certificates and does not retain SSL URL overrides',()=>{
 const options=postgresConnectionOptions('postgresql://user:password@host.example/db?sslmode=require');
 assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);assert.equal(options.max,3);
 assert.throws(()=>postgresConnectionOptions('http://example.test'));
});

test('PostgreSQL accounts isolate work, retain sessions and rates, and revoke old sessions on password change',async()=>{
 const s=await fixture();try{
  const a=await s.accounts.signup(signup('owner@example.test','Owner')),b=await s.accounts.signup(signup('other@example.test','Other'));
  assert.equal(a.user.role,'owner');assert.equal(b.user.role,'member');
  await assert.rejects(s.accounts.signup(signup('OWNER@example.test')),/already exists/);
  assert.equal((await s.accounts.userForToken(a.token)).id,a.user.id);
  await s.put('project',{id:'owned-project',name:'Private agreement',client:'Synthetic client',scope:'Three pages.',hourlyRate:2500},a.user.id);
  assert.equal((await s.all('project',b.user.id)).length,0);
  await assert.rejects(s.get('owned-project','project',b.user.id),/not found/);
  await s.accounts.profile(a.user.id,{name:'Updated Owner',hourlyRate:'40'});
  assert.equal((await s.accounts.userForToken(a.token)).hourlyRate,4000);
  assert.equal((await s.get('owned-project','project',a.user.id)).hourlyRate,2500);
  const logged=await s.accounts.login({email:'owner@example.test',password:'Postgres test password 2026!'});
  const replacement=await s.accounts.changePassword(a.user.id,{currentPassword:'Postgres test password 2026!',newPassword:'Replacement postgres password 2026!'});
  assert.equal(await s.accounts.userForToken(a.token),null);assert.equal(await s.accounts.userForToken(logged.token),null);assert.ok(await s.accounts.userForToken(replacement));
  assert.equal((await s.accounts.export(b.user.id)).projects.length,0);
  assert.ok((await s.accounts.activity(a.user.id)).some(row=>row.event==='password.changed'));
  await s.accounts.logout(replacement);assert.equal(await s.accounts.userForToken(replacement),null);
 }finally{await s.db.close();}
});

test('PostgreSQL keeps normalized findings and payments atomic and prevents stale updates from undoing paid records',async()=>{
 const s=await fixture();try{
  const {user}=await s.accounts.signup(signup('owner@example.test'));
  const project=await s.put('project',{id:'p',name:'Site',client:'Client',scope:'Booking excluded.'},user.id);
  const pricing={estimatedHours:3,hourlyRate:2500,suggestedCents:7500,assumptions:['Existing styles'],tasks:[{name:'Implement',hours:2,basis:'Reuse layout'},{name:'Test',hours:1,basis:'Check devices'}]};
  const review=await s.put('review',{id:'r',projectId:project.id,request:'Add booking.',findings:[{title:'Booking',status:'extra',pricing}]},user.id);
  assert.equal((await s.query('SELECT COUNT(*)::int AS n FROM finding_tasks')).rows[0].n,2);
  await assert.rejects(s.put('review',{...review,findings:[{title:'Invalid',status:'invalid'}]},user.id));
  assert.equal((await s.query('SELECT COUNT(*)::int AS n FROM finding_tasks')).rows[0].n,2);
  let p=await s.put('proposal',{id:'q',projectId:project.id,reviewId:review.id,token:'a'.repeat(48),projectName:'Site',client:'Client',items:[{title:'Booking',cents:7500,pricing}],cents:7500,status:'awaiting',accepted:true,order:'ORDER-TEST'},user.id);
  const stale={...p};p={...p,status:'paid',capture:'CAPTURE-TEST',paidAt:new Date().toISOString()};await s.put('proposal',p,user.id);
  await s.put('proposal',stale,user.id);
  assert.equal((await s.proposalByToken(p.token)).status,'paid');assert.equal((await s.query('SELECT COUNT(*)::int AS n FROM payments')).rows[0].n,1);
  assert.equal((await s.query('SELECT amount_cents FROM payments')).rows[0].amount_cents,7500);
  await assert.rejects(s.put('review',{id:'bad',projectId:'missing',request:'Invalid',findings:[]},user.id),/ownership/);
 }finally{await s.db.close();}
});

test('payment completion awaits asynchronous database reads and writes',async()=>{
 let record={id:'p',accepted:true,order:'ORDER',status:'awaiting',cents:5000};
 const service=paymentService({get:async()=>({...record}),save:async p=>{await new Promise(ok=>setTimeout(ok,5));record={...p};},provider:async()=>({id:'ORDER',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'50.00'}}]}}]})});
 await service.capture('p','ORDER');assert.equal(record.status,'paid');assert.equal(record.capture,'CAPTURE');
});
