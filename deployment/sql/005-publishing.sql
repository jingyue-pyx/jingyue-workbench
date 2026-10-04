-- Run once with the schema owner. Runtime never creates tables.
-- Existing projects, accounts and drafts are untouched.
CREATE TABLE IF NOT EXISTS jingyue.publishing_state (
  owner_id uuid NOT NULL,
  resource_key text NOT NULL CHECK (length(resource_key) <= 128),
  revision bigint NOT NULL DEFAULT 1,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, resource_key),
  CHECK (octet_length(document::text) <= 12582912)
);
REVOKE ALL ON jingyue.publishing_state FROM PUBLIC;
-- Separately GRANT SELECT, INSERT, UPDATE, DELETE on this table to the
-- existing workbench runtime role. Do not give it DDL or account password access.
