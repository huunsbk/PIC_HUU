DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.list_active_sports_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot read the public sport catalog';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.list_active_sports_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot read the sport catalog';
  END IF;
  IF jsonb_array_length(public.list_active_sports_v1()) < 3 THEN
    RAISE EXCEPTION 'expected at least three active set-based sports';
  END IF;
END;
$$;
