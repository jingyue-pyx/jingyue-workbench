-- Apply after 006-app-auth.sql as jingyue_migrator in the existing jingyue DB.
-- Only the three new generated-application authentication tables are in scope.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'jingyue' THEN
    RAISE EXCEPTION 'Connect to the dedicated jingyue database';
  END IF;
END $$;
REVOKE ALL ON jingyue.app_auth_accounts, jingyue.app_auth_sessions, jingyue.app_auth_limits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON jingyue.app_auth_accounts, jingyue.app_auth_sessions, jingyue.app_auth_limits
  TO jingyue_app;
COMMIT;
