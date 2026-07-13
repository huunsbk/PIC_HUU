WITH required_columns AS (
  SELECT unnest(ARRAY[
    'actor_account_id', 'actor_role', 'category', 'entity_type',
    'entity_id', 'result', 'reason', 'details_json'
  ]) AS column_name
), missing_columns AS (
  SELECT required_columns.column_name
  FROM required_columns
  LEFT JOIN information_schema.columns columns
    ON columns.table_schema = 'public'
   AND columns.table_name = 'audit_logs'
   AND columns.column_name = required_columns.column_name
  WHERE columns.column_name IS NULL
), required_indexes AS (
  SELECT unnest(ARRAY[
    'idx_audit_logs_tenant_created_at',
    'idx_audit_logs_actor_created_at'
  ]) AS index_name
), missing_indexes AS (
  SELECT required_indexes.index_name
  FROM required_indexes
  LEFT JOIN pg_indexes indexes
    ON indexes.schemaname = 'public'
   AND indexes.tablename = 'audit_logs'
   AND indexes.indexname = required_indexes.index_name
  WHERE indexes.indexname IS NULL
)
SELECT jsonb_build_object(
  'success',
    NOT EXISTS (SELECT 1 FROM missing_columns)
    AND NOT EXISTS (SELECT 1 FROM missing_indexes)
    AND has_function_privilege(
      'authenticated',
      'public.log_audit_event_v1(text,text,text,jsonb)'::regprocedure,
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.log_audit_event_v1(text,text,text,jsonb)'::regprocedure,
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.sanitize_audit_payload_v1(jsonb)'::regprocedure,
      'EXECUTE'
    ),
  'missing_columns', COALESCE((SELECT jsonb_agg(column_name) FROM missing_columns), '[]'::jsonb),
  'missing_indexes', COALESCE((SELECT jsonb_agg(index_name) FROM missing_indexes), '[]'::jsonb)
) AS structured_audit_contract_045;

