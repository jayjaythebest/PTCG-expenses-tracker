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
--    Currently open (no auth). Tighten later when you add login.
alter table public.expenses enable row level security;

create policy "Allow all operations"
  on public.expenses
  for all
  using (true)
  with check (true);

-- 3. STORAGE BUCKET FOR RECEIPTS / CARD PHOTOS
insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', true)
  on conflict do nothing;

create policy "Public read receipts"
  on storage.objects for select
  using (bucket_id = 'receipts');

create policy "Public upload receipts"
  on storage.objects for insert
  with check (bucket_id = 'receipts');

create policy "Public delete receipts"
  on storage.objects for delete
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
