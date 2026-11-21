drop policy if exists "student inserts own profile" on public.students;
drop policy if exists "students insert own" on public.students;
drop policy if exists "student updates own identity" on public.students;
drop policy if exists "owner updates students" on public.students;

create policy "owner updates students" on public.students
  for update using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner manages class" on public.classes;
create policy "owner manages class" on public.classes
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner manages subjects" on public.subjects;
create policy "owner manages subjects" on public.subjects
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner manages tasks" on public.tasks;
create policy "owner manages tasks" on public.tasks
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "approved read submissions" on public.submissions;
create policy "approved read submissions" on public.submissions
  for select using (
    (not is_hidden or public.is_owner())
    and exists (
      select 1 from public.tasks t
      join public.students s on s.class_id=t.class_id
      where t.id=submissions.task_id
        and s.id=auth.uid()
        and s.status='approved'
    )
  );
drop policy if exists "approved create submissions" on public.submissions;
create policy "approved create submissions" on public.submissions
  for insert with check (
    contributor_id=auth.uid()
    and exists (
      select 1 from public.tasks t
      join public.students s on s.class_id=t.class_id
      where t.id=submissions.task_id
        and s.id=auth.uid()
        and s.status='approved'
    )
  );
drop policy if exists "owner manage submissions" on public.submissions;
create policy "owner manage submissions" on public.submissions
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "approved read pages" on public.submission_pages;
create policy "approved read pages" on public.submission_pages
  for select using (
    exists (
      select 1 from public.submissions sb
      join public.tasks t on t.id=sb.task_id
      join public.students s on s.class_id=t.class_id
      where sb.id=submission_pages.submission_id
        and not sb.is_hidden
        and s.id=auth.uid()
        and s.status='approved'
    )
  );
drop policy if exists "approved create pages" on public.submission_pages;
create policy "approved create pages" on public.submission_pages
  for insert with check (
    exists (
      select 1 from public.submissions sb
      join public.students s on s.id=sb.contributor_id
      where sb.id=submission_pages.submission_id
        and sb.contributor_id=auth.uid()
        and s.status='approved'
    )
  );
drop policy if exists "owner manage pages" on public.submission_pages;
create policy "owner manage pages" on public.submission_pages
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "approved read selections" on public.notebook_page_selections;
create policy "approved read selections" on public.notebook_page_selections
  for select using (
    exists (
      select 1 from public.tasks t
      join public.students s on s.class_id=t.class_id
      where t.id=task_id and s.id=auth.uid() and s.status='approved'
    )
  );
drop policy if exists "owner manage selections" on public.notebook_page_selections;
create policy "owner manage selections" on public.notebook_page_selections
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "approved read history" on public.page_version_history;
create policy "approved read history" on public.page_version_history
  for select using (
    exists (
      select 1 from public.notebook_page_selections n
      join public.tasks t on t.id=n.task_id
      join public.students s on s.class_id=t.class_id
      where n.id=selection_id and s.id=auth.uid() and s.status='approved'
    )
  );
drop policy if exists "owner write history" on public.page_version_history;
create policy "owner write history" on public.page_version_history
  for insert with check (public.is_owner());

drop policy if exists "student report" on public.reports;
create policy "student report" on public.reports
  for insert with check (
    reporter_id=auth.uid()
    and exists (
      select 1 from public.students s where s.id=auth.uid() and s.status='approved'
    )
  );
drop policy if exists "owner reports" on public.reports;
create policy "owner reports" on public.reports
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "approved read pdfs" on public.daily_pdf_archives;
create policy "approved read pdfs" on public.daily_pdf_archives
  for select using (
    exists (
      select 1 from public.students s
      where s.id=auth.uid() and s.class_id=daily_pdf_archives.class_id and s.status='approved'
    )
  );
drop policy if exists "owner manage pdfs" on public.daily_pdf_archives;
create policy "owner manage pdfs" on public.daily_pdf_archives
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner read audit" on public.audit_logs;
create policy "owner read audit" on public.audit_logs
  for select using (public.is_owner());
drop policy if exists "owner insert audit" on public.audit_logs;
create policy "owner insert audit" on public.audit_logs
  for insert with check (actor_id=auth.uid() and public.is_owner());

drop policy if exists "approved users read notebook objects" on storage.objects;
create policy "approved users read notebook objects" on storage.objects
  for select using (
    bucket_id='classwork-pages'
    and exists (
      select 1 from public.submission_pages p
      join public.submissions sb on sb.id=p.submission_id
      join public.tasks t on t.id=sb.task_id
      join public.students s on s.class_id=t.class_id
      where p.storage_path=storage.objects.name
        and s.id=auth.uid()
        and s.status='approved'
        and (not sb.is_hidden or public.is_owner())
    )
  );
drop policy if exists "approved users upload notebook objects" on storage.objects;
create policy "approved users upload notebook objects" on storage.objects
  for insert with check (
    bucket_id='classwork-pages'
    and exists (
      select 1
      from public.submissions sb
      join public.tasks t on t.id=sb.task_id
      join public.students s on s.id=sb.contributor_id
      where s.id=auth.uid()
        and s.status='approved'
        and t.class_id=s.class_id
        and split_part(storage.objects.name, '/', 1)=s.class_id::text
        and split_part(storage.objects.name, '/', 2)=t.id::text
        and split_part(storage.objects.name, '/', 3)=sb.id::text
    )
  );
