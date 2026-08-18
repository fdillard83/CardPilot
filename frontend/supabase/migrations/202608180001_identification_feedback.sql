-- Privacy-conscious field-level identification feedback. This stores whether
-- a proposed field was kept or changed, never the card image or field value.
create table if not exists public.identification_field_reviews (
  review_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  identification_id text not null,
  field_name text not null,
  was_changed boolean not null,
  original_confidence numeric(5, 4) not null check (original_confidence between 0 and 1),
  inference_source text not null,
  overall_confidence numeric(5, 4) not null check (overall_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (user_id, identification_id, field_name)
);

create index if not exists identification_field_reviews_created_idx
  on public.identification_field_reviews (created_at desc);

create index if not exists identification_field_reviews_field_idx
  on public.identification_field_reviews (field_name, was_changed);

alter table public.identification_field_reviews enable row level security;

revoke all on public.identification_field_reviews from anon;
grant insert on public.identification_field_reviews to authenticated;

drop policy if exists "Users submit their own identification feedback"
  on public.identification_field_reviews;
create policy "Users submit their own identification feedback"
  on public.identification_field_reviews for insert to authenticated
  with check ((select auth.uid()) = user_id);
