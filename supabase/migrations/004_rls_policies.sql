-- Explicit RLS policies: full access for service_role only (backend).
-- anon and authenticated have no allow policies, so they get no access.
-- App must use SUPABASE_SERVICE_ROLE_KEY for all DB access.

-- prompt_versions: backend only
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service_role_all_prompt_versions') then
    create policy "service_role_all_prompt_versions"
      on public.prompt_versions
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- processed_emails: backend only
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'service_role_all_processed_emails') then
    create policy "service_role_all_processed_emails"
      on public.processed_emails
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
