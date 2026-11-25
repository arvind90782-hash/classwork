# Classwork

A private Class 5 digital notebook built with React, TypeScript, Tailwind CSS, Supabase, and jsPDF.

## Supabase setup

1. Create a Supabase project.
2. Before changing an existing project, make and verify both a PostgreSQL backup and a Storage object backup. Never reset the database to install this application.
3. On a new project, apply every file in `supabase/migrations/` in numeric order, from `001_classwork.sql` through `007_preferences_routes_audit.sql`. On an existing project, first inspect its migration history and schema; apply only migrations that have not already run, in order, and review their effects before execution. Never rerun the base migration on an existing database. Do not stop at migration 001: later migrations replace its initial owner-join implementation and add required policies and workflow tables.
4. In **Authentication**, enable Email/password sign-in.
5. Create `.env.local` from `.env.example` and set:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

6. Set the private class invite code. Replace the placeholder with a private code you have not shared publicly:

```sql
update public.classes
set invite_code_hash = extensions.crypt('YOUR_PRIVATE_INVITE_CODE', extensions.gen_salt('bf'))
where name = 'Class 5';
```

The migrations seed any missing default Class 5 subjects without re-enabling subjects the owner has paused.

7. Create the owner account through the app or Supabase Auth, then set ownership explicitly:

```sql
update public.students
set is_owner = true, status = 'approved'
where id = 'OWNER_AUTH_USER_UUID';
```

Never expose the Supabase service-role key in frontend code or Vite variables.

## Approving members

Sign in using the owner account, open **Admin Panel → Student approvals** (or **Member Approvals** in the sidebar), then choose **Approve** or **Decline**. New requests update the notification bell in real time; the app also refreshes the queue every 15 seconds as a fallback. Once approved, the student's pending screen refreshes automatically.

Students can upload multi-page work using the gallery picker or capture pages directly with the camera. **Class Pages** is a separate shared class library for index pages, the yearly syllabus, timetables, notices, and custom categories. Owners can review uploaded work under **All Submissions**, select pages for the curated notebook, and download the selected images as a PDF. Students can search submissions and view their own uploads under **My Contributions**.

Email alerts to the owner are not configured yet. In-app notifications work without exposing an email credential in the browser; choose a trusted server-side email provider before enabling Gmail delivery.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

Deploy to Vercel with the `VITE_SUPABASE_*` environment variables.
