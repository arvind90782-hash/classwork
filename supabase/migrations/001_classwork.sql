create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type student_status as enum ('pending', 'approved', 'suspended');
create type task_status as enum ('draft', 'awaiting_review', 'needs_replacement', 'finalised', 'archived');
create type report_status as enum ('open', 'reviewed', 'resolved');

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code_hash text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id),
  display_name text not null,
  roll_number text not null,
  status student_status not null default 'pending',
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id, roll_number)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  unique(class_id, name)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  academic_date date not null,
  title text not null,
  chapter text,
  exercise text,
  page_details text,
  instructions text,
  status task_status not null default 'awaiting_review',
  created_by uuid not null references public.students(id),
  merged_into uuid references public.tasks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_class_date_subject_idx on public.tasks(class_id, academic_date, subject_id);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  contributor_id uuid not null references public.students(id),
  notes text,
  is_hidden boolean not null default false,
  uploaded_at timestamptz not null default now(),
  unique(id, contributor_id)
);
create index submissions_task_idx on public.submissions(task_id);

create table public.submission_pages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  storage_path text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  width integer,
  height integer,
  rotation integer not null default 0,
  created_at timestamptz not null default now(),
  unique(submission_id, page_number)
);

create table public.notebook_page_selections (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  submission_page_id uuid references public.submission_pages(id),
  status text not null default 'awaiting_review',
  selected_by uuid references public.students(id),
  selected_at timestamptz,
  unique(task_id, page_number)
);

create table public.page_version_history (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null references public.notebook_page_selections(id) on delete cascade,
  previous_submission_page_id uuid references public.submission_pages(id),
  new_submission_page_id uuid references public.submission_pages(id),
  changed_by uuid not null references public.students(id),
  changed_at timestamptz not null default now(),
  reason text
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reporter_id uuid not null references public.students(id),
  reason text not null,
  status report_status not null default 'open',
  reviewed_by uuid references public.students(id),
  created_at timestamptz not null default now()
);

create table public.daily_pdf_archives (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id),
  pdf_type text not null,
  academic_date date,
  subject_id uuid references public.subjects(id),
  storage_path text not null,
  version integer not null,
  published_by uuid not null references public.students(id),
  published_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id),
  actor_id uuid not null references public.students(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students
    where id = auth.uid() and is_owner = true
  );
$$;

create or replace function public.current_student_status()
returns student_status language sql stable security definer set search_path = public as $$
  select status from public.students where id = auth.uid();
$$;

alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.subjects enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_pages enable row level security;
alter table public.notebook_page_selections enable row level security;
alter table public.page_version_history enable row level security;
alter table public.reports enable row level security;
alter table public.daily_pdf_archives enable row level security;
alter table public.audit_logs enable row level security;

create policy "approved students read class" on public.classes for select
  using (exists (select 1 from public.students s where s.id=auth.uid() and s.class_id=id and s.status='approved'));
create policy "owner manages class" on public.classes for all using (public.is_owner()) with check (public.is_owner());

create policy "student reads approved peers" on public.students for select
  using (id=auth.uid() or (public.is_owner()) or exists (
    select 1 from public.students viewer where viewer.id=auth.uid() and viewer.class_id=students.class_id and viewer.status='approved'
  ));
create policy "owner updates students" on public.students for update using (public.is_owner()) with check (public.is_owner());

create policy "approved read subjects" on public.subjects for select
  using (exists (select 1 from public.students s where s.id=auth.uid() and s.class_id=subjects.class_id and s.status='approved'));
create policy "owner manage subjects" on public.subjects for all using (public.is_owner()) with check (public.is_owner());

create policy "approved read tasks" on public.tasks for select
  using (exists (select 1 from public.students s where s.id=auth.uid() and s.class_id=tasks.class_id and s.status='approved'));
create policy "approved create tasks" on public.tasks for insert
  with check (exists (select 1 from public.students s where s.id=auth.uid() and s.class_id=tasks.class_id and s.status='approved'));
create policy "owner manage tasks" on public.tasks for all using (public.is_owner()) with check (public.is_owner());

create policy "approved read submissions" on public.submissions for select
  using (not is_hidden and exists (
    select 1 from public.tasks t join public.students s on s.class_id=t.class_id
    where t.id=submissions.task_id and s.id=auth.uid() and s.status='approved'
  ));
create policy "approved create submissions" on public.submissions for insert
  with check (contributor_id=auth.uid() and exists (
    select 1 from public.tasks t join public.students s on s.class_id=t.class_id
    where t.id=submissions.task_id and s.id=auth.uid() and s.status='approved'
  ));
create policy "owner manage submissions" on public.submissions for all using (public.is_owner()) with check (public.is_owner());

create policy "approved read pages" on public.submission_pages for select
  using (exists (
    select 1 from public.submissions sb join public.tasks t on t.id=sb.task_id
    join public.students s on s.class_id=t.class_id
    where sb.id=submission_pages.submission_id and s.id=auth.uid() and s.status='approved'
  ));
create policy "approved create pages" on public.submission_pages for insert
  with check (exists (
    select 1 from public.submissions sb where sb.id=submission_pages.submission_id and sb.contributor_id=auth.uid()
  ));

create policy "approved read selections" on public.notebook_page_selections for select
  using (exists (select 1 from public.tasks t join public.students s on s.class_id=t.class_id
    where t.id=task_id and s.id=auth.uid() and s.status='approved'));
create policy "owner manage selections" on public.notebook_page_selections for all using (public.is_owner()) with check (public.is_owner());

create policy "approved read history" on public.page_version_history for select
  using (exists (select 1 from public.notebook_page_selections n join public.tasks t on t.id=n.task_id
    join public.students s on s.class_id=t.class_id
    where n.id=selection_id and s.id=auth.uid() and s.status='approved'));
create policy "owner write history" on public.page_version_history for insert with check (public.is_owner());

create policy "student report" on public.reports for insert with check (reporter_id=auth.uid());
create policy "owner reports" on public.reports for all using (public.is_owner()) with check (public.is_owner());

create policy "approved read pdfs" on public.daily_pdf_archives for select
  using (exists (select 1 from public.students s where s.id=auth.uid() and s.class_id=class_id and s.status='approved'));
create policy "owner manage pdfs" on public.daily_pdf_archives for all using (public.is_owner()) with check (public.is_owner());

create policy "owner read audit" on public.audit_logs for select using (public.is_owner());
create policy "owner insert audit" on public.audit_logs for insert with check (public.is_owner() or actor_id=auth.uid());

insert into storage.buckets (id, name, public) values ('classwork-pages', 'classwork-pages', false)
on conflict (id) do nothing;

create or replace function public.join_class(invite_code text, student_name text, student_roll text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  target_class uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select c.id into target_class
  from public.classes c
  where c.invite_code_hash = extensions.crypt(invite_code, c.invite_code_hash)
  limit 1;

  if target_class is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.students(id, class_id, display_name, roll_number, status)
  values (auth.uid(), target_class, btrim(student_name), btrim(student_roll), 'pending')
  on conflict (id) do update
  set display_name=excluded.display_name,
      roll_number=excluded.roll_number,
      class_id=excluded.class_id,
      status='pending';

  if auth.jwt() ->> 'email' = 'classwork.admin@gmail.com' then
    update public.students
    set is_owner=true, status='approved'
    where id=auth.uid();
  end if;

  return auth.uid();
end;
$$;

create policy "approved users read notebook objects" on storage.objects for select
  using (
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

create policy "approved users upload notebook objects" on storage.objects for insert
  with check (
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

insert into public.classes (name, invite_code_hash)
select 'Class 5', extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf'))
where not exists (select 1 from public.classes);

insert into public.subjects (class_id, name, sort_order)
select c.id, s.name, s.sort_order
from public.classes c
cross join (
  values
    ('English', 1),
    ('EVS / TWAU', 2),
    ('Hindi', 3),
    ('Mathematics', 4),
    ('Computer', 5),
    ('Music', 6)
) as s(name, sort_order)
where c.name='Class 5'
on conflict (class_id, name) do update set sort_order=excluded.sort_order;
