insert into public.subjects (class_id, name, sort_order)
select c.id, subject.name, subject.sort_order
from public.classes c
cross join (
  values
    ('English', 1),
    ('EVS / TWAU', 2),
    ('Hindi', 3),
    ('Mathematics', 4),
    ('Computer', 5),
    ('Music', 6)
) as subject(name, sort_order)
on conflict (class_id, name) do nothing;

create table public.class_documents (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  uploaded_by uuid not null references public.students(id),
  category text not null check (length(btrim(category)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 120),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index class_documents_class_created_idx on public.class_documents(class_id, created_at desc);

create table public.class_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.class_documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0),
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270)),
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);

alter table public.class_documents enable row level security;
alter table public.class_document_pages enable row level security;

create policy "approved read class documents" on public.class_documents
  for select using (
    exists (
      select 1 from public.students s
      where s.id = auth.uid()
        and s.class_id = class_documents.class_id
        and s.status = 'approved'
    )
  );
create policy "approved create own class documents" on public.class_documents
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.students s
      where s.id = auth.uid()
        and s.class_id = class_documents.class_id
        and s.status = 'approved'
    )
  );

create policy "approved read class document pages" on public.class_document_pages
  for select using (
    exists (
      select 1
      from public.class_documents d
      join public.students s on s.class_id = d.class_id
      where d.id = class_document_pages.document_id
        and s.id = auth.uid()
        and s.status = 'approved'
    )
  );
create policy "approved add pages to own class documents" on public.class_document_pages
  for insert with check (
    exists (
      select 1
      from public.class_documents d
      join public.students s on s.id = d.uploaded_by
      where d.id = class_document_pages.document_id
        and d.uploaded_by = auth.uid()
        and s.class_id = d.class_id
        and s.status = 'approved'
    )
  );

insert into storage.buckets (id, name, public)
values ('classwork-documents', 'classwork-documents', false)
on conflict (id) do nothing;

create policy "approved read class document objects" on storage.objects
  for select using (
    bucket_id = 'classwork-documents'
    and exists (
      select 1
      from public.class_document_pages p
      join public.class_documents d on d.id = p.document_id
      join public.students s on s.class_id = d.class_id
      where p.storage_path = storage.objects.name
        and split_part(storage.objects.name, '/', 1) = d.class_id::text
        and split_part(storage.objects.name, '/', 2) = d.id::text
        and s.id = auth.uid()
        and s.status = 'approved'
    )
  );
create policy "approved upload own class document objects" on storage.objects
  for insert with check (
    bucket_id = 'classwork-documents'
    and exists (
      select 1
      from public.class_documents d
      join public.students s on s.id = d.uploaded_by
      where split_part(storage.objects.name, '/', 1) = d.class_id::text
        and split_part(storage.objects.name, '/', 2) = d.id::text
        and d.uploaded_by = auth.uid()
        and s.class_id = d.class_id
        and s.status = 'approved'
        and split_part(class_document_pages.storage_path, '/', 1) = d.class_id::text
        and split_part(class_document_pages.storage_path, '/', 2) = d.id::text
    )
  );
