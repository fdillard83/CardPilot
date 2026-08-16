-- Durable eBay listing lifecycle and privacy-preserving sales records.
alter table public.ebay_listing_drafts
  add column if not exists environment text not null default 'sandbox',
  add column if not exists published_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists sold_at timestamptz,
  add column if not exists sold_amount_cents integer,
  add column if not exists sold_currency text,
  add column if not exists last_synced_at timestamptz;

alter table public.ebay_listing_drafts
  drop constraint if exists ebay_listing_drafts_status_check;
alter table public.ebay_listing_drafts
  add constraint ebay_listing_drafts_status_check
  check (status in ('draft', 'published', 'sold', 'ended'));
alter table public.ebay_listing_drafts
  drop constraint if exists ebay_listing_drafts_environment_check;
alter table public.ebay_listing_drafts
  add constraint ebay_listing_drafts_environment_check
  check (environment in ('sandbox', 'production'));

update public.ebay_listing_drafts
set published_at = coalesce(published_at, updated_at)
where status = 'published';

create table if not exists public.ebay_order_sales (
  sale_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid references public.collection_cards(collection_id) on delete set null,
  order_id text not null,
  line_item_id text not null,
  listing_id text,
  order_status text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  quantity integer not null default 1 check (quantity > 0),
  sold_at timestamptz not null,
  last_synced_at timestamptz not null default now(),
  unique (user_id, order_id, line_item_id)
);

create index if not exists ebay_order_sales_user_sold_idx
  on public.ebay_order_sales (user_id, sold_at desc);
create index if not exists ebay_order_sales_listing_idx
  on public.ebay_order_sales (user_id, listing_id);

alter table public.ebay_order_sales enable row level security;
revoke all on public.ebay_order_sales from anon;
grant select on public.ebay_order_sales to authenticated;

drop policy if exists "Users view their eBay sales" on public.ebay_order_sales;
create policy "Users view their eBay sales" on public.ebay_order_sales
  for select to authenticated using ((select auth.uid()) = user_id);
