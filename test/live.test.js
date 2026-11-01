import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSerialPoller,paymentDisplayState,workspaceSignature} from '../public/live.js';
test('poller serializes requests, queues a wake, and stops without rescheduling',async()=>{
 const scheduled=new Map();let serial=0,finish,calls=0;
 const p=createSerialPoller(()=>{calls++;return new Promise(resolve=>finish=resolve);},{setTimer:fn=>{scheduled.set(++serial,fn);return serial},clearTimer:id=>scheduled.delete(id),isVisible:()=>true});
 const fire=()=>{const [id,fn]=scheduled.entries().next().value;scheduled.delete(id);return fn();};
 p.start();const first=fire();p.wake();p.wake();assert.equal(calls,1);assert.equal(scheduled.size,0);finish();await first;assert.equal(scheduled.size,1);
 const second=fire();assert.equal(calls,2);p.stop();finish();await second;assert.equal(scheduled.size,0);
});
test('hidden poller waits, visible wake recovers, and errors do not kill updates',async()=>{
 let callback,visible=false,calls=0,errors=0;const p=createSerialPoller(async()=>{calls++;throw Error('offline')},{isVisible:()=>visible,setTimer:fn=>{callback=fn;return 1},clearTimer:()=>{},onError:()=>errors++});
 p.start();await callback();assert.equal(calls,0);visible=true;p.wake();await callback();assert.equal(calls,1);assert.equal(errors,1);assert.equal(typeof callback,'function');p.stop();
});
test('payment display never confuses acceptance or approval with a completed capture',()=>{
 assert.equal(paymentDisplayState({status:'awaiting',accepted:true,hasOrder:true,providerStatus:'APPROVED'}),'approved');
 assert.equal(paymentDisplayState({status:'awaiting',captureStatus:'PENDING'}),'pending');
 assert.equal(paymentDisplayState({status:'paid'}),'ready');
 assert.equal(paymentDisplayState({status:'paid',capture:'CAPTURE-1'}),'paid');
 assert.equal(paymentDisplayState({status:'awaiting',lastCheckout:'cancelled'}),'cancelled');
});
test('volatile provider-check times do not force workspace rerenders',()=>{
 assert.equal(workspaceSignature({lastChecked:'a',verifiedAt:'b',status:'awaiting'}),workspaceSignature({lastChecked:'c',verifiedAt:'d',status:'awaiting'}));
 assert.notEqual(workspaceSignature({status:'awaiting'}),workspaceSignature({status:'paid'}));
});
