import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {openStorage} from '../storage.js';

test('legacy records migrate exactly once without changing original archive or completed payment',()=>{
 const dir=mkdtempSync(join(tmpdir(),'scopepay-migrate-')),path=join(dir,'scopepay.db');let store;
 try{
  const legacy=new DatabaseSync(path);legacy.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,body TEXT)');
  const records=[['project',{id:'p',name:'Existing project',client:'Client',scope:'Agreement',created:'2026-10-31T00:00:00Z'}],['review',{id:'r',projectId:'p',request:'Extra page',findings:[{title:'Page',status:'extra',evidence:'Agreement',reason:'Extra'}]}],['proposal',{id:'q',projectId:'p',token:'c'.repeat(48),status:'paid',accepted:true,cents:6000,order:'ORDER',capture:'CAPTURE',paidAt:'2026-11-01T00:00:00Z',items:[{title:'Page',cents:6000}],created:'2026-10-31T00:00:00Z'}]];
  for(const [kind,p] of records)legacy.prepare('INSERT INTO records VALUES(?,?,?)').run(p.id,kind,JSON.stringify(p));legacy.close();
  store=openStorage(path);assert.equal(store.all('project').length,1);assert.equal(store.all('review').length,1);assert.equal(store.all('proposal')[0].token,'c'.repeat(48));assert.equal(store.db.prepare('SELECT capture_id,amount_cents FROM payments').get().capture_id,'CAPTURE');assert.equal(store.db.prepare('SELECT body FROM records WHERE id=?').get('q').body,JSON.stringify(records[2][1]));
  store.db.close();store=openStorage(path);assert.equal(store.all('proposal').length,1);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,1);assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{store?.db.close();const cleanupRelative=relative(resolve(tmpdir()),resolve(dir));if(cleanupRelative.startsWith('..')||!cleanupRelative.startsWith('scopepay-migrate-'))throw Error('Unexpected cleanup path');rmSync(dir,{recursive:true,force:true})}
});
