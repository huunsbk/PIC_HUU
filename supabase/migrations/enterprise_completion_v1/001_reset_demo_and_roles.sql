-- Enterprise Completion V1 - Prompt 03
-- Reset demo business data and standardize the role/permission foundation.
--
-- Safety rules:
-- - This migration never deletes from auth.users.
-- - It deletes only demo/business rows from the listed public tables when they exist.
-- - It stops if no active SUPER_ADMIN account linked to auth.users remains.
-- - RAISE NOTICE lines provide a pre-reset count trail in the migration output.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.roles (id, name, description)
VALUES
  (gen_random_uuid(), 'SUPER_ADMIN', 'System-wide administrator with full access'),
  (gen_random_uuid(), 'TENANT_ADMIN', 'Tenant administrator scoped to one tenant'),
  (gen_random_uuid(), 'EVENT_ADMIN', 'Event administrator scoped through account_event_permissions'),
  (gen_random_uuid(), 'REFEREE', 'Referee scoped to assigned event score entry'),
  (gen_random_uuid(), 'VIEWER', 'Read-only public viewer')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = timezone('utc'::text, now());

DO $$
DECLARE
  v_event_admin_role_id uuid;
  v_event_manager_role_id uuid;
BEGIN
  SELECT id INTO v_event_admin_role_id
  FROM public.roles
  WHERE name = 'EVENT_ADMIN'
  LIMIT 1;

  SELECT id INTO v_event_manager_role_id
  FROM public.roles
  WHERE name = 'EVENT_' || 'MANAGER'
  LIMIT 1;

  IF v_event_manager_role_id IS NOT NULL THEN
    UPDATE public.accounts
    SET role_id = v_event_admin_role_id,
        updated_at = timezone('utc'::text, now())
    WHERE role_id = v_event_manager_role_id;

    DELETE FROM public.role_permissions
    WHERE role_id = v_event_manager_role_id;

    DELETE FROM public.roles
    WHERE id = v_event_manager_role_id;
  END IF;
END $$;

INSERT INTO public.permissions (id, name, description)
VALUES
  (gen_random_uuid(), '*', 'All permissions'),
  (gen_random_uuid(), 'manage_tenants', 'Manage tenants'),
  (gen_random_uuid(), 'manage_accounts', 'Manage accounts within allowed scope'),
  (gen_random_uuid(), 'manage_tournaments', 'Manage tournament workspaces'),
  (gen_random_uuid(), 'manage_events', 'Manage competition events within allowed scope'),
  (gen_random_uuid(), 'manage_teams', 'Manage teams within allowed scope'),
  (gen_random_uuid(), 'manage_groups', 'Manage groups within allowed scope'),
  (gen_random_uuid(), 'manage_matches', 'Manage matches and brackets within allowed scope'),
  (gen_random_uuid(), 'enter_scores', 'Enter and reset match scores within allowed scope'),
  (gen_random_uuid(), 'view_audit_logs', 'View audit logs within allowed scope'),
  (gen_random_uuid(), 'view_public', 'View public tournament information'),
  (gen_random_uuid(), 'manage_billing', 'Manage billing within allowed scope')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;

DELETE FROM public.permissions
WHERE name NOT IN (
  '*',
  'manage_tenants',
  'manage_accounts',
  'manage_tournaments',
  'manage_events',
  'manage_teams',
  'manage_groups',
  'manage_matches',
  'enter_scores',
  'view_audit_logs',
  'view_public',
  'manage_billing'
);

DELETE FROM public.role_permissions
WHERE role_id IN (
  SELECT id
  FROM public.roles
  WHERE name IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'VIEWER')
);

WITH matrix(role_name, permission_name) AS (
  VALUES
    ('SUPER_ADMIN', '*'),
    ('TENANT_ADMIN', 'manage_accounts'),
    ('TENANT_ADMIN', 'manage_tournaments'),
    ('TENANT_ADMIN', 'manage_events'),
    ('TENANT_ADMIN', 'manage_teams'),
    ('TENANT_ADMIN', 'manage_groups'),
    ('TENANT_ADMIN', 'manage_matches'),
    ('TENANT_ADMIN', 'enter_scores'),
    ('TENANT_ADMIN', 'view_audit_logs'),
    ('TENANT_ADMIN', 'view_public'),
    ('TENANT_ADMIN', 'manage_billing'),
    ('EVENT_ADMIN', 'manage_events'),
    ('EVENT_ADMIN', 'manage_teams'),
    ('EVENT_ADMIN', 'manage_groups'),
    ('EVENT_ADMIN', 'manage_matches'),
    ('EVENT_ADMIN', 'enter_scores'),
    ('EVENT_ADMIN', 'view_public'),
    ('REFEREE', 'enter_scores'),
    ('REFEREE', 'view_public'),
    ('VIEWER', 'view_public')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM matrix m
JOIN public.roles r ON r.name = m.role_name
JOIN public.permissions p ON p.name = m.permission_name
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE
  v_table text;
  v_count bigint;
  v_tables text[] := ARRAY[
    'public.payments',
    'public.invoices',
    'public.tenant_subscriptions',
    'public.matches',
    'public.teams',
    'public.groups',
    'public.account_event_permissions',
    'public.audit_logs',
    'public.events',
    'public.tournament'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(v_table) IS NULL THEN
      RAISE NOTICE 'Skipping missing table: %', v_table;
    ELSE
      EXECUTE format('SELECT count(*) FROM %s', v_table) INTO v_count;
      RAISE NOTICE 'Pre-reset count for %: %', v_table, v_count;
      EXECUTE format('DELETE FROM %s', v_table);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    JOIN auth.users u ON u.id = a.user_id
    WHERE r.name = 'SUPER_ADMIN'
      AND a.status = 'active'
      AND a.deleted_at IS NULL
      AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Safety stop: no active SUPER_ADMIN account linked to auth.users remains.';
  END IF;

  IF (SELECT count(*) FROM auth.users WHERE deleted_at IS NULL) < 1 THEN
    RAISE EXCEPTION 'Safety stop: auth.users has no active users.';
  END IF;
END $$;

COMMIT;
