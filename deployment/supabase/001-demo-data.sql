-- Run ONLY in the newly selected Supabase test project, never in workbench RDS.
-- Demo JSON documents, not arbitrary generated SQL or a generic database proxy.
BEGIN;
CREATE TABLE IF NOT EXISTS public.jingyue_demo_documents (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  data_key text NOT NULL CHECK (data_key ~ '^[a-z][a-z0-9_-]{0,47}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) IN ('object', 'array')),
  last_request uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, project_id, data_key),
  CHECK (octet_length(document::text) <= 70000)
);
ALTER TABLE public.jingyue_demo_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jingyue_demo_documents FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.jingyue_demo_data(
  p_owner uuid, p_project uuid, p_key text, p_action text,
  p_value jsonb DEFAULT NULL, p_revision bigint DEFAULT 0, p_request uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  row public.jingyue_demo_documents%ROWTYPE;
  total integer;
BEGIN
  IF p_owner IS NULL OR p_project IS NULL OR p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_-]{0,47}$'
    OR p_action IS NULL OR p_action NOT IN ('read', 'write') THEN RAISE EXCEPTION 'Invalid request'; END IF;
  IF p_action = 'write' THEN
    IF p_request IS NULL OR p_revision IS NULL OR p_revision < 0 OR p_value IS NULL
      OR jsonb_typeof(p_value) NOT IN ('object', 'array') THEN RAISE EXCEPTION 'Invalid document'; END IF;
    IF octet_length(p_value::text) > 70000 THEN RETURN jsonb_build_object('error', 'quota'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || p_project::text, 0));
  END IF;
  SELECT * INTO row FROM public.jingyue_demo_documents
    WHERE owner_id=p_owner AND project_id=p_project AND data_key=p_key;
  IF p_action = 'read' THEN
    RETURN jsonb_build_object('revision', coalesce(row.revision, 0), 'value', row.document, 'updatedAt', row.updated_at);
  END IF;
  -- A retry after a lost response must not duplicate a write. A reused request
  -- identifier with different content is rejected rather than reported saved.
  IF row.last_request = p_request THEN
    IF row.document <> p_value OR row.revision <> p_revision + 1 THEN RETURN jsonb_build_object('error', 'conflict'); END IF;
  ELSE
    IF coalesce(row.revision, 0) <> p_revision THEN RETURN jsonb_build_object('error', 'conflict'); END IF;
    IF row.revision IS NULL THEN
      SELECT count(*) INTO total FROM public.jingyue_demo_documents WHERE owner_id=p_owner AND project_id=p_project;
      IF total >= 20 THEN RETURN jsonb_build_object('error', 'quota'); END IF;
      INSERT INTO public.jingyue_demo_documents(owner_id,project_id,data_key,revision,document,last_request)
        VALUES(p_owner,p_project,p_key,1,p_value,p_request) RETURNING * INTO row;
    ELSE
      UPDATE public.jingyue_demo_documents SET document=p_value, revision=revision+1, last_request=p_request, updated_at=now()
        WHERE owner_id=p_owner AND project_id=p_project AND data_key=p_key RETURNING * INTO row;
    END IF;
  END IF;
  RETURN jsonb_build_object('revision', row.revision, 'value', row.document, 'updatedAt', row.updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.jingyue_demo_data(uuid,uuid,text,text,jsonb,bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jingyue_demo_data(uuid,uuid,text,text,jsonb,bigint,uuid) TO service_role;
COMMIT;
