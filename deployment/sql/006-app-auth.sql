BEGIN;
-- Generated-application identities are NOT workbench accounts. Passwords and
-- Supabase tokens never enter these tables; Supabase Auth owns credentials.
CREATE TABLE IF NOT EXISTS jingyue.app_auth_accounts (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  username varchar(32) NOT NULL,
  remote_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, project_id, username),
  FOREIGN KEY (owner_id, project_id) REFERENCES jingyue.projects(owner_id,id)
);
CREATE TABLE IF NOT EXISTS jingyue.app_auth_sessions (
  token_hash char(64) PRIMARY KEY,
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  remote_id uuid NOT NULL,
  credential_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (owner_id, project_id) REFERENCES jingyue.projects(owner_id,id)
);
CREATE INDEX IF NOT EXISTS app_auth_sessions_project ON jingyue.app_auth_sessions(owner_id,project_id,remote_id);
CREATE TABLE IF NOT EXISTS jingyue.app_auth_limits (
  bucket varchar(200) PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
COMMIT;
-- Apply explicitly using the migration role. Runtime needs only scoped DML
-- on these three tables. This migration is not applied to production at boot.
