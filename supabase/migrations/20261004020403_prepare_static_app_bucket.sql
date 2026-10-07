insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('imec-uti-app','imec-uti-app',true,1048576,array['text/html','text/javascript','text/css','application/json'])
on conflict (id) do update set
  public=true,
  file_size_limit=1048576,
  allowed_mime_types=array['text/html','text/javascript','text/css','application/json'];

drop policy if exists "temp_upload_imec_uti_app" on storage.objects;
create policy "temp_upload_imec_uti_app"
on storage.objects for insert
to anon
with check (bucket_id='imec-uti-app');

drop policy if exists "temp_update_imec_uti_app" on storage.objects;
create policy "temp_update_imec_uti_app"
on storage.objects for update
to anon
using (bucket_id='imec-uti-app')
with check (bucket_id='imec-uti-app');
