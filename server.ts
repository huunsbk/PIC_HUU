import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Configuration
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://ykckqcykxfhpfqptckxk.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV === "production") {
    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables. Admin operations will fail.");
  }

  const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY 
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
      })
    : null;

  // Admin middleware to verify JWT
  const verifyToken = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // Validate with supabase (using normal anon or admin client, actually admin doesn't automatically validate token as the user, we need to get user)
    if (!supabaseAdmin) {
      res.status(500).json({ error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY not set' });
      return;
    }
    
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user) {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
      // Attach user to request
      (req as any).user = user;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token signature' });
    }
  };

  app.post("/api/admin/accounts", verifyToken, async (req, res) => {
    try {
      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

      const user = (req as any).user;
      const { email, password, username, displayName, role, tenantId, isSuperAdmin } = req.body;

      // 1. Double check permission (Verify the caller is actually an admin in the database)
      const { data: accountData } = await supabaseAdmin
        .from('accounts')
        .select('roles(name)')
        .eq('user_id', user.id)
        .single();
        
      const rolesObj: any = accountData?.roles;
      const roleName = rolesObj?.name || rolesObj?.[0]?.name;
      if (roleName !== 'SUPER_ADMIN' && roleName !== 'TENANT_ADMIN') {
        res.status(403).json({ error: 'Forbidden: Requires Admin privileges' });
        return;
      }

      // 2. Create auth user
      let targetAuthUserId = null;

      const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          display_name: displayName,
          role,
          tenant_id: tenantId
        }
      });

      if (createError) {
        if (createError.message.includes('already been registered') || createError.message.includes('already registered')) {
            const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
            if (listErr) throw new Error(`Lỗi cập nhật người dùng có sẵn: ${listErr.message}`);
            
            const existingUser = users.find((u: any) => u.email === email);
            if (existingUser) {
                targetAuthUserId = existingUser.id;
                await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
                  password,
                  user_metadata: { username, display_name: displayName, role, tenant_id: tenantId }
                });
            } else {
                throw new Error(`Lỗi tạo user (auth): ${createError.message}`);
            }
        } else {
            throw new Error(`Lỗi tạo user (auth): ${createError.message}`);
        }
      } else {
        targetAuthUserId = authData?.user?.id;
      }

      // Allow trigger to fire just in case
      await new Promise(r => setTimeout(r, 500));

      // 3. Obtain Role ID dynamically
      let roleQueryName = role;
      if (role === 'EVENT_MANAGER') roleQueryName = 'EVENT_ADMIN';

      let { data: roleRecord } = await supabaseAdmin.from('roles').select('id').eq('name', roleQueryName).single();
      let roleIdToUse = roleRecord?.id;
      
      if (!roleIdToUse) {
         const { data: newRole } = await supabaseAdmin.from('roles')
            .insert({ name: roleQueryName, description: 'Added automatically' })
            .select('id').single();
         roleIdToUse = newRole?.id;
      }
      
      if (!roleIdToUse) {
         throw new Error(`Tạo tài khoản bị lỗi do không tìm thấy Role_ID cho quyền: ${roleQueryName}`);
      }
      
      const { error: upsertError } = await supabaseAdmin.from('accounts').upsert({
        user_id: targetAuthUserId,
        tenant_id: tenantId,
        username,
        display_name: displayName,
        role_id: roleIdToUse,
        status: 'active'
      }, { onConflict: 'user_id' });

      if (upsertError) {
        console.error("Account upsert warning:", upsertError.message);
        throw new Error(`Tạo tài khoản bị lỗi khi đồng bộ dũ liệu: ${upsertError.message}`);
      }

      res.json({ success: true, user: authData?.user });

    } catch (error: any) {
      console.error("/api/admin/accounts error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/accounts/:id", verifyToken, async (req, res) => {
    try {
      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

      const user = (req as any).user;
      // 'id' is the row ID from 'accounts' table. We need the auth.users id (user_id) if we want to update auth password.
      const accountId = req.params.id;
      const { displayName, password, role, tenantId, status, isSuperAdmin, userId } = req.body;

      const { data: accountData } = await supabaseAdmin
        .from('accounts')
        .select('roles(name)')
        .eq('user_id', user.id)
        .single();
        
      const rolesObj: any = accountData?.roles;
      const roleName = rolesObj?.name || rolesObj?.[0]?.name;
      if (roleName !== 'SUPER_ADMIN' && roleName !== 'TENANT_ADMIN') {
        res.status(403).json({ error: 'Forbidden: Requires Admin privileges' });
        return;
      }

      let authUserId = userId;

      // Update auth.users if needed
      if (authUserId) {
        const updateData: any = {
          user_metadata: {
            display_name: displayName,
            role,
            tenant_id: tenantId
          }
        };

        if (password) {
          updateData.password = password;
        }

        const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
          authUserId,
          updateData
        );

        if (updateAuthError) {
          throw new Error(`Lỗi cập nhật auth: ${updateAuthError.message}`);
        }
      }

      // Update accounts table
      let roleQueryName = role;
      if (role === 'EVENT_MANAGER') roleQueryName = 'EVENT_ADMIN';

      let { data: roleRecord } = await supabaseAdmin.from('roles').select('id').eq('name', roleQueryName).single();
      let roleIdToUse = roleRecord?.id;
      
      if (!roleIdToUse) {
         const { data: newRole } = await supabaseAdmin.from('roles')
            .insert({ name: roleQueryName, description: 'Added automatically' })
            .select('id').single();
         roleIdToUse = newRole?.id;
      }
      
      if (!roleIdToUse) {
         throw new Error(`Cập nhật tài khoản bị lỗi do không tìm thấy Role_ID cho quyền: ${roleQueryName}`);
      }

      const { error: updateError } = await supabaseAdmin.from('accounts').update({
        display_name: displayName,
        role_id: roleIdToUse,
        tenant_id: tenantId,
        status: status,
        updated_at: new Date().toISOString()
      }).eq('id', accountId);

      if (updateError) {
        throw new Error(`Lỗi cập nhật account: ${updateError.message}`);
      }

      res.json({ success: true });

    } catch (error: any) {
      console.error("PUT /api/admin/accounts error:", error);
      res.status(500).json({ error: error.message });
    }
  });


  app.delete("/api/admin/accounts/:accountId", verifyToken, async (req, res) => {
    try {
      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

      const user = (req as any).user;
      const { accountId } = req.params;

      const { data: currentAcc } = await supabaseAdmin
        .from('accounts')
        .select('roles(name)')
        .eq('user_id', user.id)
        .single();
        
      const rolesObj: any = currentAcc?.roles;
      const roleName = rolesObj?.name || rolesObj?.[0]?.name;
      if (roleName !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Forbidden: Requires SUPER_ADMIN privileges' });
        return;
      }

      // Lấy tài khoản cần xóa
      const { data: targetAccount, error: fetchErr } = await supabaseAdmin
        .from('accounts')
        .select('user_id, username')
        .eq('id', accountId)
        .single();

      if (fetchErr || !targetAccount) {
         throw new Error('Không tìm thấy tài khoản để xóa');
      }

      // Xóa dữ liệu phụ thuộc (Session và Logs)
      await supabaseAdmin.from('active_sessions').delete().eq('account_id', accountId);
      await supabaseAdmin.from('login_logs').delete().eq('account_id', accountId);
      await supabaseAdmin.from('account_permissions').delete().eq('account_id', accountId);
      await supabaseAdmin.from('account_event_permissions').delete().eq('account_id', accountId);

      // Xóa trong bảng accounts trước
      const { error: deleteAccErr } = await supabaseAdmin
        .from('accounts')
        .delete()
        .eq('id', accountId);

      if (deleteAccErr) {
        throw new Error(`Lỗi khi xóa trong DB accounts: ${deleteAccErr.message}`);
      }

      // Thử xoá Auth User nếu user_id có tồn tại
      if (targetAccount.user_id) {
         await supabaseAdmin.auth.admin.deleteUser(targetAccount.user_id);
      } else {
         // Thử tìm theo email {username}@pic.com
         const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
         const tUser = users.find((u:any) => u.email === `${targetAccount.username}@pic.com`);
         if (tUser) {
            await supabaseAdmin.auth.admin.deleteUser(tUser.id);
         }
      }

      res.json({ success: true });

    } catch (error: any) {
      console.error("DELETE /api/admin/accounts error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/accounts/reset", verifyToken, async (req, res) => {
    try {
      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

      const user = (req as any).user;
      const { targetUsername, newPassword } = req.body;

      const { data: accountData } = await supabaseAdmin
        .from('accounts')
        .select('roles(name)')
        .eq('user_id', user.id)
        .single();
        
      const rolesObj: any = accountData?.roles;
      const roleName = rolesObj?.name || rolesObj?.[0]?.name;
      if (roleName !== 'SUPER_ADMIN' && roleName !== 'TENANT_ADMIN') {
        res.status(403).json({ error: 'Forbidden: Requires Admin privileges' });
        return;
      }

      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      if (listError) throw listError;

      const targetEmail = `${targetUsername}@pic.com`.toLowerCase();
      const targetUser = users.find((u: any) => u.email === targetEmail);

      if (!targetUser) {
        throw new Error(`Không tìm thấy người dùng với username: ${targetUsername}`);
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
        password: newPassword
      });

      if (updateError) throw updateError;

      res.json({ success: true });

    } catch (error: any) {
      console.error("POST /api/admin/accounts/reset error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Register active sessions and login logs securely using supabaseAdmin to bypass Client RLS
  app.post("/api/auth/record-login", verifyToken, async (req, res) => {
    try {
      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");

      const user = (req as any).user;
      const { account_id, ip_address, browser_info, device_info, session_token, expires_at } = req.body;

      if (!account_id) {
         res.status(400).json({ error: "Thiếu thông tin account_id" });
         return;
      }

      // Check if user has permission to log in as this account
      const { data: account, error: accErr } = await supabaseAdmin
        .from('accounts')
        .select('id, user_id, username')
        .eq('id', account_id)
        .single();

      if (accErr || !account) {
        res.status(400).json({ error: "Tài khoản không tồn tại" });
        return;
      }

      if (account.user_id !== user.id) {
        res.status(403).json({ error: "Không được phép: Tài khoản không khớp với người dùng đã xác thực" });
        return;
      }

      // 1. Delete existing sessions for this account_id to avoid unique constraint duplicates
      await supabaseAdmin.from("active_sessions").delete().eq("account_id", account_id);

      // 2. Insert active_sessions
      if (session_token && expires_at) {
        const { error: sessErr } = await supabaseAdmin.from("active_sessions").insert({
          account_id,
          session_token,
          ip_address: ip_address || "127.0.0.1",
          browser_info: browser_info || "Unknown",
          device_info: device_info || "Unknown",
          expires_at
        });
        if (sessErr) {
          throw new Error(`Lỗi ghi nhận phiên đăng nhập: ${sessErr.message}`);
        }
      }

      // 3. Insert login_logs to record this successful login session
      const { error: logErr } = await supabaseAdmin.from("login_logs").insert({
        account_id,
        action: "login",
        ip_address: ip_address || "127.0.0.1",
        browser_info: browser_info || "Unknown",
        device_info: device_info || "Unknown"
      });

      if (logErr) {
        throw new Error(`Lỗi ghi nhận nhật ký đăng nhập: ${logErr.message}`);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("record-login error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
