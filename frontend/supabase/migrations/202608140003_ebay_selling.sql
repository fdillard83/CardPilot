-- Private eBay seller connections and listing drafts.
alter table public.account_preferences
  add column if not exists ebay_selling_defaults jsonb not null default '{}'::jsonb;

create table if not exists public.ebay_seller_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  encrypted_refresh_token text not null,
  scopes text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ebay_listing_drafts (
  draft_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null references public.collection_cards(collection_id) on delete cascade,
  draft jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'ended')),
  ebay_offer_id text,
  ebay_listing_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, collection_id)
);

create index if not exists ebay_listing_drafts_user_updated_idx
  on public.ebay_listing_drafts (user_id, updated_at desc);

alter table public.ebay_seller_connections enable row level security;
alter table public.ebay_listing_drafts enable row level security;
revoke all on public.ebay_seller_connections from anon, authenticated;
revoke all on public.ebay_listing_drafts from anon;
grant select, insert, update, delete on public.ebay_listing_drafts to authenticated;

drop policy if exists "Users manage their eBay drafts" on public.ebay_listing_drafts;
create policy "Users manage their eBay drafts" on public.ebay_listing_drafts
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
