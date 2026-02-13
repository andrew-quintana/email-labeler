-- Store all Gmail label IDs on the message at processing time (for feedback and nightly important_updated).
alter table public.processed_emails
  add column if not exists label_ids text[] not null default '{}';

create index if not exists idx_processed_emails_label_ids on public.processed_emails using gin (label_ids);
