import { supabase } from '../../supabaseClient';

function normalizeProfile(profile: any) {
  return typeof profile === 'string' ? JSON.parse(profile) : profile;
}

export async function assertFreshEventPermission(eventId: string, permission: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }

  const { data, error } = await supabase.rpc('get_current_profile');
  if (error || !data) {
    throw new Error('Không tải được quyền hiện tại. Vui lòng đăng nhập lại.');
  }

  const profile = normalizeProfile(data);
  const role = profile?.role;
  if (role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN') return;

  const eventPermissions = Array.isArray(profile?.event_permissions) ? profile.event_permissions : [];
  const allowed = eventPermissions.some((row: any) => {
    const rowEventId = row?.event_id || row?.eventId;
    const permissions = Array.isArray(row?.permissions) ? row.permissions : [];
    return rowEventId === eventId && permissions.includes(permission);
  });

  if (!allowed) {
    throw new Error('Quyền tài khoản đã thay đổi. Bạn không còn quyền thực hiện thao tác này.');
  }
}
