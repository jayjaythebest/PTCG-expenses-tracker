import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, tokenVerifyKey } from './env.js';

// Shared JWT gate for the /api endpoints that spend paid AI quota or hammer a
// rate-limited upstream source. Vercel serves these routes to anyone who knows
// the deployment URL, so each one verifies the caller's Supabase access token
// (issued by the app's email/password login) before doing any work.
//
//   if (!(await requireUser(req, res))) return;   // 401/503 already sent
//
// The cron endpoints (weekly-summary, snapshot-collection) do NOT use this —
// they carry CRON_SECRET instead, since Vercel Cron has no Supabase session.

let admin: SupabaseClient | null = null;

function adminClient(url: string, key: string): SupabaseClient {
  admin ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

function bearerToken(req: VercelRequest): string {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? (token ?? '').trim() : '';
}

// A missing URL/key is a *server misconfiguration*, not a bad caller. Answering
// 401 here (which is what an unguarded createClient throw used to produce) locks
// every signed-in user out and looks identical to an expired token, so the real
// cause stays invisible. 503 makes it obvious from the outside — curl the route
// with a junk bearer token: 401 means the config is healthy, 503 means it isn't.
function misconfigured(res: VercelResponse): false {
  console.error(
    '[auth] missing Supabase config: set SUPABASE_URL (or VITE_SUPABASE_URL) and ' +
      'SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)',
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({ error: 'Auth not configured' });
  return false;
}

function reject(res: VercelResponse): false {
  // Never let a 401 into the edge cache: most of these routes answer successful
  // requests with `Cache-Control: public, s-maxage=…`, and a cached 401 would
  // lock signed-in users out of the route for the whole TTL.
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// Verifies the `Authorization: Bearer <supabase access token>` header. Returns
// false after sending 401 (token missing, expired, or not ours) or 503 (server
// has no Supabase config) — the caller must return immediately without writing
// to `res`.
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const url = supabaseUrl();
  const key = tokenVerifyKey();
  if (!url || !key) return misconfigured(res);

  const token = bearerToken(req);
  if (!token) return reject(res);

  try {
    const { data, error } = await adminClient(url, key).auth.getUser(token);
    if (error || !data.user) return reject(res);
    return true;
  } catch {
    return reject(res);
  }
}
