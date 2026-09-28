-- Explicit migration, not executed at application startup. Existing projects
-- and their owner_id are unchanged. Run with the dedicated migration account.
BEGIN;
CREATE TABLE IF NOT EXISTS jingyue.accounts (
  id uuid PRIMARY KEY,
  username varchar(64) NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  password_hash text NOT NULL,
  legacy_owner boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_legacy_owner ON jingyue.accounts(legacy_owner) WHERE legacy_owner;
CREATE TABLE IF NOT EXISTS jingyue.account_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES jingyue.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS account_sessions_user ON jingyue.account_sessions(user_id);
CREATE TABLE IF NOT EXISTS jingyue.account_limits (
  bucket varchar(180) PRIMARY KEY,
  count integer NOT NULL CHECK(count > 0),
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON jingyue.accounts, jingyue.account_sessions, jingyue.account_limits FROM PUBLIC;
COMMIT;
