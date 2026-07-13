SELECT jsonb_build_object(
  'success',
    has_function_privilege(
      'authenticated',
      'public.can_access_workspace_v1(text)'::regprocedure,
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.can_access_workspace_v1(text)'::regprocedure,
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.record_security_audit_v1(text,text,text,text,text,jsonb)'::regprocedure,
      'EXECUTE'
    ),
  'denial_window_minutes', 5
) AS workspace_denial_audit_046;

