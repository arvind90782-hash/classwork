do $$
begin
  create type submission_status as enum ('pending_review', 'approved', 'rejected', 'archived');
exception
  when duplicate_object then null;
end
$$;

alter table public.submissions
  add column if not exists approval_status submission_status not null default 'pending_review',
  add column if not exists review_notes text,
  add column if not exists reviewed_by uuid references public.students(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists approved_at timestamptz;

-- Existing visible records predate the approval lifecycle and must not disappear.
-- Existing hidden records are retained and marked rejected for safe moderation.
update public.submissions
set approval_status = case when is_hidden then 'rejected'::submission_status else 'approved'::submission_status end,
    approved_at = case when not is_hidden then uploaded_at else null end,
    reviewed_at = case when is_hidden then uploaded_at else null end
where approval_status = 'pending_review';

create index if not exists submissions_task_approval_idx
  on public.submissions(task_id, approval_status, uploaded_at desc);
create index if not exists submissions_contributor_approval_idx
  on public.submissions(contributor_id, approval_status, uploaded_at desc);

create or replace function public.review_submission(
  p_submission_id uuid,
  p_status submission_status,
  p_review_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_class_id uuid;
  target_class_id uuid;
  previous_status submission_status;
begin
  select class_id into owner_class_id
  from public.students
  where id = auth.uid() and is_owner and status = 'approved';
  if owner_class_id is null then
    raise exception 'Owner approval is required.';
  end if;
  if p_status not in ('approved', 'rejected', 'archived') then
    raise exception 'Use approved, rejected, or archived.';
  end if;

  select t.class_id into target_class_id
  from public.submissions submission
  join public.tasks t on t.id = submission.task_id
  where submission.id = p_submission_id;

  if target_class_id is null or target_class_id <> owner_class_id then
    raise exception 'Submission does not belong to this class.';
  end if;

  select approval_status into previous_status
  from public.submissions
  where id = p_submission_id;

  update public.submissions
  set approval_status = p_status,
      is_hidden = p_status in ('rejected', 'archived'),
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else null end
  where id = p_submission_id;

  insert into public.audit_logs(class_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    owner_class_id,
    auth.uid(),
    'reviewed_submission',
    'submission',
    p_submission_id,
    jsonb_build_object('approval_status', previous_status),
    jsonb_build_object(
      'approval_status', p_status,
      'review_notes', nullif(btrim(coalesce(p_review_notes, '')), '')
    )
  );
end;
$$;

revoke all on function public.review_submission(uuid, submission_status, text) from public;
grant execute on function public.review_submission(uuid, submission_status, text) to authenticated;

drop policy if exists "approved read submissions" on public.submissions;
create policy "students read visible submissions" on public.submissions
  for select using (
    public.is_owner()
    or (
      contributor_id = auth.uid()
      and exists (
        select 1 from public.students s
        where s.id = auth.uid() and s.status = 'approved'
      )
    )
    or (
      approval_status = 'approved'
      and exists (
        select 1
        from public.tasks t
        join public.students s on s.class_id = t.class_id
        where t.id = submissions.task_id
          and s.id = auth.uid()
          and s.status = 'approved'
      )
    )
  );

drop policy if exists "approved read pages" on public.submission_pages;
create policy "students read visible submission pages" on public.submission_pages
  for select using (
    public.is_owner()
    or exists (
      select 1
      from public.submissions sb
      join public.tasks t on t.id = sb.task_id
      join public.students s on s.class_id = t.class_id
      where sb.id = submission_pages.submission_id
        and s.id = auth.uid()
        and s.status = 'approved'
        and (sb.approval_status = 'approved' or sb.contributor_id = auth.uid())
    )
  );

drop policy if exists "owner manage submissions" on public.submissions;
create policy "owner manage submissions" on public.submissions
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner manage pages" on public.submission_pages;
create policy "owner manage pages" on public.submission_pages
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "approved users read notebook objects" on storage.objects;
create policy "approved users read notebook objects" on storage.objects
  for select using (
    bucket_id = 'classwork-pages'
    and (
      public.is_owner()
      or exists (
        select 1
        from public.submission_pages p
        join public.submissions sb on sb.id = p.submission_id
        join public.tasks t on t.id = sb.task_id
        join public.students s on s.class_id = t.class_id
        where p.storage_path = storage.objects.name
          and s.id = auth.uid()
          and s.status = 'approved'
          and (sb.approval_status = 'approved' or sb.contributor_id = auth.uid())
      )
    )
  );

-- Recreate the class document storage insert policy without a migration-time
-- reference to an unrelated table.
drop policy if exists "approved upload own class document objects" on storage.objects;
create policy "approved upload own class document objects" on storage.objects
  for insert with check (
    bucket_id = 'classwork-documents'
    and exists (
      select 1
      from public.class_documents d
      join public.students s on s.id = d.uploaded_by
      where d.uploaded_by = auth.uid()
        and s.id = auth.uid()
        and s.status = 'approved'
        and s.class_id = d.class_id
        and split_part(storage.objects.name, '/', 1) = d.class_id::text
        and split_part(storage.objects.name, '/', 2) = d.id::text
    )
  );

create or replace function public.select_notebook_page(
  p_task_id uuid,
  p_page_number integer,
  p_submission_page_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_class_id uuid;
  target_class_id uuid;
  prior_selection_id uuid;
  prior_page_id uuid;
  selection_id uuid;
begin
  select class_id into owner_class_id
  from public.students
  where id = auth.uid() and is_owner and status = 'approved';
  if owner_class_id is null then
    raise exception 'Owner approval is required to curate notebook pages.';
  end if;
  if p_page_number < 1 then
    raise exception 'Notebook page number must be positive.';
  end if;

  select t.class_id into target_class_id
  from public.submission_pages page
  join public.submissions submission on submission.id = page.submission_id
  join public.tasks t on t.id = submission.task_id
  where page.id = p_submission_page_id
    and submission.task_id = p_task_id
    and submission.approval_status = 'approved';

  if target_class_id is null or target_class_id <> owner_class_id then
    raise exception 'The selected page is not approved for this class and task.';
  end if;

  select id, submission_page_id into prior_selection_id, prior_page_id
  from public.notebook_page_selections
  where task_id = p_task_id and page_number = p_page_number
  for update;

  if prior_selection_id is not null and prior_page_id is distinct from p_submission_page_id then
    insert into public.page_version_history(
      selection_id, previous_submission_page_id, new_submission_page_id, changed_by, reason
    ) values (
      prior_selection_id, prior_page_id, p_submission_page_id, auth.uid(), 'Owner updated curated page'
    );
  end if;

  insert into public.notebook_page_selections(
    task_id, page_number, submission_page_id, status, selected_by, selected_at
  ) values (
    p_task_id, p_page_number, p_submission_page_id, 'finalised', auth.uid(), now()
  )
  on conflict (task_id, page_number) do update
    set submission_page_id = excluded.submission_page_id,
        status = excluded.status,
        selected_by = excluded.selected_by,
        selected_at = excluded.selected_at
  returning id into selection_id;

  insert into public.audit_logs(class_id, actor_id, action, entity_type, entity_id)
  values (target_class_id, auth.uid(), 'selected_notebook_page', 'notebook_page_selection', selection_id);
  return selection_id;
end;
$$;

revoke all on function public.select_notebook_page(uuid, integer, uuid) from public;
grant execute on function public.select_notebook_page(uuid, integer, uuid) to authenticated;
