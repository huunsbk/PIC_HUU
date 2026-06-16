-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.tournament (
  id text NOT NULL DEFAULT 't-1'::text,
  name text NOT NULL,
  organization text,
  location text,
  date text,
  settings jsonb NOT NULL,
  current_event_id text DEFAULT 'event-default'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT tournament_pkey PRIMARY KEY (id)
);
CREATE TABLE public.events (
  id text NOT NULL,
  name text NOT NULL,
  settings jsonb NOT NULL,
  active_group_id text,
  advance_selection_mode text DEFAULT 'auto'::text,
  manual_qualified_team_ids jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  tenant_id uuid,
  tournament_id text,
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.teams (
  id text NOT NULL,
  name text NOT NULL,
  group_id text,
  seed text DEFAULT 'none'::text,
  event_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  tenant_id uuid,
  tournament_id text,
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT fk_teams_group FOREIGN KEY (group_id) REFERENCES public.groups(id),
  CONSTRAINT teams_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.groups (
  id text NOT NULL,
  name text NOT NULL,
  team_ids jsonb DEFAULT '[]'::jsonb,
  event_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  tenant_id uuid,
  tournament_id text,
  CONSTRAINT groups_pkey PRIMARY KEY (id),
  CONSTRAINT groups_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT groups_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.matches (
  id text NOT NULL,
  group_id text,
  team_a_id text,
  team_b_id text,
  score_a integer,
  score_b integer,
  winner_id text,
  status text DEFAULT 'pending'::text,
  round integer NOT NULL,
  knockout_round_name text,
  knockout_match_id text,
  next_match_id text,
  next_match_slot text CHECK (next_match_slot = ANY (ARRAY['A'::text, 'B'::text])),
  event_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  tenant_id uuid,
  tournament_id text,
  placeholder_a character varying,
  placeholder_b character varying,
  CONSTRAINT matches_pkey PRIMARY KEY (id),
  CONSTRAINT fk_matches_team_a FOREIGN KEY (team_a_id) REFERENCES public.teams(id),
  CONSTRAINT fk_matches_team_b FOREIGN KEY (team_b_id) REFERENCES public.teams(id),
  CONSTRAINT fk_matches_next_match FOREIGN KEY (next_match_id) REFERENCES public.matches(id),
  CONSTRAINT matches_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  timestamp text NOT NULL,
  action text NOT NULL,
  details text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  tenant_id uuid,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  slug character varying NOT NULL UNIQUE,
  status character varying DEFAULT 'active'::character varying CHECK (status::text = ANY (ARRAY['active'::character varying, 'suspended'::character varying, 'archived'::character varying]::text[])),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamp with time zone,
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL UNIQUE,
  description character varying,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL UNIQUE,
  description character varying,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT permissions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  username character varying NOT NULL UNIQUE,
  display_name character varying NOT NULL,
  status character varying DEFAULT 'active'::character varying CHECK (status::text = ANY (ARRAY['active'::character varying, 'inactive'::character varying, 'banned'::character varying]::text[])),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamp with time zone,
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT accounts_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id),
  CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.account_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT account_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT account_permissions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id),
  CONSTRAINT account_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);
CREATE TABLE public.account_event_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  event_id character varying NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  deleted_at timestamp with time zone,
  CONSTRAINT account_event_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT account_event_permissions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id)
);
CREATE TABLE public.active_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  session_token text NOT NULL UNIQUE,
  ip_address character varying,
  browser_info text,
  device_info text,
  last_seen_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT active_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT active_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id)
);
CREATE TABLE public.login_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  action character varying NOT NULL CHECK (action::text = ANY (ARRAY['login'::character varying, 'logout'::character varying, 'password_change'::character varying, 'forced_logout'::character varying]::text[])),
  ip_address character varying,
  browser_info text,
  device_info text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT login_logs_pkey PRIMARY KEY (id),
  CONSTRAINT login_logs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id)
);
CREATE TABLE public.subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL UNIQUE,
  description text,
  max_users integer NOT NULL DEFAULT 1,
  max_events integer NOT NULL DEFAULT 1,
  max_teams integer NOT NULL DEFAULT 50,
  storage_limit_mb integer NOT NULL DEFAULT 100,
  monthly_price numeric NOT NULL DEFAULT 0,
  yearly_price numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscription_plans_pkey PRIMARY KEY (id)
);
CREATE TABLE public.tenant_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status character varying NOT NULL DEFAULT 'trial'::character varying CHECK (status::text = ANY (ARRAY['trial'::character varying, 'active'::character varying, 'expired'::character varying, 'cancelled'::character varying, 'suspended'::character varying]::text[])),
  start_date timestamp with time zone NOT NULL DEFAULT now(),
  end_date timestamp with time zone,
  auto_renew boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tenant_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT tenant_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id)
);
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  invoice_number character varying UNIQUE,
  billing_period character varying,
  amount numeric NOT NULL,
  status character varying DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['pending'::character varying, 'paid'::character varying, 'cancelled'::character varying, 'failed'::character varying]::text[])),
  invoice_date timestamp with time zone DEFAULT now(),
  due_date timestamp with time zone,
  paid_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.tenant_subscriptions(id)
);
CREATE TABLE public.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  provider character varying,
  provider_transaction_id text,
  amount numeric NOT NULL,
  status character varying DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['success'::character varying, 'pending'::character varying, 'failed'::character varying]::text[])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id),
  CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.plan_features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  feature_key character varying NOT NULL,
  enabled boolean DEFAULT true,
  CONSTRAINT plan_features_pkey PRIMARY KEY (id),
  CONSTRAINT plan_features_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id)
);
