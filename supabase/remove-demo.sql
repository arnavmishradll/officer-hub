-- Removes ONLY the demo data created by load-demo.js (every demo row's id starts with "demo-").
-- Officers and anything you entered yourself are left alone.
-- Paste into Supabase → SQL Editor → Run.
do $$
begin
  if to_regclass('public.task_comments') is not null then
    delete from task_comments where id like 'demo-%' or task_id like 'demo-%';
  end if;
end $$;
delete from meeting_responses where meeting_id like 'demo-%';
delete from meetings where id like 'demo-%';
delete from tasks where id like 'demo-%';
