# Officer Hub

**Live:** https://arnavmishradll.github.io/officer-hub/

On iPhone: open the link in Safari → Share → **Add to Home Screen**. It opens full screen like an app.

Updating the live site: commit and push to `main`. GitHub Pages rebuilds in about a minute.

A lightweight, Quickbase-style tracker for managing officer tasks, meeting attendance, and minutes.
Plain HTML/CSS/JS — no build step, so it runs on GitHub Pages as-is.

## Updating the database
When the app adds features that need new columns or tables, re-run `supabase/schema.sql` in the SQL Editor.
It's safe to run again: it never deletes data.

## Features
- **My Tasks** — each officer sees tasks assigned to them plus tasks others shared with them.
- **Add tasks** — officers add tasks for themselves; admins (VP/President) can assign to anyone.
- **Share / involve officers** — tick other officers on any task.
- **Due dates + automatic urgency** — Overdue · Due today · Urgent (1–2 days) · This week · Upcoming · Done.
- **Master List** (admins only) — every task, per-officer completion breakdown, filters, search, sortable columns, group-by-owner, CSV export.
- **Meetings & attendance** — RSVP; choosing "can't make it" requires two sections: *upcoming items/events* and *requests for other officers*. Admins mark who was present and can turn a request into a task in one click.
- **Minutes** — admins upload files (PDF/Word/etc.), paste a Google Docs link, or type notes for each meeting.
- **Officers** — add/edit officers and admin rights; export/import JSON backups.

## Run locally
Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8765
```

Then visit http://localhost:8765.

## Put it on GitHub Pages
1. Create a new repo on GitHub (e.g. `officer-hub`).
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Officer Hub"
   git branch -M main
   git remote add origin https://github.com/<your-username>/officer-hub.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / root → Save**.
4. After ~1 minute it's live at `https://<your-username>.github.io/officer-hub/`.

## Connect Supabase (shared data)
Without this, data is saved in each browser only.

1. In Supabase, open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   This creates the tables, turns on live updates, and makes a `minutes` storage bucket for uploaded files.
2. In **Project Settings → API** (or the **Connect** button), copy the **Project URL** and the **publishable** key
   (or the legacy **anon public** key). Never use the `service_role` / secret key here.
3. Paste both into [`config.js`](config.js).
4. Reload the page. **Officers → Data** should say **Connected**.

To bring over data you entered in local mode: export a backup *before* filling in `config.js`, then import it afterwards.

On a brand-new database you'll start with one admin officer named "Vice President". Rename it to yourself
on the Officers tab and add everyone else.

### Demo data
`supabase/load-demo.js` fills the database with realistic mid-semester tasks, meetings, RSVPs, and minutes
for the officers already in the database. Every demo row's id starts with `demo-`. To remove all of it
without touching officers or anything real, run [`supabase/remove-demo.sql`](supabase/remove-demo.sql) in the SQL Editor.

### Security note
There is no login yet. The "Signed in as" dropdown runs on the honor system, and anyone who has the site URL
can read and edit the data. Fine for testing. Add Supabase Auth sign-in before sharing it widely.
