-- Add label_ids (all Gmail label IDs on the message at processing time).
alter table public.processed_emails
  add column if not exists label_ids text[] default '{}';

-- Optional: create storage bucket "models" in Dashboard (Storage) for train-important-classifier model artifact.
