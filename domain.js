export const sampleScope = 'Three-page website: Home, About, Contact. Includes two revision rounds, including colour and typography changes. Booking functionality and copywriting are excluded. Third-party integrations require a separate agreement.';
export const sampleRequest = 'Please change the header colour to olive, add a booking page, and connect it to our existing system.';
export const sampleFindings = [
 {title:'Update the header colour',status:'included',evidence:'Includes two revision rounds, including colour and typography changes.',reason:'A colour adjustment is covered by the agreed revision allowance. Confirm that a revision round remains available.'},
 {title:'Add a booking page',status:'extra',evidence:'Booking functionality and copywriting are excluded.',reason:'Booking is explicitly excluded from the original agreement.'},
 {title:'Connect the existing system',status:'clarify',evidence:'Third-party integrations require a separate agreement.',reason:'Ask which system, what data must move, and whether API access is available before quoting.'}
];
export function amountToCents(value) {
 if (!/^\d{1,6}(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a valid USD amount with up to two decimals.');
 const [whole, decimal=''] = String(value).split('.');
 const cents = Number(whole)*100 + Number(decimal.padEnd(2,'0'));
 if(cents < 100 || cents > 10000000) throw new Error('Amount must be between $1 and $100,000.');
 return cents;
}
export function validateFindings(value,scope,request='') {
 if(!Array.isArray(value)||!value.length||value.length>20) throw new Error('AI returned an invalid review. Please retry.');
 const findings=value.map(f=>{
  if(!['included','extra','clarify'].includes(f.status)||!['title','evidence','reason'].every(k=>typeof f[k]==='string' && f[k].length<=2000)) throw new Error('AI returned an invalid finding.');
  const verified = f.evidence && scope.includes(f.evidence);
  const result={...f,status:verified?f.status:'clarify',evidence:verified?f.evidence:'',reason:verified?f.reason:'No exact agreement evidence was verified. Review this item manually. '+f.reason};
  if(request){
   if(typeof f.requestQuote!=='string'||!f.requestQuote.trim()||!request.includes(f.requestQuote)){result.status='clarify';result.reason='The request evidence could not be verified. '+result.reason;}
   if(f.needsClarification!==false||/\b(existing|current|our)\s+system\b/i.test(f.requestQuote||f.title)){result.status='clarify';result.reason='Clarify the deliverable and any system/API requirements before quoting. '+result.reason;}
  }
  return result;
 });
 if(!request)return findings;
 // Overlapping request spans are one deliverable; retain uncertainty if either interpretation is unclear.
 const grouped=[];
 for(const f of findings){
  const start=f.requestQuote?request.indexOf(f.requestQuote):-1,end=start+(f.requestQuote?.length||0);
  const previous=grouped.find(g=>start>=0&&g.start>=0&&start<g.end&&end>g.start);
  if(previous){previous.finding.merged=true;if(previous.finding.status!==f.status){previous.finding.status='clarify';previous.finding.reason='Overlapping interpretations disagree. Clarify this request before billing.';}previous.start=Math.min(previous.start,start);previous.end=Math.max(previous.end,end);}
  else grouped.push({start,end,finding:f});
 }
 return grouped.map(g=>g.finding);
}
export function suggestedPrice(f,hourlyRate){
 const min=f.estimateHoursMin,max=f.estimateHoursMax;
 if(f.status!=='extra'||f.needsClarification||!Number.isInteger(hourlyRate)||hourlyRate<=0||!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max<min||max>160||!Array.isArray(f.assumptions)||!f.assumptions.length)return null;
 const tasks=Array.isArray(f.tasks)?f.tasks.filter(t=>typeof t.name==='string'&&t.name.trim()&&Number.isFinite(t.hours)&&t.hours>0&&t.hours<=160&&typeof t.basis==='string').slice(0,20):[];
 if(f.tasks && tasks.length!==f.tasks.length)return null;
 const hours=tasks.length?Math.round(tasks.reduce((s,t)=>s+t.hours,0)*100)/100:Math.round((min+max)/2*100)/100;
 if(hours<min||hours>max)return null;
 return {minCents:Math.round(min*hourlyRate),maxCents:Math.round(max*hourlyRate),suggestedCents:Math.round(hours*hourlyRate),estimatedHours:hours,hourlyRate,hoursMin:min,hoursMax:max,tasks,assumptions:f.assumptions.filter(a=>typeof a==='string').slice(0,5)};
}
