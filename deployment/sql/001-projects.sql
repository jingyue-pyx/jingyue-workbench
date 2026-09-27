BEGIN;
CREATE SCHEMA IF NOT EXISTS jingyue;
CREATE TABLE IF NOT EXISTS jingyue.projects (
  owner_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  byte_count integer NOT NULL CHECK (byte_count >= 0 AND byte_count <= 4194304),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  legacy_source_id uuid,
  legacy_chat_id varchar(256),
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, legacy_source_id, legacy_chat_id)
);
CREATE INDEX IF NOT EXISTS projects_owner_updated ON jingyue.projects (owner_id, updated_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS jingyue.project_mutations (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, request_id)
);
CREATE INDEX IF NOT EXISTS project_mutations_owner_created ON jingyue.project_mutations (owner_id, created_at);
COMMIT;

-- Apply explicitly with an authorized migration account. The runtime role
-- needs USAGE on schema jingyue and SELECT/INSERT/UPDATE/DELETE on these two
-- tables only. Do not run DDL on cold start or grant CREATE/superuser rights.
