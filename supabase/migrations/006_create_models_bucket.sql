-- Create the "models" storage bucket for ML artifacts (important-classifier, label-router).
insert into storage.buckets (id, name, public)
values ('models', 'models', false)
on conflict (id) do nothing;
