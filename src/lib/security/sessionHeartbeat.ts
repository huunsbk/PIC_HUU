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
  } catch (e) {
    console.warn('Heartbeat sync failed.');
  }
}

async function endSession() {
  try {
    await supabase.auth.signOut();
    window.location.reload();
  } catch (e) {
    console.warn('Session termination failed.');
  }
}
