import {readFileSync} from 'node:fs';
import {postgresAccounts} from './postgres-auth.js';

export function postgresConnectionOptions(connectionString){
 const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('DATABASE_URL must be a PostgreSQL connection URL.');
 // Keep certificate verification explicit; connection-string sslmode overrides pg's SSL object.
 for(const name of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(name);
 return {connectionString:url.toString(),ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,statement_timeout:15000};
}

export async function openPostgresStorage(connectionString,{pool:providedPool}={}){
 const pool=providedPool||new (await import('pg')).Pool(postgresConnectionOptions(connectionString));
 const query=(sql,args=[],client)=>(client||pool).query(sql,args);
 async function transaction(fn){
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
 }
 try{
  await transaction(async client=>{await query('SELECT pg_advisory_xact_lock(74187300)',[],client);await query(readFileSync(new URL('./schema-postgres.sql',import.meta.url),'utf8'),[],client);});
 }catch(error){await pool.end();throw error;}
 const tables={project:'projects',review:'scope_reviews',proposal:'proposals',connection:'connections'};
 const now=()=>new Date().toISOString();
 async function activity(userId,event,entityId,client){await query('INSERT INTO activity_logs(user_id,event,entity_id,created_at) VALUES($1,$2,$3,$4)',[userId||null,event,entityId||null,now()],client);}
 async function all(kind,userId){
  const table=tables[kind];if(!table)throw Error('Unknown record type.');
  const scoped=kind!=='connection'&&userId!==undefined;
  return (await query(`SELECT details_json FROM ${table}${scoped?' WHERE user_id=$1':''} ORDER BY ordinal`,scoped?[userId]:[])).rows.map(r=>JSON.parse(r.details_json));
 }
 async function get(id,kind,userId){
  const table=tables[kind];if(!table)throw Error('Unknown record type.');
  const scoped=kind!=='connection'&&userId!==undefined;
  const row=(await query(`SELECT details_json FROM ${table} WHERE id=$1${scoped?' AND user_id=$2':''}`,[id,...(scoped?[userId]:[])])).rows[0];
  if(!row)throw Object.assign(Error('Record not found.'),{status:404});return JSON.parse(row.details_json);
 }
 async function put(kind,obj,userId){
  const table=tables[kind];if(!table)throw Error('Unknown record type.');
  return transaction(async client=>{
   const p={...obj},existing=(await query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[p.id],client)).rows[0];
   let owner=userId;
   if(kind!=='connection'){
    if(existing&&userId!==undefined&&existing.user_id!==userId)throw Object.assign(Error('Record not found.'),{status:404});
    owner=existing?.user_id??userId??p.userId??null;p.userId=owner;
    if(kind==='proposal'&&existing){const saved=JSON.parse(existing.details_json);if(saved.status==='paid')return saved;if(saved.order&&!p.order){p.order=saved.order;p.providerStatus=saved.providerStatus;p.captureStatus=saved.captureStatus;}if(saved.accepted)p.accepted=true;}
    if(kind==='review'||kind==='proposal'){
     const parent=(await query('SELECT user_id FROM projects WHERE id=$1',[p.projectId],client)).rows[0];if(!parent||parent.user_id!==owner)throw Error('Project ownership does not match.');
    }
   }
   if(kind==='project'){
    p.created ||= now();
    await query(`INSERT INTO projects(id,user_id,name,client_name,scope_text,hourly_rate_cents,is_demo,created_at,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,client_name=excluded.client_name,scope_text=excluded.scope_text,hourly_rate_cents=excluded.hourly_rate_cents,details_json=excluded.details_json`,[p.id,owner,p.name,p.client,p.scope,p.hourlyRate||null,+!!p.demo,p.created,JSON.stringify(p)],client);
   }else if(kind==='review'){
    p.created ||= now();
    await query(`INSERT INTO scope_reviews(id,user_id,project_id,request_text,hourly_rate_cents,is_demo,created_at,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET details_json=excluded.details_json,hourly_rate_cents=excluded.hourly_rate_cents`,[p.id,owner,p.projectId,p.request,p.hourlyRate||null,+!!p.demo,p.created,JSON.stringify(p)],client);
    await query('DELETE FROM review_findings WHERE review_id=$1',[p.id],client);
    for(const [i,f] of p.findings.entries()){
     await query('INSERT INTO review_findings VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,i,f.title,f.status,f.evidence||'',f.reason||'',f.requestQuote||'',f.pricing?.estimatedHours||null,f.pricing?.suggestedCents||null,JSON.stringify(f.pricing?.assumptions||[])],client);
     for(const [j,t] of (f.pricing?.tasks||[]).entries())await query('INSERT INTO finding_tasks VALUES($1,$2,$3,$4,$5,$6)',[p.id,i,j,t.name,t.hours,t.basis||''],client);
    }
   }else if(kind==='proposal'){
    p.created ||= now();
    if(p.reviewId){const parent=(await query('SELECT user_id,project_id FROM scope_reviews WHERE id=$1',[p.reviewId],client)).rows[0];if(!parent||parent.user_id!==owner||parent.project_id!==p.projectId)throw Error('Review ownership does not match.');}
    if(p.accepted&&!p.acceptedAt)p.acceptedAt=now();
    await query(`INSERT INTO proposals(id,user_id,project_id,review_id,access_token,status,total_cents,currency,accepted_at,paypal_order_id,is_demo,created_at,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET status=excluded.status,total_cents=excluded.total_cents,accepted_at=excluded.accepted_at,paypal_order_id=excluded.paypal_order_id,details_json=excluded.details_json`,[p.id,owner,p.projectId,p.reviewId||null,p.token,p.status,p.cents,'USD',p.acceptedAt||null,p.order||null,+!!p.demo,p.created,JSON.stringify(p)],client);
    await query('DELETE FROM proposal_items WHERE proposal_id=$1',[p.id],client);
    for(const [i,item] of p.items.entries())await query('INSERT INTO proposal_items VALUES($1,$2,$3,$4,$5,$6,$7)',[p.id,i,item.title,item.cents,item.pricing?.estimatedHours||null,item.pricing?.hourlyRate||null,item.pricing?JSON.stringify(item.pricing):null],client);
    if(p.status==='paid'&&p.capture)await query('INSERT INTO payments VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(capture_id) DO UPDATE SET status=excluded.status',[p.capture,p.id,owner,p.order||null,p.cents,'USD','COMPLETED',p.paidAt||now()],client);
   }else await query('INSERT INTO connections(id,details_json) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET details_json=excluded.details_json',[p.id,JSON.stringify(p)],client);
   if(kind!=='connection'&&!existing)await activity(owner,kind+'.created',p.id,client);
   return p;
  });
 }
 const db={close:()=>pool.end()};
 db.prepare=sql=>({get:async(...args)=>{let i=0;return (await query(sql.replaceAll('?',()=>'$'+(++i)),args)).rows[0];}});
 const store={kind:'postgres',db,query,transaction,activity,all,get,put,
  proposalByToken:async token=>{const row=(await query('SELECT details_json FROM proposals WHERE access_token=$1',[token])).rows[0];return row?JSON.parse(row.details_json):null;}
 };
 store.accounts=postgresAccounts(store);return store;
}
