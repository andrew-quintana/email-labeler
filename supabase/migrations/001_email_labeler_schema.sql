-- Email labeler: processed emails with body, prompt versioning, importance feedback.
-- Run in Supabase Dashboard → SQL Editor (paste and run). Use SUPABASE_SERVICE_ROLE_KEY in app for writes.

-- Prompt versions: one row per (name, content_hash) for each node.
create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  content_hash text not null,
  content text,
  created_at timestamptz not null default now(),
  unique (name, content_hash)
);

create index if not exists idx_prompt_versions_name on public.prompt_versions (name);

-- Processed emails: one row per message we labeled (with body = post-cheerio text).
-- Versioning: each node's prompt version is stored so we know what the email was processed with.
create table if not exists public.processed_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  thread_id text,
  body text not null,
  snippet text,
  summary text,
  category text,
  subcategory text,
  label_applied text,
  archive_applied boolean not null default false,
  important boolean,
  important_updated boolean not null default false,
  summarizer_prompt_version_id uuid references public.prompt_versions (id),
  category_router_prompt_version_id uuid references public.prompt_versions (id),
  subcategory_router_prompt_version_id uuid references public.prompt_versions (id),
  importance_prompt_version_id uuid references public.prompt_versions (id),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_processed_emails_message_id on public.processed_emails (message_id);
create index if not exists idx_processed_emails_processed_at on public.processed_emails (processed_at);
create index if not exists idx_processed_emails_important_updated on public.processed_emails (important_updated) where important_updated = true;

-- RLS: enable so anon key has no access; service role (server) bypasses RLS and has full access.
alter table public.prompt_versions enable row level security;
alter table public.processed_emails enable row level security;
