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
  item_type      text        not null default 'single' check (item_type in ('single', 'box', 'pack')),
  condition      text        check (condition in ('mint', 'nm', 'lp', 'mp')),
  quantity       integer     not null default 1,
  purchase_price numeric,
  current_value  numeric,
  notes          text,
  image_url      text,
  created_at     timestamptz default now()
);

alter table public.collection_items enable row level security;

create policy "Allow all operations on collection_items"
  on public.collection_items
  for all
  using (true)
  with check (true);
