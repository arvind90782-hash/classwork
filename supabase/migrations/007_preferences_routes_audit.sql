create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  default_subject_id uuid references public.subjects(id),
  notifications_enabled boolean not null default true,
  email_notifications boolean not null default false,
  compact_view boolean not null default false,
  accessibility_reduced_motion boolean not null default false,
  language text not null default 'en',
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_settings (
  class_id uuid not null references public.classes(id) on delete cascade,
  key text not null check (length(btrim(key)) between 1 and 80),
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.students(id),
  updated_at timestamptz not null default now(),
  primary key (class_id, key)
);

alter table public.user_preferences enable row level security;
alter table public.admin_settings enable row level security;

drop policy if exists "users manage own preferences" on public.user_preferences;
create policy "users manage own preferences" on public.user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "owner read admin settings" on public.admin_settings;
create policy "owner read admin settings" on public.admin_settings
  for select using (public.is_owner());

drop policy if exists "owner manage admin settings" on public.admin_settings;
create policy "owner manage admin settings" on public.admin_settings
  for all using (public.is_owner()) with check (public.is_owner());

create or replace function public.log_activity(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_class_id uuid;
  log_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;

  select class_id into actor_class_id
  from public.students
  where id = auth.uid() and status = 'approved';

  if actor_class_id is null then raise exception 'Approved class membership is required.'; end if;

  insert into public.audit_logs(
    class_id, actor_id, action, entity_type, entity_id, new_value
  ) values (
    actor_class_id,
    auth.uid(),
    left(btrim(p_action), 120),
    left(btrim(p_entity_type), 80),
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into log_id;
  return log_id;
end;
$$;

revoke all on function public.log_activity(text, text, uuid, jsonb) from public;
grant execute on function public.log_activity(text, text, uuid, jsonb) to authenticated;

create or replace function public.save_admin_setting(
  p_key text,
  p_value jsonb
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
  if owner_class_id is null then raise exception 'Owner permission is required.'; end if;
  if length(btrim(coalesce(p_key, ''))) not between 1 and 80 then
    raise exception 'Invalid setting key.';
  end if;

  insert into public.admin_settings(class_id, key, value, updated_by, updated_at)
  values (owner_class_id, btrim(p_key), coalesce(p_value, '{}'::jsonb), auth.uid(), now())
  on conflict (class_id, key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  perform public.log_activity(
    'updated_admin_setting',
    'admin_setting',
    null,
    jsonb_build_object('key', btrim(p_key), 'value', coalesce(p_value, '{}'::jsonb))
  );
end;
$$;

revoke all on function public.save_admin_setting(text, jsonb) from public;
grant execute on function public.save_admin_setting(text, jsonb) to authenticated;
