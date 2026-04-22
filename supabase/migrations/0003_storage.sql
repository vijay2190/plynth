-- 0003_storage.sql — Storage bucket for resumes (private)

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

drop policy if exists "resume_select_own" on storage.objects;
create policy "resume_select_own" on storage.objects for select
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "resume_insert_own" on storage.objects;
create policy "resume_insert_own" on storage.objects for insert
  with check (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "resume_update_own" on storage.objects;
create policy "resume_update_own" on storage.objects for update
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "resume_delete_own" on storage.objects;
create policy "resume_delete_own" on storage.objects for delete
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);
