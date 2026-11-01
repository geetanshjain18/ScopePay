// Runs one request at a time; sleeping tabs do not poll or accumulate requests.
export function createSerialPoller(task,{interval=4000,isVisible=()=>!document.hidden,onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let timer=null,running=false,stopped=true,queued=false;
 const schedule=delay=>{if(!stopped){clearTimer(timer);timer=setTimer(run,delay);}};
 async function run(){timer=null;if(stopped)return;if(!isVisible()){schedule(interval);return;}if(running){queued=true;return;}running=true;try{await task();}catch(error){onError(error);}finally{running=false;if(!stopped){const delay=queued?0:interval;queued=false;schedule(delay);}}}
 return {start(){if(stopped){stopped=false;schedule(0);}},wake(){if(stopped)return;clearTimer(timer);timer=null;if(running)queued=true;else schedule(0);},stop(){stopped=true;queued=false;clearTimer(timer);timer=null;}};
}
export function paymentDisplayState(p){
 if(p.status==='paid'&&p.capture)return 'paid';
 if(p.captureStatus==='PENDING')return 'pending';
 if(['DECLINED','DENIED','FAILED'].includes(p.captureStatus))return 'failed';
 if(p.providerStatus==='VOIDED')return 'unavailable';
 if(p.lastCheckout==='cancelled')return 'cancelled';
 if(p.providerStatus==='APPROVED')return 'approved';
 return p.hasOrder?'awaiting':'ready';
}
export function workspaceSignature(value){return JSON.stringify(value,(key,v)=>['lastChecked','verifiedAt'].includes(key)?undefined:v);}
