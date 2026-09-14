-- ============================================================
-- PTCG Expenses Tracker — public read-only collection view
-- Run this ONCE in your Supabase project's SQL Editor, AFTER
-- auth_lockdown.sql. Safe to re-run (idempotent).
--
-- What this is for: a public demo build of the app (VITE_DEMO=1,
-- see src/lib/demo.ts) shows the card gallery to anyone with the
-- link — a portfolio piece, reachable from a CV. It ships the
-- anon key like any Supabase app, so the anon key must be able to
-- read the gallery and NOTHING else.
--
-- auth_lockdown.sql already shuts anon out of every table. This
-- file adds exactly one readable object back: a view.
--
-- WHY A VIEW AND NOT A POLICY. RLS filters rows, not columns. An
-- anon SELECT policy on collection_items would hand out
-- purchase_price and notes to anyone who queries the REST endpoint
-- directly — the app not rendering them is irrelevant. A view is
-- the only way to drop columns.
--
-- WHAT IS WITHHELD:
--   purchase_price  — what Jay paid. Never leaves the DB.
--   notes           — free text; can name sellers, prices, people.
--   grading_cert    — a slab's cert number ties back to a
--                     submission record.
-- They are selected as NULL rather than omitted so the view has
-- the same shape as the table and the client's mapRow() is shared.
--
-- WHAT IS SHOWN: card identity, artwork, grading, quantity, and
-- market price. Market prices are scraped public market data, not
-- personal information. The collection's TOTAL is a personal asset
-- figure — the demo UI does not render it (see Collection.tsx),
-- though anyone could sum the rows, which is an accepted tradeoff.
--
-- WHOSE CARDS: only the account holder's. The account is shared
-- with another collector who files cards under their own owner tab
-- (see collection_schema.sql) — publishing someone else's
-- collection is not ours to do, so the view filters to 'jay'.
-- Keep this in sync with PRIMARY_OWNER in
-- src/data/collectionOwners.ts.
-- ============================================================

-- security_invoker = off (the default, set explicitly because it is
-- load-bearing): the view runs as its owner, so it can read
-- collection_items despite that table's authenticated-only RLS.
-- Supabase's security advisor flags this as a "security definer
-- view" — that is the point, and the column list above is the
-- boundary. Do not "fix" the warning by turning it on; the view
-- would return zero rows to anon and the demo would go blank.
create or replace view public.collection_public
with (security_invoker = off) as
select
  id,
  name,
  set_name,
  series,
  card_number,
  rarity,
  item_type,
  condition,
  is_graded,
  grading_company,
  grade,
  null::text        as grading_cert,
  quantity,
  acquired_date,
  null::numeric     as purchase_price,
  current_value,
  market_price,
  market_price_currency,
  market_price_source,
  market_price_updated_at,
  market_price_condition,
  null::text        as notes,
  image_url,
  edition,
  null::timestamptz as deleted_at,
  owner,
  created_at
from public.collection_items
where deleted_at is null
  and coalesce(owner, 'jay') = 'jay';

comment on view public.collection_public is
  'Public read-only gallery feed for the demo build. Anon-readable by design; '
  'purchase_price / notes / grading_cert are nulled and soft-deleted rows and '
  'other owners are filtered out. See supabase/public_demo.sql.';

-- SELECT only, and only on this view. No insert/update/delete grant
-- exists, so the demo build is read-only at the database level
-- regardless of what the client tries.
revoke all on public.collection_public from public, anon, authenticated;
grant select on public.collection_public to anon, authenticated;

-- ------------------------------------------------------------
-- CHECK IT WORKED
-- ------------------------------------------------------------
-- 1. The view returns rows and the withheld columns are null:
--      select purchase_price, notes, grading_cert, count(*)
--        from public.collection_public
--       group by 1,2,3;
--
-- 2. anon still cannot reach the tables. With the anon key:
--      curl "$SUPABASE_URL/rest/v1/collection_items?select=*" \
--           -H "apikey: $ANON_KEY"      -> [] / permission denied
--      curl "$SUPABASE_URL/rest/v1/collection_public?select=name" \
--           -H "apikey: $ANON_KEY"      -> the gallery
