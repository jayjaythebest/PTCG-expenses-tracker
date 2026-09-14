// Read-only public build.
//
// `VITE_DEMO=1` produces the build that sits behind the public demo URL: the
// collection gallery and nothing else. It reads `public.collection_public`, a
// column-filtered view that is the ONLY object the anon key is granted SELECT
// on (see supabase/public_demo.sql) — 買入價 and 備註 are not columns of that
// view, so they cannot leak even if someone queries the REST endpoint directly.
//
// The read boundary is enforced in the database. The UI gating that keys off
// IS_DEMO is a separate concern: it stops the demo from rendering buttons whose
// writes the database would reject anyway, and hides the collection's absolute
// total (per-card market prices stay — those are public market data; the sum is
// a personal asset figure).
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

// The relation the gallery reads from. The demo can only see the view.
export const COLLECTION_SOURCE = IS_DEMO ? 'collection_public' : 'collection_items';

// Unreachable through the demo UI — every write control is unmounted. Kept as a
// second line of defence so a future caller fails loudly here instead of firing
// a request that RLS silently rejects.
export function readOnly(): never {
  throw new Error('唯讀展示版本，無法修改資料');
}
