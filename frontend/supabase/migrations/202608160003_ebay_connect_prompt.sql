-- Remember that a user has answered the optional first-login eBay prompt.
alter table public.account_preferences
  add column if not exists ebay_connect_prompt_dismissed boolean not null default false;
