import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export function openStorage(path) {
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,
      password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','member')),
      hourly_rate_cents INTEGER CHECK(hourly_rate_cents IS NULL OR hourly_rate_cents>0),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS projects(
      id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),name TEXT NOT NULL,
      client_name TEXT NOT NULL,scope_text TEXT NOT NULL,hourly_rate_cents INTEGER,
      is_demo INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,details_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS projects_owner ON projects(user_id,created_at);
    CREATE TABLE IF NOT EXISTS scope_reviews(
      id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),project_id TEXT NOT NULL REFERENCES projects(id),
      request_text TEXT NOT NULL,hourly_rate_cents INTEGER,is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,details_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reviews_owner ON scope_reviews(user_id,project_id,created_at);
    CREATE TABLE IF NOT EXISTS review_findings(
      review_id TEXT NOT NULL REFERENCES scope_reviews(id) ON DELETE CASCADE,position INTEGER NOT NULL,
      title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('included','extra','clarify')),
      evidence TEXT,reason TEXT,quoted_request TEXT,estimated_hours REAL,amount_cents INTEGER,
      assumptions_json TEXT NOT NULL,PRIMARY KEY(review_id,position));
    CREATE TABLE IF NOT EXISTS finding_tasks(
      review_id TEXT NOT NULL,finding_position INTEGER NOT NULL,position INTEGER NOT NULL,
      name TEXT NOT NULL,hours REAL NOT NULL,basis TEXT,
      PRIMARY KEY(review_id,finding_position,position),
      FOREIGN KEY(review_id,finding_position) REFERENCES review_findings(review_id,position) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS proposals(
      id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),project_id TEXT NOT NULL REFERENCES projects(id),
      review_id TEXT REFERENCES scope_reviews(id),access_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('awaiting','paid')),total_cents INTEGER NOT NULL CHECK(total_cents>0),
      currency TEXT NOT NULL DEFAULT 'USD',accepted_at TEXT,paypal_order_id TEXT UNIQUE,
      is_demo INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,details_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS proposals_owner ON proposals(user_id,project_id,status,created_at);
    CREATE TABLE IF NOT EXISTS proposal_items(
      proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,position INTEGER NOT NULL,
      title TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),estimated_hours REAL,
      hourly_rate_cents INTEGER,pricing_json TEXT,PRIMARY KEY(proposal_id,position));
    CREATE TABLE IF NOT EXISTS payments(
      capture_id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
      user_id TEXT REFERENCES users(id),paypal_order_id TEXT,amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,status TEXT NOT NULL,paid_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS payments_owner ON payments(user_id,paid_at);
    CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,details_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT REFERENCES users(id),
      event TEXT NOT NULL,entity_id TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_owner ON activity_logs(user_id,created_at);
  `);
  const tables={project:'projects',review:'scope_reviews',proposal:'proposals',connection:'connections'};
  const now=()=>new Date().toISOString();
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
  function all(kind,userId){
    const table=tables[kind];if(!table)throw Error('Unknown record type.');
    const scoped=kind!=='connection'&&userId!==undefined;
    return db.prepare(`SELECT details_json FROM ${table}${scoped?' WHERE user_id=?':''} ORDER BY rowid`).all(...(scoped?[userId]:[])).map(r=>JSON.parse(r.details_json));
  }
  function get(id,kind,userId){
    const table=tables[kind];if(!table)throw Error('Unknown record type.');
    const scoped=kind!=='connection'&&userId!==undefined;
    const row=db.prepare(`SELECT details_json FROM ${table} WHERE id=?${scoped?' AND user_id=?':''}`).get(id,...(scoped?[userId]:[]));
    if(!row)throw Object.assign(Error('Record not found.'),{status:404});
    return JSON.parse(row.details_json);
  }
  function activity(userId,event,entityId){db.prepare('INSERT INTO activity_logs(user_id,event,entity_id,created_at) VALUES(?,?,?,?)').run(userId||null,event,entityId||null,now());}
  function write(kind,obj,userId){
    const p={...obj};
    let owner=userId;
    if(kind!=='connection'){
      const existing=db.prepare(`SELECT user_id FROM ${tables[kind]} WHERE id=?`).get(p.id);
      if(existing&&userId!==undefined&&existing.user_id!==userId)throw Object.assign(Error('Record not found.'),{status:404});
      owner=existing?.user_id??userId??p.userId??null;
      if(kind==='review'||kind==='proposal'){
        const parent=db.prepare('SELECT user_id FROM projects WHERE id=?').get(p.projectId);
        if(!parent||parent.user_id!==owner)throw Error('Project ownership does not match.');
      }
      p.userId=owner;
    }
    const existed=kind!=='connection'&&!!db.prepare(`SELECT id FROM ${tables[kind]} WHERE id=?`).get(p.id);
    if(kind==='project'){
      p.created ||= now();
      db.prepare(`INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,client_name=excluded.client_name,scope_text=excluded.scope_text,hourly_rate_cents=excluded.hourly_rate_cents,details_json=excluded.details_json`)
        .run(p.id,owner,p.name,p.client,p.scope,p.hourlyRate||null,+!!p.demo,p.created,JSON.stringify(p));
    }else if(kind==='review'){
      p.created ||= now();
      db.prepare(`INSERT INTO scope_reviews VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET details_json=excluded.details_json,hourly_rate_cents=excluded.hourly_rate_cents`)
        .run(p.id,owner,p.projectId,p.request,p.hourlyRate||null,+!!p.demo,p.created,JSON.stringify(p));
      db.prepare('DELETE FROM review_findings WHERE review_id=?').run(p.id);
      p.findings.forEach((f,i)=>{
        db.prepare('INSERT INTO review_findings VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,i,f.title,f.status,f.evidence||'',f.reason||'',f.requestQuote||'',f.pricing?.estimatedHours||null,f.pricing?.suggestedCents||null,JSON.stringify(f.pricing?.assumptions||[]));
        (f.pricing?.tasks||[]).forEach((t,j)=>db.prepare('INSERT INTO finding_tasks VALUES(?,?,?,?,?,?)').run(p.id,i,j,t.name,t.hours,t.basis||''));
      });
    }else if(kind==='proposal'){
      p.created ||= now();
      if(p.reviewId){const parent=db.prepare('SELECT user_id,project_id FROM scope_reviews WHERE id=?').get(p.reviewId);if(!parent||parent.user_id!==owner||parent.project_id!==p.projectId)throw Error('Review ownership does not match.');}
      if(p.accepted&&!p.acceptedAt)p.acceptedAt=now();
      db.prepare(`INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,total_cents=excluded.total_cents,accepted_at=excluded.accepted_at,paypal_order_id=excluded.paypal_order_id,details_json=excluded.details_json`)
        .run(p.id,owner,p.projectId,p.reviewId||null,p.token,p.status,p.cents,'USD',p.acceptedAt||null,p.order||null,+!!p.demo,p.created,JSON.stringify(p));
      db.prepare('DELETE FROM proposal_items WHERE proposal_id=?').run(p.id);
      p.items.forEach((item,i)=>db.prepare('INSERT INTO proposal_items VALUES(?,?,?,?,?,?,?)').run(p.id,i,item.title,item.cents,item.pricing?.estimatedHours||null,item.pricing?.hourlyRate||null,item.pricing?JSON.stringify(item.pricing):null));
      if(p.status==='paid'&&p.capture){
        db.prepare(`INSERT INTO payments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(capture_id) DO UPDATE SET status=excluded.status`).run(p.capture,p.id,owner,p.order||null,p.cents,'USD','COMPLETED',p.paidAt||now());
      }
    }else if(kind==='connection'){
      db.prepare('INSERT INTO connections VALUES(?,?) ON CONFLICT(id) DO UPDATE SET details_json=excluded.details_json').run(p.id,JSON.stringify(p));
    }
    if(kind!=='connection'&&!existed)activity(owner,kind+'.created',p.id);
    return p;
  }
  const put=(kind,obj,userId)=>transaction(()=>write(kind,obj,userId));
  const legacy=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'").get();
  if(!db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()){
    transaction(()=>{
      if(legacy){
        for(const kind of ['project','review','proposal','connection']){
          for(const r of db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind))write(kind,JSON.parse(r.body));
        }
      }
      db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(now());
    });
  }
  function claimLegacy(userId){
    for(const [kind,table] of Object.entries(tables)){
      if(kind==='connection')continue;
      const rows=db.prepare(`SELECT id,details_json FROM ${table} WHERE user_id IS NULL`).all();
      for(const row of rows){const p=JSON.parse(row.details_json);p.userId=userId;db.prepare(`UPDATE ${table} SET user_id=?,details_json=? WHERE id=?`).run(userId,JSON.stringify(p),row.id);}
    }
    db.prepare('UPDATE payments SET user_id=? WHERE user_id IS NULL').run(userId);
    db.prepare('UPDATE activity_logs SET user_id=? WHERE user_id IS NULL').run(userId);
  }
  return {db,all,get,put,transaction,activity,claimLegacy,
    proposalByToken:token=>{const row=db.prepare('SELECT details_json FROM proposals WHERE access_token=?').get(token);return row?JSON.parse(row.details_json):null;},
    schemaSummary:()=>['users','sessions','projects','scope_reviews','review_findings','finding_tasks','proposals','proposal_items','payments','activity_logs'].map(name=>({table:name,count:db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n}))};
}
