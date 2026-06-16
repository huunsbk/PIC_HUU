-- migration_event_management.sql

DO $$
BEGIN
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slug text;
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS archived_at timestamptz;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON public.events(slug);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_tenant_status ON public.events(tenant_id, status);
