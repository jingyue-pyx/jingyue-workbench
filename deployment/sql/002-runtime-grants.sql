-- MANUAL ADMIN STEP, after 001-projects.sql and after the user creates the
-- ordinary (not high-privilege) runtime role jingyue_app in the RDS console.
-- Contains no credentials. This script is for the NEW dedicated database
-- named jingyue only. Review names before running; do not use a shared DB.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'jingyue' THEN
    RAISE EXCEPTION 'Connect to the dedicated jingyue database before granting permissions';
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA jingyue FROM PUBLIC;
REVOKE ALL ON TABLE jingyue.projects, jingyue.project_mutations FROM PUBLIC;
GRANT CONNECT ON DATABASE jingyue TO jingyue_app;
GRANT USAGE ON SCHEMA jingyue TO jingyue_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE jingyue.projects, jingyue.project_mutations TO jingyue_app;
COMMIT;

-- Verify as an administrator; expected: false, true, true, false.
SELECT
  has_schema_privilege('jingyue_app', 'public', 'CREATE') AS runtime_can_create_in_public,
  has_schema_privilege('jingyue_app', 'jingyue', 'USAGE') AS runtime_can_use_project_schema,
  (has_table_privilege('jingyue_app', 'jingyue.projects', 'SELECT')
   AND has_table_privilege('jingyue_app', 'jingyue.projects', 'INSERT')
   AND has_table_privilege('jingyue_app', 'jingyue.projects', 'UPDATE')
   AND has_table_privilege('jingyue_app', 'jingyue.projects', 'DELETE')
   AND has_table_privilege('jingyue_app', 'jingyue.project_mutations', 'SELECT')
   AND has_table_privilege('jingyue_app', 'jingyue.project_mutations', 'INSERT')
   AND has_table_privilege('jingyue_app', 'jingyue.project_mutations', 'UPDATE')
   AND has_table_privilege('jingyue_app', 'jingyue.project_mutations', 'DELETE')) AS runtime_can_use_projects,
  has_schema_privilege('jingyue_app', 'jingyue', 'CREATE') AS runtime_can_create_in_project_schema;
