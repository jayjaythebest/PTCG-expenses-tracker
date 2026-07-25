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
  notes          text,
  image_url      text,
  edition        text        default 'ja' check (edition in ('ja', 'zh-tw', 'en')),
  created_at     timestamptz default now()
);

alter table public.collection_items enable row level security;

create policy "Allow all operations on collection_items"
  on public.collection_items
  for all
  using (true)
  with check (true);

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
-- Migration: add `acquired_date` (the user-editable date a card was acquired,
-- distinct from created_at). Nullable; existing rows leave it blank and can be
-- edited later. Safe to run repeatedly.
-- ============================================================
alter table public.collection_items
  add column if not exists acquired_date date;
