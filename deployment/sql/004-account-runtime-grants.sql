-- Run after 003-accounts.sql as the migration owner in the dedicated DB.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'jingyue' THEN
    RAISE EXCEPTION 'Connect to the dedicated jingyue database';
  END IF;
END $$;
GRANT SELECT, INSERT ON jingyue.accounts TO jingyue_app;
GRANT UPDATE(display_name) ON jingyue.accounts TO jingyue_app;
GRANT SELECT, INSERT, DELETE ON jingyue.account_sessions TO jingyue_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jingyue.account_limits TO jingyue_app;
COMMIT;
