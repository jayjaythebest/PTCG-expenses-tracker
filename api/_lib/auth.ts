import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Shared JWT gate for the /api endpoints that spend paid AI quota or hammer a
// rate-limited upstream source. Vercel serves these routes to anyone who knows
// the deployment URL, so each one verifies the caller's Supabase access token
// (issued by the app's email/password login) before doing any work.
//
//   if (!(await requireUser(req, res))) return;   // 401 already sent
//
// The cron endpoints (weekly-summary, snapshot-collection) do NOT use this —
// they carry CRON_SECRET instead, since Vercel Cron has no Supabase session.

let admin: SupabaseClient | null = null;

function adminClient(): SupabaseClient {
  admin ??= createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return admin;
}

function bearerToken(req: VercelRequest): string {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? (token ?? '').trim() : '';
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
// false and sends a 401 when the token is missing, expired, or not ours — the
// caller must return immediately without writing to `res`.
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) return reject(res);

  try {
    const { data, error } = await adminClient().auth.getUser(token);
    if (error || !data.user) return reject(res);
    return true;
  } catch {
    return reject(res);
  }
}
