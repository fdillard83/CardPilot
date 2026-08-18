create table if not exists public.provider_usage_events (
  event_id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(provider) between 1 and 80),
  operation text not null check (char_length(operation) between 1 and 100),
  success boolean not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  returned_count integer not null default 0 check (returned_count >= 0),
  useful_count integer not null default 0 check (useful_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists provider_usage_events_created_at_idx
  on public.provider_usage_events (created_at desc);

create index if not exists provider_usage_events_provider_operation_idx
  on public.provider_usage_events (provider, operation, created_at desc);

alter table public.provider_usage_events enable row level security;

revoke all on table public.provider_usage_events from anon, authenticated;
