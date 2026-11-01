import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {amountToCents} from './domain.js';
const derive=promisify(scrypt);
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const validPassword=p=>{if(typeof p!=='string'||p.length<12||p.length>128)fail('Use a password between 12 and 128 characters.');return p;};
const validEmail=e=>{if(typeof e!=='string'||e.length>254||!/^\S+@\S+\.\S+$/.test(e.trim()))fail('Enter a valid email address.');return e.trim().toLowerCase();};
const validName=n=>{if(typeof n!=='string'||!n.trim()||n.trim().length>80)fail('Enter a name of up to 80 characters.');return n.trim();};
export async function passwordHash(password){
 const salt=randomBytes(16).toString('hex');
 const key=await derive(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
 return ['scrypt','32768','8','3',salt,key.toString('hex')].join('$');
}
export async function passwordMatches(password,stored){
 try{
  const [type,n,r,p,salt,encoded]=stored.split('$');
  if(type!=='scrypt'||Number(n)!==32768||Number(r)!==8||Number(p)!==3)return false;
  const key=await derive(password,salt,64,{N:Number(n),r:Number(r),p:Number(p),maxmem:64*1024*1024});
  const expected=Buffer.from(encoded,'hex');return key.length===expected.length&&timingSafeEqual(key,expected);
 }catch{return false;}
}
export function accountService(store){
 const {db,transaction,claimLegacy,activity}=store;
 const duration=7*24*60*60*1000;
 let dummyHash;
 const safe=u=>({id:u.id,email:u.email,name:u.name,role:u.role,hourlyRate:u.hourly_rate_cents,created:u.created_at,lastLogin:u.last_login_at});
 function session(userId){
  const token=randomBytes(32).toString('hex'),time=Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date(time).toISOString());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token),userId,new Date(time).toISOString(),new Date(time+duration).toISOString());
  return token;
 }
 function userForToken(token){
  if(!/^[a-f0-9]{64}$/.test(token||''))return null;
  const row=db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(hashToken(token),new Date().toISOString());
  return row?safe(row):null;
 }
 return {
  safe,userForToken,
  setup:()=>({firstAccount:db.prepare('SELECT COUNT(*) AS n FROM users').get().n===0,legacyProjects:db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id IS NULL').get().n}),
  signup:async body=>{
   const email=validEmail(body.email),name=validName(body.name),password=validPassword(body.password);
   const hourlyRate=body.hourlyRate?amountToCents(body.hourlyRate):null;
   if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('An account with this email already exists. Sign in instead.',409);
   const password_hash=await passwordHash(password),id=randomUUID(),time=new Date().toISOString();
   return transaction(()=>{
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('An account with this email already exists.',409);
    const first=db.prepare('SELECT COUNT(*) AS n FROM users').get().n===0;
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)').run(id,email,name,password_hash,first?'owner':'member',hourlyRate,time,time,time);
    if(first)claimLegacy(id);
    activity(id,'account.created',id);
    const token=session(id);return {token,user:userForToken(token)};
   });
  },
  login:async body=>{
   const email=validEmail(body.email);
   if(typeof body.password!=='string'||body.password.length>128)fail('Email or password is incorrect.',401);
   const row=db.prepare('SELECT * FROM users WHERE email=?').get(email);
   dummyHash ||= await passwordHash(randomBytes(32).toString('hex'));
   const matched=await passwordMatches(body.password,row?.password_hash||dummyHash);
   if(!row||!matched)fail('Email or password is incorrect.',401);
   db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(),row.id);
   activity(row.id,'account.login',row.id);const token=session(row.id);return {token,user:userForToken(token)};
  },
  logout:token=>db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token||'')),
  profile:(userId,body)=>{
   const name=validName(body.name),hourlyRate=body.hourlyRate?amountToCents(body.hourlyRate):null;
   db.prepare('UPDATE users SET name=?,hourly_rate_cents=?,updated_at=? WHERE id=?').run(name,hourlyRate,new Date().toISOString(),userId);
   activity(userId,'profile.updated',userId);return safe(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  },
  changePassword:async(userId,body)=>{
   const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
   if(typeof body.currentPassword!=='string'||body.currentPassword.length>128||!await passwordMatches(body.currentPassword,user.password_hash))fail('Current password is incorrect.',401);
   const hashed=await passwordHash(validPassword(body.newPassword));
   return transaction(()=>{
    db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(hashed,new Date().toISOString(),userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);activity(userId,'password.changed',userId);
    return session(userId);
   });
  },
  sessions:userId=>db.prepare('SELECT created_at AS created,expires_at AS expires FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').all(userId,new Date().toISOString()),
  activity:userId=>db.prepare('SELECT event,entity_id AS entityId,created_at AS created FROM activity_logs WHERE user_id=? ORDER BY id DESC LIMIT 40').all(userId),
  export:userId=>({exportedAt:new Date().toISOString(),user:safe(db.prepare('SELECT * FROM users WHERE id=?').get(userId)),projects:store.all('project',userId),reviews:store.all('review',userId),proposals:store.all('proposal',userId)})
 };
}
