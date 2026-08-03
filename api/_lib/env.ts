// Supabase connection details for everything under api/.
//
// Vercel injects EVERY project env var into the function runtime, `VITE_`
// prefix or not — the prefix only controls what Vite inlines into the browser
// bundle at build time. So the frontend's VITE_SUPABASE_URL doubles as a
// fallback here, and the server keeps working on deployments that only ever
// received the VITE_* pair (renaming those two away breaks the whole app, so
// they are the one thing guaranteed to be present).

export function supabaseUrl(): string {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
}

// Service-role key: bypasses RLS. Only the cron endpoints use it, because they
// run without a user session and so cannot satisfy the allowed_users policies.
// Deliberately has NO fallback — an anon/publishable key would silently read
// back zero rows and write nothing, which looks like "you own no cards" rather
// than a misconfiguration.
export function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
}

// Verifying a JWT via auth.getUser(token) works with any valid project key, so
// the request gate can fall back to the public anon/publishable key.
export function tokenVerifyKey(): string {
  return (
    serviceRoleKey() ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  );
}
