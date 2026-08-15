-- Durable, opt-in eBay auction publication schedules.
alter table public.ebay_listing_drafts
  add column if not exists scheduled_publish_at timestamptz,
  add column if not exists desired_end_at timestamptz,
  add column if not exists schedule_status text not null default 'unscheduled',
  add column if not exists schedule_error text;

alter table public.ebay_listing_drafts
  drop constraint if exists ebay_listing_drafts_schedule_status_check;
alter table public.ebay_listing_drafts
  add constraint ebay_listing_drafts_schedule_status_check check (
    schedule_status in ('unscheduled', 'scheduled', 'processing', 'published', 'failed', 'cancelled')
  );

create index if not exists ebay_listing_drafts_due_schedule_idx
  on public.ebay_listing_drafts (scheduled_publish_at)
  where schedule_status = 'scheduled';
