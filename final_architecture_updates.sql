-- final_architecture_updates.sql
-- Triển khai các Ưu tiên 3, 4, 5 theo chuẩn Enterprise Architecture

-- ==========================================
-- ƯU TIÊN 3: TẠO RPC get_bootstrap_context()
-- MỤC TIÊU: Lấy toàn bộ Context của User trong 1 lần gọi (Role, Permissions, Event Scopes)
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_bootstrap_context()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH auth_user AS (
    SELECT auth.uid() AS uid
  ),
  acc AS (
    SELECT a.*, r.name as role_name
    FROM accounts a
    LEFT JOIN roles r ON a.role_id = r.id
    WHERE a.user_id = (SELECT uid FROM auth_user)
    LIMIT 1
  ),
  acc_perms AS (
    SELECT jsonb_agg(p.name) as permissions
    FROM account_permissions ap
    JOIN permissions p ON ap.permission_id = p.id
    WHERE ap.account_id = (SELECT id FROM acc)
  ),
  role_perms AS (
    SELECT jsonb_agg(p.name) as permissions
    FROM role_permissions rp
    JOIN permissions p ON rp.permission_id = p.id
    WHERE rp.role_id = (SELECT role_id FROM acc)
  ),
  event_perms AS (
    SELECT jsonb_agg(jsonb_build_object('event_id', aep.event_id)) as events
    FROM account_event_permissions aep
    WHERE aep.account_id = (SELECT id FROM acc)
  )
  SELECT jsonb_build_object(
    'account', (SELECT row_to_json(acc.*) FROM acc),
    'account_permissions', COALESCE((SELECT permissions FROM acc_perms), '[]'::jsonb),
    'role_permissions', COALESCE((SELECT permissions FROM role_perms), '[]'::jsonb),
    'event_permissions', COALESCE((SELECT events FROM event_perms), '[]'::jsonb)
  )
  WHERE EXISTS (SELECT 1 FROM acc);
$$;

-- ==========================================
-- ƯU TIÊN 4: DATABASE TRIGGER CHO AUDIT LOGS
-- MỤC TIÊU: Frontend không Insert trực tiếp để tránh bypass hoặc new row violates RLS
-- ==========================================
CREATE OR REPLACE FUNCTION public.audit_matches_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_acc_id uuid;
  current_tenant_id uuid;
BEGIN
  -- Nếu system job hoặc service role, có thể auth.uid() null. Bỏ qua lấy account.
  IF current_user_id IS NOT NULL THEN
    SELECT id, tenant_id INTO current_acc_id, current_tenant_id
    FROM public.accounts
    WHERE user_id = current_user_id
    LIMIT 1;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (tenant_id, account_id, action, target_type, target_id, details)
    VALUES (NEW.tenant_id, current_acc_id, 'CREATE_MATCH', 'matches', NEW.id, jsonb_build_object('round', NEW.round, 'event_id', NEW.event_id));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.score_a IS DISTINCT FROM OLD.score_a OR NEW.score_b IS DISTINCT FROM OLD.score_b OR NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.audit_logs (tenant_id, account_id, action, target_type, target_id, details)
      VALUES (NEW.tenant_id, current_acc_id, 'UPDATE_MATCH_SCORE', 'matches', NEW.id, jsonb_build_object('score_a', NEW.score_a, 'score_b', NEW.score_b, 'status', NEW.status));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (tenant_id, account_id, action, target_type, target_id, details)
    VALUES (OLD.tenant_id, current_acc_id, 'DELETE_MATCH', 'matches', OLD.id, jsonb_build_object('round', OLD.round));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_matches ON public.matches;
CREATE TRIGGER trg_audit_matches
AFTER INSERT OR UPDATE OR DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.audit_matches_changes();


-- ==========================================
-- ƯU TIÊN 5: TÁCH RLS THÀNH CÁC OPERATION RIÊNG BIỆT (SELECT, INSERT, UPDATE, DELETE)
-- MỤC TIÊU: RBAC + Event Scope Constraint CHUẨN XÁC NHẤT
-- ==========================================

-- POLICY CHO BẢNG MATCHES
DROP POLICY IF EXISTS "matches_rls" ON matches;
DROP POLICY IF EXISTS "matches_select" ON matches;
DROP POLICY IF EXISTS "matches_insert" ON matches;
DROP POLICY IF EXISTS "matches_update" ON matches;
DROP POLICY IF EXISTS "matches_delete" ON matches;

-- SELECT: Guest trong Tenant đều xem được
CREATE POLICY "matches_select" ON matches FOR SELECT USING (
  tenant_id = public.current_tenant_id() OR public.current_role_name() = 'SUPER_ADMIN'
);

-- INSERT: Cần quyền manage_matches / manage_events VÀ trong Tenant
CREATE POLICY "matches_insert" ON matches FOR INSERT WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_permission('manage_matches')
        OR public.has_permission('manage_events')
     )
  )
);

-- UPDATE: Cần quyền nhập điểm (enter_score) HOẶC manage_matches. VÀ chỉ update được trận thuộc sự kiện được phân công (Event Scope)
CREATE POLICY "matches_update" ON matches FOR UPDATE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        -- RBAC + Scope Constraint
        OR (
          (public.has_permission('manage_matches') OR public.has_permission('enter_score'))
          AND public.has_event_access(event_id)
        )
     )
  )
);

-- DELETE: Chỉ Quản lý mới xóa được, không cấp quyền cho enter_score (Referee)
CREATE POLICY "matches_delete" ON matches FOR DELETE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_permission('manage_matches')
     )
  )
);

-- POLICY CHO BẢNG EVENTS
DROP POLICY IF EXISTS "events_rls" ON events;
DROP POLICY IF EXISTS "events_select" ON events;
DROP POLICY IF EXISTS "events_insert" ON events;
DROP POLICY IF EXISTS "events_update" ON events;
DROP POLICY IF EXISTS "events_delete" ON events;

CREATE POLICY "events_select" ON events FOR SELECT USING (
  tenant_id = public.current_tenant_id() OR public.current_role_name() = 'SUPER_ADMIN'
);
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (tenant_id = public.current_tenant_id() AND (public.current_role_name() = 'TENANT_ADMIN' OR public.has_permission('manage_events')))
);
CREATE POLICY "events_update" ON events FOR UPDATE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR (public.has_permission('manage_events') AND public.has_event_access(id))
     )
  )
);
CREATE POLICY "events_delete" ON events FOR DELETE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (tenant_id = public.current_tenant_id() AND (public.current_role_name() = 'TENANT_ADMIN' OR public.has_permission('manage_events')))
);
