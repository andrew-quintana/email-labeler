-- Capture all labels from Gmail at sync time (for label-router and important feedback).
-- label_ids = at processing time; label_ids_current = after nightly sync (user may have changed labels).
alter table public.processed_emails
  add column if not exists label_ids_current text[] default '{}',
  add column if not exists labels_synced_at timestamptz;
