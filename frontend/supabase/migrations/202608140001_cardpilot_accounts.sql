-- CardPilot collection records. Every row is owned by one Supabase Auth user.
create table if not exists public.collection_cards (
  collection_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collection_cards_user_updated_idx
  on public.collection_cards (user_id, updated_at desc);

alter table public.collection_cards enable row level security;

revoke all on public.collection_cards from anon;
grant select, insert, update, delete on public.collection_cards to authenticated;

drop policy if exists "Users read their CardPilot cards" on public.collection_cards;
create policy "Users read their CardPilot cards"
  on public.collection_cards for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their CardPilot cards" on public.collection_cards;
create policy "Users create their CardPilot cards"
  on public.collection_cards for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their CardPilot cards" on public.collection_cards;
create policy "Users update their CardPilot cards"
  on public.collection_cards for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their CardPilot cards" on public.collection_cards;
create policy "Users delete their CardPilot cards"
  on public.collection_cards for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Private by design. The Express server returns short-lived signed URLs only
-- after it has authenticated the requesting CardPilot user.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their CardPilot images" on storage.objects;
create policy "Users read their CardPilot images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users upload their CardPilot images" on storage.objects;
create policy "Users upload their CardPilot images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users update their CardPilot images" on storage.objects;
create policy "Users update their CardPilot images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their CardPilot images" on storage.objects;
create policy "Users delete their CardPilot images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
