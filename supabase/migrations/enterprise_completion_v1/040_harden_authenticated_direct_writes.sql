-- Security Gate 4D: authenticated users must mutate core data through scoped RPC/API only.
-- This migration intentionally keeps SELECT grants and RPC EXECUTE grants unchanged.

DO $$
DECLARE
  table_name text;
  tables_to_harden text[] := ARRAY[
    'accounts',
    'account_event_permissions',
    'active_sessions',
    'audit_logs',
    'events',
    'groups',
    'knockout_slots',
    'matches',
    'match_sets',
    'teams',
    'tenants',
    'tournament'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables_to_harden LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated',
        table_name
      );
    END IF;
  END LOOP;
END $$;
