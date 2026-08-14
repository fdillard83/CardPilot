-- Private, account-level CardPilot behavior preferences.
create table if not exists public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_value_enabled boolean not null default false,
  auto_value_max_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_preferences_auto_value_limit check (
    auto_value_max_cents is null
    or (auto_value_max_cents >= 1 and auto_value_max_cents <= 100000000)
  ),
  constraint account_preferences_enabled_limit check (
    not auto_value_enabled or auto_value_max_cents is not null
  )
);

alter table public.account_preferences enable row level security;

revoke all on public.account_preferences from anon;
grant select, insert, update, delete on public.account_preferences to authenticated;

drop policy if exists "Users read their CardPilot preferences" on public.account_preferences;
create policy "Users read their CardPilot preferences"
  on public.account_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their CardPilot preferences" on public.account_preferences;
create policy "Users create their CardPilot preferences"
  on public.account_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their CardPilot preferences" on public.account_preferences;
create policy "Users update their CardPilot preferences"
  on public.account_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their CardPilot preferences" on public.account_preferences;
create policy "Users delete their CardPilot preferences"
  on public.account_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);
