import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {passwordHash,passwordMatches} from './auth.js';
import {amountToCents} from './domain.js';
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const emailValue=value=>{if(typeof value!=='string'||value.length>254||!/^\S+@\S+\.\S+$/.test(value.trim()))fail('Enter a valid email address.');return value.trim().toLowerCase();};
const nameValue=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>80)fail('Enter a name of up to 80 characters.');return value.trim();};
const passwordValue=value=>{if(typeof value!=='string'||value.length<12||value.length>128)fail('Use a password between 12 and 128 characters.');return value;};

export function postgresAccounts(store){
 const {query,transaction}=store;
 const first=async(sql,args=[],client)=>((await query(sql,args,client)).rows[0]);
 const safe=u=>({id:u.id,email:u.email,name:u.name,role:u.role,hourlyRate:u.hourly_rate_cents,created:u.created_at,lastLogin:u.last_login_at});
 let dummyHash;
 async function session(userId,client){
  const token=randomBytes(32).toString('hex'),now=Date.now();
  await query('DELETE FROM sessions WHERE expires_at<=$1',[new Date(now).toISOString()],client);
  await query('INSERT INTO sessions VALUES($1,$2,$3,$4)',[hashToken(token),userId,new Date(now).toISOString(),new Date(now+7*86400000).toISOString()],client);
  return token;
 }
 async function userForToken(token,client){
  if(!/^[a-f0-9]{64}$/.test(token||''))return null;
  const row=await first('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=$1 AND sessions.expires_at>$2',[hashToken(token),new Date().toISOString()],client);
  return row?safe(row):null;
 }
 async function setup(){
  const row=await first('SELECT (SELECT COUNT(*) FROM users)::int AS users,(SELECT COUNT(*) FROM projects WHERE user_id IS NULL)::int AS legacy');
  return {firstAccount:row.users===0,legacyProjects:row.legacy};
 }
 return {safe,userForToken,setup,
  signup:async body=>{
   const email=emailValue(body.email),name=nameValue(body.name),password=passwordValue(body.password),rate=body.hourlyRate?amountToCents(body.hourlyRate):null;
   const hashed=await passwordHash(password),id=randomUUID(),now=new Date().toISOString();
   return transaction(async client=>{
    // Serialize first-owner assignment and duplicate checks across connections.
    await query('SELECT pg_advisory_xact_lock(74187301)',[],client);
    if(await first('SELECT id FROM users WHERE email=$1',[email],client))fail('An account with this email already exists. Sign in instead.',409);
    const count=await first('SELECT COUNT(*)::int AS n FROM users',[],client);
    await query('INSERT INTO users VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,email,name,hashed,count.n===0?'owner':'member',rate,now,now,now],client);
    await store.activity(id,'account.created',id,client);
    const token=await session(id,client);return {token,user:await userForToken(token,client)};
   });
  },
  login:async body=>{
   const email=emailValue(body.email);if(typeof body.password!=='string'||body.password.length>128)fail('Email or password is incorrect.',401);
   const row=await first('SELECT * FROM users WHERE email=$1',[email]);
   dummyHash ||= passwordHash(randomBytes(32).toString('hex'));
   if(!await passwordMatches(body.password,row?.password_hash||await dummyHash)||!row)fail('Email or password is incorrect.',401);
   return transaction(async client=>{await query('UPDATE users SET last_login_at=$1 WHERE id=$2',[new Date().toISOString(),row.id],client);await store.activity(row.id,'account.login',row.id,client);const token=await session(row.id,client);return {token,user:await userForToken(token,client)};});
  },
  logout:token=>query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(token||'')]),
  profile:async(userId,body)=>{
   const name=nameValue(body.name),rate=body.hourlyRate?amountToCents(body.hourlyRate):null;
   return transaction(async client=>{const row=await first('UPDATE users SET name=$1,hourly_rate_cents=$2,updated_at=$3 WHERE id=$4 RETURNING *',[name,rate,new Date().toISOString(),userId],client);if(!row)fail('Account not found.',404);await store.activity(userId,'profile.updated',userId,client);return safe(row);});
  },
  changePassword:async(userId,body)=>{
   const user=await first('SELECT * FROM users WHERE id=$1',[userId]);
   if(!user||typeof body.currentPassword!=='string'||body.currentPassword.length>128||!await passwordMatches(body.currentPassword,user.password_hash))fail('Current password is incorrect.',401);
   const hashed=await passwordHash(passwordValue(body.newPassword));
   return transaction(async client=>{await query('UPDATE users SET password_hash=$1,updated_at=$2 WHERE id=$3',[hashed,new Date().toISOString(),userId],client);await query('DELETE FROM sessions WHERE user_id=$1',[userId],client);await store.activity(userId,'password.changed',userId,client);return session(userId,client);});
  },
  sessions:async userId=>(await query('SELECT created_at AS created,expires_at AS expires FROM sessions WHERE user_id=$1 AND expires_at>$2 ORDER BY created_at DESC',[userId,new Date().toISOString()])).rows,
  activity:async userId=>(await query('SELECT event,entity_id AS "entityId",created_at AS created FROM activity_logs WHERE user_id=$1 ORDER BY id DESC LIMIT 40',[userId])).rows,
  export:async userId=>({exportedAt:new Date().toISOString(),user:safe(await first('SELECT * FROM users WHERE id=$1',[userId])),projects:await store.all('project',userId),reviews:await store.all('review',userId),proposals:await store.all('proposal',userId)})
 };
}
