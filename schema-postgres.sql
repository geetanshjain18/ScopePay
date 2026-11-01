CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,
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
      id BIGSERIAL PRIMARY KEY,user_id TEXT REFERENCES users(id),
      event TEXT NOT NULL,entity_id TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_owner ON activity_logs(user_id,created_at);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS ordinal BIGSERIAL;

ALTER TABLE scope_reviews ADD COLUMN IF NOT EXISTS ordinal BIGSERIAL;

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS ordinal BIGSERIAL;

ALTER TABLE connections ADD COLUMN IF NOT EXISTS ordinal BIGSERIAL;

INSERT INTO schema_migrations(version,applied_at) VALUES(1,CURRENT_TIMESTAMP::text) ON CONFLICT(version) DO NOTHING;
