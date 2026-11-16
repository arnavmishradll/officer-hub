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

-- Make the API pick up new columns/tables right away.
notify pgrst, 'reload schema';
