import { supabase } from './supabase';

// The quota-consuming /api endpoints verify the caller's Supabase JWT (see
// api/_lib/auth.ts), so every browser call must carry the current session's
// access token. getSession() refreshes an expired token before returning it.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return fetch(path, { ...init, headers });
}
