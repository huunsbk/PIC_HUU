CREATE OR REPLACE FUNCTION public.record_login_session(
    p_account_id UUID,
    p_session_token TEXT,
    p_ip_address TEXT,
    p_browser_info TEXT,
    p_device_info TEXT,
    p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_account_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    -- Kiểm tra account có tồn tại và thuộc về user đang đăng nhập không
    SELECT user_id INTO v_account_user_id 
    FROM accounts 
    WHERE id = p_account_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tài khoản không tồn tại.');
    END IF;
    
    IF v_account_user_id != v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Không được phép: Tài khoản không khớp với người dùng đã xác thực.');
    END IF;

    -- Xóa các session cũ để tránh Unique Constraint (nếu cần thiết, hoặc để dọn dẹp)
    DELETE FROM active_sessions WHERE account_id = p_account_id;
    
    -- Ghi nhận active_session
    INSERT INTO active_sessions (account_id, session_token, ip_address, browser_info, device_info, expires_at)
    VALUES (p_account_id, p_session_token, p_ip_address, p_browser_info, p_device_info, p_expires_at);
    
    -- Ghi nhận login_log
    INSERT INTO login_logs (account_id, action, ip_address, browser_info, device_info)
    VALUES (p_account_id, 'login', p_ip_address, p_browser_info, p_device_info);

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
