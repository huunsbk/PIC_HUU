import { supabase } from '../../supabaseClient';

let lastActivity = Date.now();
let heartbeatInterval: any;

export function initSessionHeartbeat() {
  if (typeof window === 'undefined') return;

  const updateActivity = () => {
    lastActivity = Date.now();
  };

  window.addEventListener('mousemove', updateActivity);
  window.addEventListener('keydown', updateActivity);
  window.addEventListener('click', updateActivity);
  
  heartbeatInterval = setInterval(async () => {
    const idleTime = Date.now() - lastActivity;
    
    // 30 minutes
    if (idleTime > 30 * 60 * 1000) {
      await endSession();
    } else {
      await updateHeartbeat();
    }
  }, 60000); // Check and pulse every 60s
}

async function updateHeartbeat() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;
    
    // Updates last_seen_at passively utilizing security invoker
    await supabase.from('active_sessions').update({ 
      last_seen_at: new Date().toISOString() 
    }).eq('session_token', data.session.access_token);
  } catch (e) {
    console.warn('Heartbeat sync failed.');
  }
}

async function endSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
       await supabase.from('active_sessions')
          .delete()
          .eq('session_token', data.session.access_token);
    }
    await supabase.auth.signOut();
    window.location.reload();
  } catch (e) {
    console.warn('Session termination failed.');
  }
}
