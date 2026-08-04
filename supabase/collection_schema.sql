-- ============================================================
-- PTCG Expenses Tracker — Collection Items Table
-- Run this in your Supabase project's SQL Editor
-- ============================================================

create table public.collection_items (
  id             uuid        default gen_random_uuid() primary key,
  name           text        not null,
  set_name       text        not null default '',
  series         text        not null default '',
  card_number    text,
  rarity         text,
  item_type       text       not null default 'single' check (item_type in ('single', 'box', 'pack')),
  condition       text       check (condition in ('mint', 'nm', 'lp', 'mp')),
  is_graded       boolean    not null default false,
  grading_company text       check (grading_company in ('psa', 'bgs', 'other')),
  grade           text,
  grading_cert    text,
  quantity        integer    not null default 1,
  acquired_date   date,
  purchase_price numeric,
  current_value  numeric,
  market_price          numeric,
  market_price_currency text,
  market_price_source   text,
  market_price_updated_at timestamptz,
  market_price_condition  text,
  notes          text,
  image_url      text,
  edition        text        default 'ja' check (edition in ('ja', 'zh-tw', 'en')),
  created_at     timestamptz default now()
);

alter table public.collection_items enable row level security;

-- Policies live in auth_lockdown.sql — run that file after this one.
-- Never put an `using (true)` policy back here: it opens the table to anyone
-- holding the anon key, which ships in the browser bundle.

-- ============================================================
-- Migration: add `edition` column to an existing table.
-- Existing rows are Japanese cards, so default/backfill to 'ja'.
-- Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists edition text
  default 'ja' check (edition in ('ja', 'zh-tw', 'en'));

update public.collection_items set edition = 'ja' where edition is null;

-- ============================================================
-- Migration: add grading (鑑定) columns to an existing table.
-- Existing rows default to not graded; grading can be added later
-- via the edit flow. Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists is_graded       boolean not null default false,
  add column if not exists grading_company text check (grading_company in ('psa', 'bgs', 'other')),
  add column if not exists grade           text,
  add column if not exists grading_cert    text;

-- ============================================================
-- Migration: add auto-fetched market price columns.
-- `market_price` is stored in `market_price_currency` (e.g. JPY from Huca);
-- the UI converts to TWD for display. Separate from `current_value` (manual).
-- Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists market_price            numeric,
  add column if not exists market_price_currency   text,
  add column if not exists market_price_source     text,
  add column if not exists market_price_updated_at timestamptz;

-- ============================================================
-- Migration: add `market_price_condition` — the normalised condition of the
-- priced row (raw 'A'/'B'/'C'/'D' or graded 'PSA10'/'BGS9.5'), so the UI can
-- honestly label a graded reference price stored for an ungraded card.
-- Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists market_price_condition text;

-- ============================================================
-- Migration: add `acquired_date` (the user-editable date a card was acquired,
-- distinct from created_at). Nullable; existing rows leave it blank and can be
-- edited later. Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists acquired_date date;

-- ============================================================
-- Migration: add `deleted_at` — the soft-delete tombstone. Null = active; a
-- timestamp = in the "已刪除" graveyard, hidden from the gallery but restorable,
-- so an accidental delete doesn't lose the row or its price history. The client
-- and the daily cron both filter on it. Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists deleted_at timestamptz;

-- The gallery always asks for active rows only.
create index if not exists collection_items_active_idx
  on public.collection_items (deleted_at);

-- ============================================================
-- Migration: add `owner` — whose cards these are.
--
-- One Supabase account is shared by more than one collector: a friend signs in
-- with the same credentials and files their cards under their own tab in the
-- collection view. This column keeps those collections, and every total derived
-- from them, from being added together.
--
-- It is NOT an auth boundary and must never be used as one. RLS still grants
-- every allowed user full access to every row, so anyone signed in can read and
-- edit any owner's cards. Separating for real would mean separate accounts.
--
-- The default backfills existing rows to the account holder, which is correct —
-- they were all his before this column existed. Ids must match COLLECTION_OWNERS
-- in src/data/collectionOwners.ts. Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists owner text not null default 'jay';

-- The gallery filters to a single owner's active cards on every render.
create index if not exists collection_items_owner_idx
  on public.collection_items (owner, deleted_at);

-- ============================================================
-- Daily collection-value snapshots (stock-ticker style).
-- One row per calendar day; the home screen compares the latest value against
-- ~7 days ago and draws a recent trend line. Written by the daily Vercel cron
-- (/api/snapshot-collection) and refreshed client-side on load — both upsert by
-- snapshot_date, so writes are idempotent. Safe to run repeatedly.
-- ============================================================
create table if not exists public.collection_value_snapshots (
  snapshot_date date        primary key,
  total_twd     numeric     not null default 0,
  item_count    integer     not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.collection_value_snapshots enable row level security;

-- Policies live in auth_lockdown.sql — run that file after this one.

-- ============================================================
-- Per-card daily price history.
-- collection_value_snapshots above only stores the collection TOTAL, which mixes
-- two different things: prices moving, and the user buying more cards. This
-- table keeps one row per card per day so we can answer "which cards moved, and
-- by how much" and chart price-only change. Written by the daily cron
-- (/api/snapshot-collection) and by the client on load — both upsert on
-- (item_id, snapshot_date), so writes are idempotent. Safe to run repeatedly.
--
-- `unit_twd` is the per-card TWD value (NOT multiplied by quantity) so that
-- buying a second copy never looks like a price rise. `price` + `currency` keep
-- the untouched source figure, which lets a later FX-neutral comparison exist.
-- ============================================================
create table if not exists public.collection_price_history (
  item_id       uuid        not null references public.collection_items(id) on delete cascade,
  snapshot_date date        not null,
  price         numeric     not null,
  currency      text        not null default 'JPY',
  unit_twd      numeric     not null,
  quantity      integer     not null default 1,
  source        text,
  created_at    timestamptz not null default now(),
  primary key (item_id, snapshot_date)
);

-- The home screen reads a recent window across all cards, so date leads.
create index if not exists collection_price_history_date_idx
  on public.collection_price_history (snapshot_date desc);

alter table public.collection_price_history enable row level security;

-- Policies live in auth_lockdown.sql — run that file after this one.
