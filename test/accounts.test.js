import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openStorage} from '../storage.js';
import {accountService,passwordMatches} from '../auth.js';
const first={name:'Test Owner',email:'owner@example.test',password:'Local test password 123!',hourlyRate:'20'};
const second={name:'Test Member',email:'member@example.test',password:'Other test password 456!'};
const setup=t=>{const store=openStorage(':memory:');t.after(()=>store.db.close());return {store,accounts:accountService(store)}};

test('accounts use salted password hashes and hashed persistent session tokens',async t=>{
 const {store,accounts}=setup(t);const result=await accounts.signup(first);const row=store.db.prepare('SELECT * FROM users').get();
 assert.notEqual(row.password_hash,first.password);assert.ok(row.password_hash.startsWith('scrypt$'));assert.equal(await passwordMatches(first.password,row.password_hash),true);assert.equal(await passwordMatches('wrong password',row.password_hash),false);
 assert.equal(result.user.password_hash,undefined);assert.equal(result.user.hourlyRate,2000);
 const session=store.db.prepare('SELECT * FROM sessions').get();assert.notEqual(session.token_hash,result.token);assert.equal(accounts.userForToken(result.token).id,result.user.id);
 accounts.logout(result.token);assert.equal(accounts.userForToken(result.token),null);
});
test('first account claims existing work and payment records; other accounts remain isolated',async t=>{
 const {store,accounts}=setup(t);
 store.put('project',{id:'old-project',name:'Existing',client:'Client',scope:'No extras',created:'2026-10-31T00:00:00Z'});
 store.put('review',{id:'old-review',projectId:'old-project',request:'Add FAQ',findings:[{title:'FAQ',status:'extra',evidence:'No extras',reason:'Extra'}]});
 store.put('proposal',{id:'old-proposal',projectId:'old-project',token:'a'.repeat(48),status:'paid',cents:6000,items:[{title:'FAQ',cents:6000}],capture:'existing-capture',order:'existing-order',paidAt:'2026-11-01T00:00:00Z',created:'2026-10-31T00:00:00Z'});
 const owner=await accounts.signup(first);const member=await accounts.signup(second);
 assert.equal(owner.user.role,'owner');assert.equal(member.user.role,'member');
 assert.equal(store.all('project',owner.user.id).length,1);assert.equal(store.all('review',owner.user.id).length,1);assert.equal(store.all('proposal',owner.user.id)[0].capture,'existing-capture');
 assert.equal(store.all('project',member.user.id).length,0);assert.equal(store.all('proposal',member.user.id).length,0);
 assert.throws(()=>store.get('old-project','project',member.user.id),/not found/);
 assert.throws(()=>store.put('project',{id:'old-project',name:'Hijacked'},member.user.id),/not found/);
 assert.equal(store.db.prepare('SELECT user_id FROM payments').get().user_id,owner.user.id);
 assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('profile rates persist without changing existing quote snapshots; export is scoped',async t=>{
 const {store,accounts}=setup(t);const owner=await accounts.signup(first);const member=await accounts.signup(second);
 store.put('project',{id:'p',name:'Project',client:'Client',scope:'Scope',hourlyRate:2000},owner.user.id);
 accounts.profile(owner.user.id,{name:'Updated Name',hourlyRate:'35'});
 assert.equal(accounts.userForToken(owner.token).hourlyRate,3500);assert.equal(store.get('p','project',owner.user.id).hourlyRate,2000);
 assert.equal(accounts.export(member.user.id).projects.length,0);assert.equal(accounts.export(owner.user.id).projects.length,1);assert.equal(accounts.export(owner.user.id).user.password_hash,undefined);
});
test('password change revokes older sessions, login checks credentials, and sessions expire',async t=>{
 const {store,accounts}=setup(t);const owner=await accounts.signup(first);const login=await accounts.login({...first,email:'OWNER@EXAMPLE.TEST'});
 await assert.rejects(accounts.login({...first,password:'wrong'}),/incorrect/);
 await assert.rejects(accounts.changePassword(owner.user.id,{currentPassword:'wrong',newPassword:'Replacement password 789!'}),/incorrect/);
 const fresh=await accounts.changePassword(owner.user.id,{currentPassword:first.password,newPassword:'Replacement password 789!'});
 assert.equal(accounts.userForToken(owner.token),null);assert.equal(accounts.userForToken(login.token),null);assert.ok(accounts.userForToken(fresh));
 await assert.rejects(accounts.login(first),/incorrect/);
 store.db.prepare('UPDATE sessions SET expires_at=?').run('2000-01-01T00:00:00Z');assert.equal(accounts.userForToken(fresh),null);
});
test('signup rejects weak passwords, invalid emails and duplicate accounts',async t=>{
 const {accounts}=setup(t);await assert.rejects(accounts.signup({...first,password:'short'}),/12/);await assert.rejects(accounts.signup({...first,email:'invalid'}),/valid email/);
 await accounts.signup(first);await assert.rejects(accounts.signup({...first,email:'OWNER@EXAMPLE.TEST'}),/already exists/);
});
test('normalized task and proposal tables are written together transactionally',async t=>{
 const {store,accounts}=setup(t);const owner=await accounts.signup(first);
 store.put('project',{id:'p',name:'Project',client:'Client',scope:'No booking'},owner.user.id);
 const pricing={estimatedHours:3,hourlyRate:2000,suggestedCents:6000,assumptions:['Embed only'],tasks:[{name:'Build',hours:2,basis:'Existing styling'},{name:'Test',hours:1,basis:'Two viewports'}]};
 store.put('review',{id:'r',projectId:'p',request:'Add booking',findings:[{title:'Booking',status:'extra',evidence:'No booking',reason:'Excluded',pricing}]},owner.user.id);
 store.put('proposal',{id:'q',projectId:'p',reviewId:'r',token:'b'.repeat(48),status:'awaiting',cents:6000,items:[{title:'Booking',cents:6000,pricing}]},owner.user.id);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM finding_tasks').get().n,2);assert.equal(store.db.prepare('SELECT amount_cents FROM proposal_items').get().amount_cents,6000);
 assert.throws(()=>store.put('proposal',{id:'bad',projectId:'p',token:'b'.repeat(48),status:'awaiting',cents:6000,items:[{title:'Duplicate',cents:6000}]},owner.user.id));
 assert.equal(store.all('proposal',owner.user.id).length,1);assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
