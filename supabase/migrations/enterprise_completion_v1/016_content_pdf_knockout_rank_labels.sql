-- Content PDF follow-up: use rank-slot labels in knockout seeds.
BEGIN;

CREATE OR REPLACE FUNCTION public.p12_rank_label_v1(p_rank integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'Hạng ' || COALESCE(p_rank, 0)::text
$$;

CREATE OR REPLACE FUNCTION public.p12_knockout_seed_label_v1(
  p_source text,
  p_group_name text,
  p_group_rank integer,
  p_suggested_seed integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_group_label text;
BEGIN
  v_group_label := trim(regexp_replace(COALESCE(p_group_name, ''), '^Bảng\s+', '', 'i'));

  IF p_source = 'best_third' THEN
    RETURN 'Hạng 3 xuất sắc ' || COALESCE(p_suggested_seed::text, '');
  END IF;

  IF COALESCE(p_group_rank, 0) > 0 AND v_group_label <> '' THEN
    RETURN public.p12_rank_label_v1(p_group_rank) || ' bảng ' || v_group_label;
  END IF;

  RETURN 'Seed ' || COALESCE(p_suggested_seed::text, '');
END;
$$;

UPDATE public.event_knockout_selections eks
SET seed_label = public.p12_knockout_seed_label_v1(
      eks.source,
      (
        SELECT g.name
        FROM public.groups g
        WHERE g.id = eks.source_group_id
          AND g.event_id = eks.event_id
          AND g.tenant_id = eks.tenant_id
          AND g.deleted_at IS NULL
        LIMIT 1
      ),
      eks.group_rank,
      eks.seed
    ),
    seed_source = CASE
      WHEN COALESCE(eks.seed_source, '{}'::jsonb) = '{}'::jsonb THEN jsonb_build_object(
        'source_type', COALESCE(eks.source, 'admin'),
        'group_id', eks.source_group_id,
        'rank', eks.group_rank,
        'third_best_index', CASE WHEN eks.source = 'best_third' THEN eks.seed ELSE NULL END
      )
      ELSE eks.seed_source
    END,
    resolved_team_id = COALESCE(eks.resolved_team_id, eks.team_id),
    updated_at = now()
WHERE eks.deleted_at IS NULL
  AND eks.source IN ('group_rank', 'best_third');

UPDATE public.matches m
SET placeholder_a = COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_a),
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(m.metadata, '{}'::jsonb),
          '{seed_label_a}',
          to_jsonb(COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_a, 'Seed')),
          true
        ),
        '{seed_source_a}',
        COALESCE(eks.seed_source, '{}'::jsonb),
        true
      ),
      '{resolved_team_id_a}',
      COALESCE(to_jsonb(COALESCE(eks.resolved_team_id, eks.team_id)), 'null'::jsonb),
      true
    )
FROM public.event_knockout_selections eks
WHERE m.group_id = 'knockout'
  AND m.round = 1
  AND m.deleted_at IS NULL
  AND eks.deleted_at IS NULL
  AND eks.source IN ('group_rank', 'best_third')
  AND m.event_id = eks.event_id
  AND m.tenant_id = eks.tenant_id
  AND m.team_a_id = COALESCE(eks.resolved_team_id, eks.team_id);

UPDATE public.matches m
SET placeholder_b = COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_b),
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(m.metadata, '{}'::jsonb),
          '{seed_label_b}',
          to_jsonb(COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_b, 'Seed')),
          true
        ),
        '{seed_source_b}',
        COALESCE(eks.seed_source, '{}'::jsonb),
        true
      ),
      '{resolved_team_id_b}',
      COALESCE(to_jsonb(COALESCE(eks.resolved_team_id, eks.team_id)), 'null'::jsonb),
      true
    )
FROM public.event_knockout_selections eks
WHERE m.group_id = 'knockout'
  AND m.round = 1
  AND m.deleted_at IS NULL
  AND eks.deleted_at IS NULL
  AND eks.source IN ('group_rank', 'best_third')
  AND m.event_id = eks.event_id
  AND m.tenant_id = eks.tenant_id
  AND m.team_b_id = COALESCE(eks.resolved_team_id, eks.team_id);

COMMIT;
