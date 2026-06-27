import { createClient } from '@supabase/supabase-js';

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function getSupabaseClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    const error = new Error('Public Supabase env is not configured.');
    error.status = 500;
    throw error;
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const rawSlug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
    const slug = String(rawSlug || '').trim();
    if (!slug) return sendJson(res, 400, { error: 'Missing tournament slug.' });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('get_public_tournament_snapshot_v1', { p_slug: slug });

    if (error) {
      const message = error.message || 'Cannot load public tournament snapshot.';
      const status = /NOT_FOUND|not found/i.test(message) ? 404 : 500;
      return sendJson(res, status, { error: message });
    }

    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=5, stale-while-revalidate=20');
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=5, stale-while-revalidate=20');
    if (req.method === 'HEAD') return res.status(200).end();
    return sendJson(res, 200, data);
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'Server error.' });
  }
}
