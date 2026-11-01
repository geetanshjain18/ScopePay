import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const dataDir=resolve(process.env.DATA_DIR||'data'),source=resolve(dataDir,'scopepay.db');
if(!existsSync(source))throw Error('No existing database found. Nothing was backed up.');
const folder=resolve(dataDir,'backups');mkdirSync(folder,{recursive:true});
const destination=resolve(folder,'scopepay-'+new Date().toISOString().replaceAll(':','-')+'.db');
const db=new DatabaseSync(source);
try{
  db.prepare('VACUUM INTO ?').run(destination);
  const snapshot=new DatabaseSync(destination,{readOnly:true});
  try{if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup failed integrity validation.');}finally{snapshot.close();}
  console.log('Verified SQLite backup saved to '+destination);
}finally{db.close();}
