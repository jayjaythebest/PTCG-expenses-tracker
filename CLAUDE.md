# PTCG Expenses Tracker

## Project overview
"J Vault" (the name shown in the UI; the repo and DB still say PTCG) — a personal Pokémon TCG (Pokémon Trading Card Game) expense tracker — log card purchases with prices, categories, and receipt photos, and let a Gemini-powered assistant summarize spending.

## Tech stack
- React 19 + Vite 6 + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- Supabase — Postgres (expense rows) + Storage (receipt images, up to 5MB)
- `@google/genai` — Gemini API for summaries / insights
- `lucide-react`, `motion`, `date-fns`, `react-markdown`
- Deployed on **Vercel** (auto-deploy from `main`)

## Architecture
```
src/
  App.tsx                 # Top-level routing + layout
  main.tsx                # React entry
  components/
    Dashboard.tsx         # Summary view
    ExpenseForm.tsx       # Create / edit expense (incl. photo upload)
    ExpenseList.tsx       # List + filter
    Login.tsx             # Email/password sign-in — the whole app sits behind it
  lib/
    supabase.ts           # Supabase client (current source of truth)
    useExpenses.ts        # Data hook
    AuthContext.tsx       # Supabase Auth session -> UserProfile
    apiFetch.ts           # fetch wrapper that attaches the session JWT to /api calls
    utils.ts              # clsx/tw-merge helpers
  types.ts
supabase/
  schema.sql              # DB schema — keep in sync with Supabase project
  auth_lockdown.sql       # RLS + storage policies + allowed_users list
```

Receipts are stored in Supabase Storage; rows in the expenses table reference the storage path. The "add photo later" flow means an expense row can exist without a photo and be patched afterward — never assume the photo field is present.

## Auth & access control
The app is private. `App.tsx` renders `Login` until there is a Supabase session, and every table is guarded by RLS policies that require `authenticated` **and** an email listed in `public.allowed_users`. Public signup is turned off in the Supabase dashboard, so accounts are created by hand.

Granting someone access takes two steps, both in the dashboard: create the user under Authentication → Users, then add their email to `allowed_users`. No SQL or policy edits.

The cron endpoints (`api/weekly-summary.ts`, `api/snapshot-collection.ts`) use the service-role key, which bypasses RLS — tightening policies never breaks them. They authenticate with a `CRON_SECRET` bearer check, because Vercel Cron has no Supabase session.

Every other endpoint under `api/` spends paid AI quota or hits a rate-limited scraping source, and Vercel serves it to anyone who knows the deployment URL. So each one starts with `requireUser` from `api/_lib/auth.ts`, which verifies the caller's Supabase access token and otherwise answers 401. The 401 is sent with `Cache-Control: no-store` — these routes answer successes with `public, s-maxage=…`, and a cached 401 would lock signed-in users out for the whole TTL, so keep the `requireUser` call **above** the `setHeader` lines.

## Setup
Required env vars (see `.env.example`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY` (consumed via `process.env.GEMINI_API_KEY`, injected by `vite.config.ts`)

Local setup:
```bash
npm install
# create .env with the three vars above
npm run dev     # vite on :3000, host 0.0.0.0
```

## Dev / Build / Deploy
- **Dev:** `npm run dev` (port 3000)
- **Typecheck / lint:** `npm run lint` (runs `tsc --noEmit`)
- **Build:** `npm run build` → `dist/`
- **Preview build:** `npm run preview`
- **Deploy:** Pushing to `main` auto-deploys via Vercel — there is no manual deploy step.

### Deploy gotchas (bake these in)
- Vercel project env vars **must** include `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Missing either → Supabase client throws and the app shows a blank screen. Verify via `vercel env ls` before merging any change that touches env handling.
- Never *rename* `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` into the un-prefixed forms to satisfy a server-side need — add a second variable instead. Vercel hands every var to the function runtime regardless of prefix, but Vite only inlines `VITE_`-prefixed ones into the bundle, so renaming them white-screens the app on the next deploy.
- Server-side Supabase config resolves through `api/_lib/env.ts`, which falls back to the `VITE_*` pair for the URL. So only `SUPABASE_SERVICE_ROLE_KEY` (RLS bypass, crons) and `CRON_SECRET` / `RESEND_API_KEY` genuinely have to exist as separate vars. When config is absent the endpoints answer **503**, never 401/500 — `requireUser` sends `Auth not configured`, the crons send `Supabase not configured`. Handy check: `curl -H 'Authorization: Bearer x' <deployment>/api/fx` → 401 means the config is healthy, 503 means it isn't.
- `GEMINI_API_KEY` is read at build time by Vite (`define`). Changing the key requires a **redeploy**, not just a config update.
- Image upload limit is **5 MB** (raised from earlier default). If changing, update both the client-side validation and the Supabase Storage policy.

## Do NOT
- Do **not** reintroduce Firebase. The project was migrated off Firebase → Supabase and the last Firebase config files have been deleted.
- Do **not** commit `.env` or any Supabase service-role key. Only the anon key goes in the client.
- Do **not** write an RLS policy with `using (true)` or one granted `to public`/`to anon`. The anon key ships in the browser bundle, so such a policy hands the table to anyone who opens the site. Guard every policy with `to authenticated` + `public.is_allowed_user()`.
- Do **not** bypass the 5MB upload cap without also updating the Supabase Storage bucket policy — silent failures will follow.
- Do **not** call an `/api/` endpoint from the client with bare `fetch` — use `apiFetch` (`src/lib/apiFetch.ts`) so the Supabase JWT is attached, or the call comes back 401.
- Do **not** assume an expense row has a photo. The "add photo later" feature means `photo_path` may be null at any time.
- Do **not** manually run `vercel --prod` unless the user explicitly asks; deploys go through `main`.
- Do **not** edit generated files in `dist/`.

## Conventions
- Components in `src/components/`, PascalCase filenames.
- Shared hooks / clients in `src/lib/`, camelCase filenames.
- Styling is Tailwind utility classes; avoid adding CSS modules or styled-components.
- Keep Supabase queries co-located in `lib/useExpenses.ts` (or sibling hooks) — do not call `supabase` directly from components.
- No test suite today. If adding one, prefer Vitest (matches Vite toolchain).
- When changing `supabase/schema.sql`, also run the change in the Supabase project — the file is documentation of intent, not an auto-migrator.
