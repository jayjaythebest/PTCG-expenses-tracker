# PTCG Expenses Tracker

## Project overview
A personal Pokémon TCG (Pokémon Trading Card Game) expense tracker — log card purchases with prices, categories, and receipt photos, and let a Gemini-powered assistant summarize spending.

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
  lib/
    supabase.ts           # Supabase client (current source of truth)
    useExpenses.ts        # Data hook
    AuthContext.tsx       # Auth state
    firebase.ts           # LEGACY — kept from pre-migration; do not add to
    utils.ts              # clsx/tw-merge helpers
  types.ts
supabase/
  schema.sql              # DB schema — keep in sync with Supabase project
```

Receipts are stored in Supabase Storage; rows in the expenses table reference the storage path. The "add photo later" flow means an expense row can exist without a photo and be patched afterward — never assume the photo field is present.

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
- `GEMINI_API_KEY` is read at build time by Vite (`define`). Changing the key requires a **redeploy**, not just a config update.
- Image upload limit is **5 MB** (raised from earlier default). If changing, update both the client-side validation and the Supabase Storage policy.

## Do NOT
- Do **not** reintroduce Firebase. The project was migrated off Firebase → Supabase; `src/lib/firebase.ts` is legacy and should only be deleted, not extended.
- Do **not** commit `.env` or any Supabase service-role key. Only the anon key goes in the client.
- Do **not** bypass the 5MB upload cap without also updating the Supabase Storage bucket policy — silent failures will follow.
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
