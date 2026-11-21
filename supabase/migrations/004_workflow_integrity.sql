create or replace function public.join_class(invite_code text, student_name text, student_roll text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_class uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if length(btrim(coalesce(student_name, ''))) not between 1 and 80 then
    raise exception 'Enter a name between 1 and 80 characters.';
  end if;
  if length(btrim(coalesce(student_roll, ''))) not between 1 and 30 then
    raise exception 'Enter a roll number between 1 and 30 characters.';
  end if;

  select c.id into target_class
  from public.classes c
  where c.invite_code_hash = extensions.crypt(invite_code, c.invite_code_hash)
  limit 1;
  if target_class is null then
    raise exception 'Invalid invite code.';
  end if;

  insert into public.students(id, class_id, display_name, roll_number, status)
  values (auth.uid(), target_class, btrim(student_name), btrim(student_roll), 'pending')
  on conflict (id) do update
    set display_name = excluded.display_name,
        roll_number = excluded.roll_number,
        status = case when public.students.is_owner then public.students.status else 'pending'::student_status end
    where public.students.class_id = excluded.class_id;

  if not found then
    raise exception 'Your account already belongs to a different class.';
  end if;
  return auth.uid();
end;
$$;

revoke all on function public.join_class(text, text, text) from public;
grant execute on function public.join_class(text, text, text) to authenticated;

drop policy if exists "approved create tasks" on public.tasks;
create policy "approved create tasks" on public.tasks
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.students s
      where s.id = auth.uid()
        and s.class_id = tasks.class_id
        and s.status = 'approved'
    )
    and exists (
      select 1 from public.subjects subject
      where subject.id = tasks.subject_id
        and subject.class_id = tasks.class_id
        and subject.is_active
    )
  );

create or replace function public.set_student_approval(
  p_student_id uuid,
  p_status student_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_class_id uuid;
begin
  select class_id into owner_class_id
  from public.students
  where id = auth.uid() and is_owner and status = 'approved';

  if auth.uid() is null or owner_class_id is null then
    raise exception 'Owner approval is required to manage members.';
  end if;
  if p_status is null or p_status not in ('approved', 'suspended') then
    raise exception 'Member status must be approved or suspended.';
  end if;

  update public.students
  set status = p_status, updated_at = now()
  where id = p_student_id
    and class_id = owner_class_id
    and not is_owner
    and status = 'pending';

  if not found then
    raise exception 'This pending member request no longer exists.';
  end if;

  insert into public.audit_logs(class_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    owner_class_id, auth.uid(),
    case when p_status = 'approved' then 'approved_member' else 'declined_member' end,
    'student', p_student_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_status)
  );
end;
$$;

revoke all on function public.set_student_approval(uuid, student_status) from public;
grant execute on function public.set_student_approval(uuid, student_status) to authenticated;

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

  if auth.uid() is null or owner_class_id is null then
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
    and page.page_number = p_page_number
    and not submission.is_hidden;

  if target_class_id is null or target_class_id <> owner_class_id then
    raise exception 'The selected page does not belong to this class and task.';
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

insert into storage.buckets (id, name, public)
values ('classwork-pdfs', 'classwork-pdfs', false)
on conflict (id) do nothing;

drop policy if exists "approved read archived pdf objects" on storage.objects;
create policy "approved read archived pdf objects" on storage.objects
  for select using (
    bucket_id = 'classwork-pdfs'
    and exists (
      select 1
      from public.daily_pdf_archives archive
      join public.students student on student.class_id = archive.class_id
      where archive.storage_path = storage.objects.name
        and student.id = auth.uid()
        and student.status = 'approved'
    )
  );

drop policy if exists "owner manages archived pdf objects" on storage.objects;
create policy "owner manages archived pdf objects" on storage.objects
  for all using (bucket_id = 'classwork-pdfs' and public.is_owner())
  with check (bucket_id = 'classwork-pdfs' and public.is_owner());
