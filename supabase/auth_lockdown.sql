-- ============================================================
-- PTCG Expenses Tracker — Auth lockdown
-- Run this ONCE in your Supabase project's SQL Editor.
-- Safe to re-run (idempotent).
--
-- Before this file, every table + the receipts bucket allowed
-- anonymous read/write/delete. After it, only signed-in users whose
-- email is listed in public.allowed_users can touch the data.
--
-- ALSO DO THIS IN THE DASHBOARD (the SQL alone is not enough):
--   1. Authentication -> Sign In / Providers -> Email:
--      turn OFF "Allow new users to sign up".
--   2. Authentication -> Users -> "Add user" for each person,
--      with "Auto Confirm User" checked.
--   3. Add the same emails to public.allowed_users below.
-- ============================================================

-- ------------------------------------------------------------
-- 1. WHO IS ALLOWED IN
--    Adding someone later = create the auth user in the dashboard,
--    then insert their email here. No policy edits needed.
-- ------------------------------------------------------------
create table if not exists public.allowed_users (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- No policies are defined for this table, so with RLS on it is
-- unreachable from the browser. Only the SQL editor / service role
-- (which bypass RLS) can read or change the list.
alter table public.allowed_users enable row level security;

insert into public.allowed_users (email, note) values
  ('jj940170@gmail.com', 'Jay')
  -- , ('family@example.com', '家人')
on conflict (email) do nothing;

-- security definer so it can read allowed_users despite that table's RLS.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_users
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

revoke all on function public.is_allowed_user() from public, anon;
grant execute on function public.is_allowed_user() to authenticated;

-- ------------------------------------------------------------
-- 2. TABLE POLICIES
--    `to authenticated` shuts out the anon key entirely; the
--    is_allowed_user() check then shuts out any stray signup.
-- ------------------------------------------------------------
alter table public.expenses                  enable row level security;
alter table public.collection_items          enable row level security;
alter table public.collection_value_snapshots enable row level security;

drop policy if exists "Allow all operations"                            on public.expenses;
drop policy if exists "Allow all operations on collection_items"        on public.collection_items;
drop policy if exists "Allow all operations on collection_value_snapshots" on public.collection_value_snapshots;

drop policy if exists "Allowed users manage expenses" on public.expenses;
create policy "Allowed users manage expenses"
  on public.expenses for all to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());

drop policy if exists "Allowed users manage collection_items" on public.collection_items;
create policy "Allowed users manage collection_items"
  on public.collection_items for all to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());

drop policy if exists "Allowed users manage collection_value_snapshots" on public.collection_value_snapshots;
create policy "Allowed users manage collection_value_snapshots"
  on public.collection_value_snapshots for all to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());

-- ------------------------------------------------------------
-- 3. STORAGE (receipts bucket)
--    Reads stay public: the app renders card photos via
--    getPublicUrl(), so locking reads would need signed URLs.
--    Writes and deletes now require an allowed user.
-- ------------------------------------------------------------
drop policy if exists "Public upload receipts" on storage.objects;
drop policy if exists "Public delete receipts" on storage.objects;

drop policy if exists "Allowed users upload receipts" on storage.objects;
create policy "Allowed users upload receipts"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_allowed_user());

drop policy if exists "Allowed users delete receipts" on storage.objects;
create policy "Allowed users delete receipts"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_allowed_user());

-- ------------------------------------------------------------
-- 4. CHECK IT WORKED
--    Every row should show roles={authenticated}. Anything still
--    showing {public} is open to the internet.
-- ------------------------------------------------------------
-- select tablename, policyname, roles, cmd
--   from pg_policies
--  where schemaname in ('public', 'storage')
--  order by tablename, policyname;
