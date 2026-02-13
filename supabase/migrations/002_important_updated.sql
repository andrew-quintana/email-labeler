-- If you already ran 001 with important_applied and importance_feedback, run this to switch to important + important_updated on processed_emails.

alter table public.processed_emails
  add column if not exists important boolean,
  add column if not exists important_updated boolean not null default false;

-- Optional: drop old tables if they exist (no longer used).
drop table if exists public.importance_feedback;
drop table if exists public.importance_applied;
drop table if exists public.gmail_history_cursor;

create index if not exists idx_processed_emails_important_updated
  on public.processed_emails (important_updated) where important_updated = true;
