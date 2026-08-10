-- ============================================================
-- PTCG Expenses Tracker — Supabase Schema
-- Run this in your Supabase project's SQL Editor
-- ============================================================

-- 1. EXPENSES TABLE
create table public.expenses (
  id            uuid        default gen_random_uuid() primary key,
  title         text        not null,
  category      text        not null,
  amount        numeric     not null,
  type          text        not null default 'Expense' check (type in ('Expense', 'Income')),
  date          timestamptz not null,
  status        text        not null default 'Approved' check (status in ('Pending', 'Approved', 'Rejected')),
  -- 'paid' = Jay 已付；'pending' = 待報銷（預設待報銷，記帳時再確認是否已付）
  payment_status text       not null default 'pending' check (payment_status in ('paid', 'pending')),
  submitted_by       text   not null default 'public-user',
  submitted_by_name  text   not null default '使用者',
  quantity      integer     not null default 1,
  quantity_unit text        not null default '盒',
  series_tag    text,
  notes         text,
  image_url     text,
  created_at    timestamptz default now()
);

-- 2. ROW LEVEL SECURITY
--    Write policies live in auth_lockdown.sql — run that file after this one.
--    Until then RLS is on with no policies, i.e. no browser access at all.
--    Never put an `using (true)` policy back here: it opens the table to
--    anyone holding the anon key, which ships in the browser bundle.
alter table public.expenses enable row level security;

-- 3. STORAGE BUCKET FOR RECEIPTS / CARD PHOTOS
insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', true)
  on conflict do nothing;

-- Reads stay public: the app renders photos through getPublicUrl().
-- Upload/delete policies are in auth_lockdown.sql.
create policy "Public read receipts"
  on storage.objects for select
  using (bucket_id = 'receipts');

-- ============================================================
-- MIGRATIONS — run these against an existing project as needed
-- ============================================================

-- 2026-06: payment status (Jay 已付 / 待報銷)
alter table public.expenses
  add column if not exists payment_status text not null default 'paid'
  check (payment_status in ('paid', 'pending'));

-- 2026-06: default new expenses to 待報銷 (confirm paid at logging time)
alter table public.expenses
  alter column payment_status set default 'pending';

-- 2026-08: index the column every read filters or orders by.
-- api/weekly-summary.ts selects the last 7 days with `gte('date', …)`, and the
-- client list is `order('date', desc)`. Both were sequential scans; the table is
-- small today, but the weekly cron pays for it every run and it only grows.
create index if not exists expenses_date_idx on public.expenses (date desc);
