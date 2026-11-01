import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentService} from '../payments.js';

function fixture(options={}) {
  let record={id:'p1',projectName:'Test project',cents:6000,accepted:true,status:'awaiting',demo:false,...options};
  let remote={id:'ORDER-1',status:'APPROVED'};
  const calls=[];
  let loseCaptureResponse=false;
  const completed=()=>({id:'ORDER-1',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE-1',status:'COMPLETED',amount:{currency_code:'USD',value:'60.00'}}]}}]});
  const provider=async(path,body,key)=>{
    calls.push({path,body,key});
    await new Promise(resolve=>setTimeout(resolve,5));
    if(path==='/v2/checkout/orders')return {id:'ORDER-1',status:'CREATED'};
    if(path.endsWith('/capture')){remote=completed();if(loseCaptureResponse)throw Error('Response lost');return structuredClone(remote);}
    return structuredClone(remote);
  };
  const create=()=>paymentService({get:()=>structuredClone(record),save:p=>{record=structuredClone(p)},provider});
  return {service:create(),create,calls,get:()=>record,setRemote:v=>{remote=v},completed,loseResponse:()=>{loseCaptureResponse=true}};
}
test('concurrent order requests create one provider order with a stable request ID',async()=>{
 const f=fixture();const results=await Promise.all([f.service.order('p1'),f.service.order('p1')]);
 assert.equal(f.calls.filter(c=>c.path==='/v2/checkout/orders').length,1);assert.equal(f.calls[0].key,'p1');assert.deepEqual(results,[{id:'ORDER-1'},{id:'ORDER-1'}]);
});
test('concurrent capture requests capture once; paid retries never charge again',async()=>{
 const f=fixture({order:'ORDER-1'});await Promise.all([f.service.capture('p1','ORDER-1'),f.service.capture('p1','ORDER-1')]);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/capture')).length,1);assert.equal(f.get().status,'paid');assert.equal(f.get().capture,'CAPTURE-1');
 const before=f.calls.length;assert.deepEqual(await f.service.order('p1'),{paid:true});await f.service.capture('p1','ORDER-1');assert.equal(f.calls.length,before);
});
test('cancellation keeps proposal unpaid and never calls payment provider',async()=>{
 const f=fixture({order:'ORDER-1'});await f.service.cancel('p1');assert.equal(f.get().status,'awaiting');assert.equal(f.get().lastCheckout,'cancelled');assert.equal(f.calls.length,0);
});
test('cancelled checkout can resume the same order',async()=>{
 const f=fixture({order:'ORDER-1'});await f.service.cancel('p1');const cancelledAt=f.get().cancelledAt;const order=await f.service.order('p1');assert.equal(order.id,'ORDER-1');assert.equal(f.calls.filter(c=>c.body).length,0);assert.equal(f.get().lastCheckout,'resumed');assert.equal(f.get().cancelledAt,cancelledAt);assert.equal(f.get().status,'awaiting');
});
test('lost capture response reconciles completed payment without a replacement charge',async()=>{
 const f=fixture({order:'ORDER-1'});f.loseResponse();await f.service.capture('p1','ORDER-1');assert.equal(f.get().status,'paid');assert.equal(f.calls.filter(c=>c.path.endsWith('/capture')).length,1);
});
test('unapproved and mismatched orders cannot be captured',async()=>{
 const f=fixture({order:'ORDER-1'});f.setRemote({id:'ORDER-1',status:'CREATED'});await assert.rejects(f.service.capture('p1','OTHER'),/does not match/);await assert.rejects(f.service.capture('p1','ORDER-1'),/not approved/);assert.equal(f.calls.filter(c=>c.path.endsWith('/capture')).length,0);
});
test('completed orders with incorrect amounts or currency do not become paid',async()=>{
 for(const amount of [{currency_code:'USD',value:'1.00'},{currency_code:'EUR',value:'60.00'}]){
 const f=fixture({order:'ORDER-1'});const order=f.completed();order.purchase_units[0].payments.captures[0].amount=amount;f.setRemote(order);await assert.rejects(f.service.refresh('p1'),/does not match/);assert.equal(f.get().status,'awaiting');}
});
test('pending captures remain unpaid and refresh only reads provider state',async()=>{
 const f=fixture({order:'ORDER-1'});f.setRemote({id:'ORDER-1',status:'APPROVED',purchase_units:[{payments:{captures:[{status:'PENDING'}]}}]});await f.service.refresh('p1');assert.equal(f.get().status,'awaiting');assert.ok(f.calls.every(c=>!c.body));
});
test('status recovery records completed payment and remains safe after service restart',async()=>{
 const f=fixture({order:'ORDER-1'});f.setRemote(f.completed());await f.service.refresh('p1');const restarted=f.create();const before=f.calls.length;await restarted.capture('p1','ORDER-1');assert.equal(f.calls.length,before);assert.equal(f.get().capture,'CAPTURE-1');
});
test('sample and unaccepted proposals cannot start checkout',async()=>{
 for(const options of [{demo:true},{accepted:false}]){const f=fixture(options);await assert.rejects(f.service.order('p1'));assert.equal(f.calls.length,0);}
});

test('automatic refresh coalesces provider reads and forced confirmation checks fresh state',async()=>{
 const f=fixture({order:'ORDER-1'});await Promise.all([f.service.refresh('p1'),f.service.refresh('p1')]);assert.equal(f.calls.length,1);
 f.setRemote(f.completed());assert.equal((await f.service.refresh('p1')).paid,false);assert.equal((await f.service.refresh('p1',{force:true})).paid,true);assert.equal(f.get().captureStatus,'COMPLETED');
 const before=f.calls.length;await f.service.refresh('p1',{force:true});assert.equal(f.calls.length,before);
});
