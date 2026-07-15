import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../supabaseClient';
import { bootstrapSelfServiceCustomer } from '../api/commercial';

export type CurrentProfile = Record<string, any>;

function parseProfile(value: unknown): CurrentProfile | null {
  if (!value) return null;
  if (typeof value === 'string') return JSON.parse(value) as CurrentProfile;
  return value as CurrentProfile;
}

function sessionUsesGoogle(session: Session | null) {
  if (!session?.user) return false;
  const providers = new Set([
    session.user.app_metadata?.provider,
    ...(Array.isArray(session.user.app_metadata?.providers)
      ? session.user.app_metadata.providers
      : []),
    ...(Array.isArray(session.user.identities)
      ? session.user.identities.map((identity) => identity.provider)
      : []),
  ].filter(Boolean));
  return providers.has('google');
}

export async function loadCurrentProfile(options: {
  session?: Session | null;
  bootstrapGoogle?: boolean;
} = {}) {
  const { data: profileValue, error: profileError } = await supabase.rpc('get_current_profile');
  const profile = parseProfile(profileValue);

  if (!profileError && profile) {
    return profile;
  }

  const session = options.session
    ?? (await supabase.auth.getSession()).data.session;

  if (!options.bootstrapGoogle || !sessionUsesGoogle(session)) {
    if (profileError) throw profileError;
    return null;
  }

  await bootstrapSelfServiceCustomer(session!);

  const { data: bootstrappedValue, error: bootstrappedError } = await supabase.rpc('get_current_profile');
  if (bootstrappedError) throw bootstrappedError;
  return parseProfile(bootstrappedValue);
}
