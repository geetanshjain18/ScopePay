import {resolve, isAbsolute} from 'node:path';
import {createHash, timingSafeEqual} from 'node:crypto';

export function deploymentConfig(env, root) {
  const hosted=env.NODE_ENV==='production'||env.RENDER==='true';
  const port=Number(env.PORT||4173);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be a valid TCP port.');
  let origin=null;
  const publicURL=env.PUBLIC_URL||env.RENDER_EXTERNAL_URL;
  if(hosted){
    if(!publicURL)throw Error('Set PUBLIC_URL or RENDER_EXTERNAL_URL to the service HTTPS URL.');
    const url=new URL(publicURL);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('The public URL must be an HTTPS origin without a path or credentials.');
    origin=url.origin;
    if(env.FREE_HOSTING==='true'&&!env.DATABASE_URL)throw Error('Free hosting requires DATABASE_URL for durable PostgreSQL storage.');
    if(!env.DATABASE_URL&&(!env.DATA_DIR||!isAbsolute(env.DATA_DIR)))throw Error('Hosted DATA_DIR must point to an absolute persistent-disk directory.');
    if(!env.OWNER_SETUP_TOKEN||env.OWNER_SETUP_TOKEN.length<32)throw Error('Hosted OWNER_SETUP_TOKEN must contain at least 32 characters.');
  }
  const dataDir=resolve(env.DATA_DIR||resolve(root,'data'));
  return {hosted,port,origin,dataDir,dbPath:resolve(dataDir,'scopepay.db'),listenHost:hosted?'0.0.0.0':'127.0.0.1',
    acceptsHost:host=>host===(origin?new URL(origin).host:'localhost:'+port)||host==='127.0.0.1:'+port||host==='localhost:'+port,
    acceptsOrigin:(requestOrigin,host)=>requestOrigin===(origin||'http://'+host),
    cookieSuffix:'; HttpOnly; SameSite=Lax; Path=/'+(hosted?'; Secure':''),
    setupRequired:count=>hosted&&count===0,
    validSetupToken:value=>{
      if(typeof value!=='string'||value.length>256||!env.OWNER_SETUP_TOKEN)return false;
      return timingSafeEqual(createHash('sha256').update(value).digest(),createHash('sha256').update(env.OWNER_SETUP_TOKEN).digest());
    }
  };
}
