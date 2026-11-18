-- Household Budget: Supabase database setup
-- Run this once in your Supabase project: SQL Editor > New query > paste > Run.
--
-- BEFORE RUNNING: replace the two email addresses in the "members" section
-- below with the emails you and Amber will sign in with.

-------------------------------------------------------------------------------
-- 1. Who is allowed in
-------------------------------------------------------------------------------
create table if not exists public.members (
  email text primary key
);

insert into public.members (email) values
  ('cameronawharton@gmail.com'),
  ('ammortistay@yahoo.com')
on conflict do nothing;

-- true only when the signed-in user's email is on the members list
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-------------------------------------------------------------------------------
-- 2. Tables
-------------------------------------------------------------------------------
create table if not exists public.settings (
  id               int primary key default 1 check (id = 1),
  paycheck         numeric not null,
  first_payday     date    not null,
  starting_balance numeric not null default 0,
  horizon_months   int     not null default 14,
  updated_at       timestamptz not null default now()
);

-- kind:
--   income    = deposit on due_day every month (child support)
--   monthly   = bill on due_day every month
--   allowance = flexible spending; monthly amount, released per paycheck (x12/26)
--   annual    = bill on due_day in the listed months (car insurance, HOA dues)
--   debt      = monthly payment on due_day until "remaining" is paid off
create table if not exists public.bills (
  id              bigint generated always as identity primary key,
  name            text    not null,
  kind            text    not null check (kind in ('income','monthly','allowance','annual','debt')),
  category        text    not null,
  amount          numeric not null,
  due_day         int     check (due_day between 1 and 31),
  months          int[],
  remaining       numeric,
  remaining_as_of date,
  active          boolean not null default true,
  sort            int     not null default 0,
  notes           text
);

create table if not exists public.schedule (
  id         bigint generated always as identity primary key,
  date       date    not null,
  item       text    not null,
  direction  text    not null check (direction in ('in','out')),
  category   text    not null,
  planned    numeric not null,
  actual     numeric,
  paid       boolean not null default false,
  bill_id    bigint references public.bills(id) on delete set null,
  source     text    not null default 'generated' check (source in ('generated','manual')),
  updated_at timestamptz not null default now()
);
create index if not exists schedule_date_idx on public.schedule(date);

create table if not exists public.transactions (
  id         bigint generated always as identity primary key,
  date       date    not null,
  who        text    not null,
  category   text    not null,
  amount     numeric not null,
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions(date);

-------------------------------------------------------------------------------
-- 3. Security: only the two member accounts can read or change anything
-------------------------------------------------------------------------------
alter table public.members      enable row level security;
alter table public.settings     enable row level security;
alter table public.bills        enable row level security;
alter table public.schedule     enable row level security;
alter table public.transactions enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member());

do $$
declare t text;
begin
  foreach t in array array['settings','bills','schedule','transactions'] loop
    execute format('drop policy if exists household_all on public.%I', t);
    execute format('create policy household_all on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 4. Live updates between computers
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings','bills','schedule','transactions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 5. Starting data (from the budget you set up on Nov 17, 2026)
-------------------------------------------------------------------------------
insert into public.settings (id, paycheck, first_payday, starting_balance, horizon_months)
values (1, 3020.00, '2026-11-20', 0, 14)
on conflict (id) do nothing;

insert into public.bills (name, kind, category, amount, due_day, months, remaining, remaining_as_of, sort, notes)
select * from (values
  ('Child support (start of month)',     'income',   'Income',        1303.84, 1,    null::int[], null::numeric, null::date, 1,  'Usually arrives a few days early'),
  ('Child support (mid-month, 3 deposits)','income', 'Income',        1268.84, 15,   null,        null,          null,       2,  '24.61 + 500.37 + 743.86. Usually arrives a few days early'),
  ('House Note',        'monthly',   'Housing',       1977.37, 1,    null, null, null, 10, null),
  ('Brinks Alarm',      'monthly',   'Home',            91.67, 9,    null, null, null, 11, null),
  ('Gas',               'monthly',   'Utilities',      100.00, 13,   null, null, null, 12, 'Average'),
  ('Xfinity Mobile',    'monthly',   'Telecom',         76.64, 13,   null, null, null, 13, null),
  ('Electricity',       'monthly',   'Utilities',      300.00, 15,   null, null, null, 14, 'Average'),
  ('Apple Storage',     'monthly',   'Subscriptions',   10.00, 15,   null, null, null, 15, 'Placeholder date'),
  ('Claude Pro',        'monthly',   'Subscriptions',   20.00, 15,   null, null, null, 16, 'Placeholder date'),
  ('Google Photos',     'monthly',   'Subscriptions',   10.00, 15,   null, null, null, 17, 'Placeholder date'),
  ('Walden HOA',        'monthly',   'Housing',        148.38, 16,   null, null, null, 18, null),
  ('Home Internet',     'monthly',   'Telecom',        135.27, 22,   null, null, null, 19, null),
  ('MUD (Water)',       'monthly',   'Utilities',      100.00, 26,   null, null, null, 20, 'Average'),
  ('AT&T',              'monthly',   'Telecom',        289.17, 27,   null, null, null, 21, null),
  ('Spotify Family',    'monthly',   'Subscriptions',   23.58, 27,   null, null, null, 22, null),
  ('Groceries',         'allowance', 'Groceries',     1000.00, null, null, null, null, 30, 'Monthly budget, released per paycheck'),
  ('Fuel',              'allowance', 'Fuel',           200.00, null, null, null, null, 31, 'Monthly budget, released per paycheck'),
  ('Pets',              'allowance', 'Pets',           200.00, null, null, null, null, 32, 'Monthly budget, released per paycheck'),
  ('Toll Road',         'allowance', 'Toll Road',       40.00, null, null, null, null, 33, 'Monthly budget, released per paycheck'),
  ('Car Insurance',     'annual',    'Insurance',     1000.00, 1,    '{1,7}', null, null, 40, 'Every 6 months'),
  ('HOA Annual Dues',   'annual',    'Housing',        460.00, 1,    '{1}',   null, null, 41, null),
  ('Wedding Ring',      'debt',      'Debt',           520.00, 5,    null, 968.00, '2026-11-17', 50, '0% interest')
) as v(name, kind, category, amount, due_day, months, remaining, remaining_as_of, sort, notes)
where not exists (select 1 from public.bills);
