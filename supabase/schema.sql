-- Officer Hub schema. Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run.

create table if not exists officers (
  id          text primary key,
  name        text not null,
  role        text default '',
  is_admin    boolean default false,
  created_at  timestamptz default now()
);

create table if not exists tasks (
  id                text primary key,
  title             text not null,
  notes             text default '',
  owner_id          text,
  collaborator_ids  text[] default '{}',
  due_date          date,
  status            text default 'Not Started',
  created_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists meetings (
  id             text primary key,
  title          text not null,
  date           date not null,
  time           text default '',
  location       text default '',
  agenda         text default '',
  minutes_text   text default '',
  minutes_link   text default '',
  minutes_files  jsonb default '[]',
  created_at     timestamptz default now()
);

-- One row per (meeting, officer): RSVP, absence update, and whether they were present.
create table if not exists meeting_responses (
  id            text primary key,          -- "<meeting_id>|<officer_id>"
  meeting_id    text not null references meetings(id) on delete cascade,
  officer_id    text not null references officers(id) on delete cascade,
  status        text,                      -- 'yes' | 'no' | null
  upcoming      text default '',
  requests      text default '',
  responded_at  timestamptz,
  present       boolean default false
);

-- v2: when a task was completed (for on-time stats) + task updates/activity.
alter table tasks add column if not exists completed_at timestamptz;
update tasks set completed_at = updated_at where status = 'Done' and completed_at is null;

create table if not exists task_comments (
  id          text primary key,
  task_id     text not null references tasks(id) on delete cascade,
  author_id   text,
  body        text default '',
  kind        text default 'comment',      -- 'comment' | 'status' | 'created' | 'assign'
  created_at  timestamptz default now()
);

-- v3: admin passwords. Hashes live in a table the website can't read at all;
-- the site can only ask these functions "is this password right?".
create extension if not exists pgcrypto with schema extensions;

create table if not exists admin_passwords (
  officer_id  text primary key references officers(id) on delete cascade,
  pw_hash     text not null,
  updated_at  timestamptz default now()
);
alter table admin_passwords enable row level security;   -- no policies = no direct access
revoke all on admin_passwords from anon, authenticated;

create or replace function admin_has_password(oid text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from admin_passwords where officer_id = oid);
$$;

create or replace function verify_admin_password(oid text, pw text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from admin_passwords where officer_id = oid and pw_hash = crypt(coalesce(pw, ''), pw_hash));
$$;

-- First time: anyone signing in as an admin with no password yet creates it.
-- After that: changing it requires the current password.
create or replace function set_admin_password(oid text, new_pw text, current_pw text default null) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(new_pw, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if not exists (select 1 from officers where id = oid and is_admin) then raise exception 'Only admins have passwords'; end if;
  if exists (select 1 from admin_passwords where officer_id = oid) and not verify_admin_password(oid, current_pw) then
    return false;
  end if;
  insert into admin_passwords (officer_id, pw_hash) values (oid, crypt(new_pw, gen_salt('bf')))
  on conflict (officer_id) do update set pw_hash = excluded.pw_hash, updated_at = now();
  return true;
end $$;

-- An admin can reset another admin's forgotten password by proving their own.
create or replace function reset_admin_password(target text, new_pw text, by_id text, by_pw text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(new_pw, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if not exists (select 1 from officers where id = by_id and is_admin) or not verify_admin_password(by_id, by_pw) then
    return false;
  end if;
  if not exists (select 1 from officers where id = target and is_admin) then raise exception 'Only admins have passwords'; end if;
  insert into admin_passwords (officer_id, pw_hash) values (target, crypt(new_pw, gen_salt('bf')))
  on conflict (officer_id) do update set pw_hash = excluded.pw_hash, updated_at = now();
  return true;
end $$;

grant execute on function admin_has_password(text), verify_admin_password(text, text),
  set_admin_password(text, text, text), reset_admin_password(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access rules.
-- There is no login yet, so anyone with the site URL can read and edit.
-- Replace these with auth-based policies once sign-in is added.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['officers','tasks','meetings','meeting_responses','task_comments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "open access" on %I', t);
    execute format('create policy "open access" on %I for all to anon, authenticated using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Storage bucket for uploaded minutes files.
insert into storage.buckets (id, name, public)
values ('minutes', 'minutes', true)
on conflict (id) do nothing;

drop policy if exists "minutes read"   on storage.objects;
drop policy if exists "minutes upload" on storage.objects;
drop policy if exists "minutes delete" on storage.objects;
create policy "minutes read"   on storage.objects for select to anon, authenticated using (bucket_id = 'minutes');
create policy "minutes upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'minutes');
create policy "minutes delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'minutes');

-- v4: profile photos (small square JPEGs in a public "avatars" bucket; officers store the URL).
alter table officers add column if not exists photo_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars read"   on storage.objects;
drop policy if exists "avatars upload" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;
create policy "avatars read"   on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy "avatars upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'avatars');
create policy "avatars delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'avatars');

-- Make the API pick up new columns/tables right away.
notify pgrst, 'reload schema';
