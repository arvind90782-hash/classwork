do $$
declare
  table_name text;
  app_tables text[] := array[
    'classes',
    'students',
    'subjects',
    'tasks',
    'submissions',
    'submission_pages',
    'notebook_page_selections',
    'page_version_history',
    'reports',
    'daily_pdf_archives',
    'audit_logs',
    'class_documents',
    'class_document_pages',
    'user_preferences',
    'admin_settings'
  ];
begin
  foreach table_name in array app_tables loop
    execute format('drop policy if exists %I on public.%I', 'require verified Firebase identity', table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to public using ((auth.jwt() ->> ''email_verified'') = ''true'') with check ((auth.jwt() ->> ''email_verified'') = ''true'')',
      'require verified Firebase identity',
      table_name
    );
  end loop;
end
$$;

drop policy if exists "require verified Firebase identity for classwork objects" on storage.objects;
create policy "require verified Firebase identity for classwork objects" on storage.objects
  as restrictive for all to public
  using (
    bucket_id not in ('classwork-pages', 'classwork-documents', 'classwork-pdfs')
    or (auth.jwt() ->> 'email_verified') = 'true'
  )
  with check (
    bucket_id not in ('classwork-pages', 'classwork-documents', 'classwork-pdfs')
    or (auth.jwt() ->> 'email_verified') = 'true'
  );
