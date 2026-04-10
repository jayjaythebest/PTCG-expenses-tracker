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
  submitted_by       text   not null default 'public-user',
  submitted_by_name  text   not null default '使用者',
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
