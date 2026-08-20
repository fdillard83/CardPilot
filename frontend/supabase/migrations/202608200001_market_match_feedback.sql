-- User-reviewed marketplace matching outcomes. Public listing titles and
-- numeric matching evidence are retained for quality analysis; card photos,
-- prices, and private notes are not stored here.
create table if not exists public.market_match_reviews (
  review_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id text not null,
  source text not null check (source in ('active_market', 'sold_comps')),
  snapshot_searched_at timestamptz not null,
  observation_id text not null,
  outcome text not null check (outcome in ('correct_match', 'wrong_card', 'wrong_variation', 'missing_matches')),
  target_title text not null,
  result_title text,
  match_tier text,
  match_score numeric(8, 4),
  visual_match_score numeric(5, 4),
  visual_match_status text check (visual_match_status is null or visual_match_status in ('matched', 'unavailable', 'not_evaluated')),
  matched_signals jsonb not null default '[]'::jsonb,
  candidate_count integer not null default 0,
  matched_count integer not null default 0,
  exact_matched_count integer not null default 0,
  broader_matched_count integer not null default 0,
  excluded_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, collection_id, source, snapshot_searched_at, observation_id)
);

create index if not exists market_match_reviews_created_idx
  on public.market_match_reviews (created_at desc);

create index if not exists market_match_reviews_quality_idx
  on public.market_match_reviews (source, outcome, match_tier);

alter table public.market_match_reviews enable row level security;

revoke all on public.market_match_reviews from anon;
grant insert, update on public.market_match_reviews to authenticated;

drop policy if exists "Users submit their own market feedback"
  on public.market_match_reviews;
create policy "Users submit their own market feedback"
  on public.market_match_reviews for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own market feedback"
  on public.market_match_reviews;
create policy "Users update their own market feedback"
  on public.market_match_reviews for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
