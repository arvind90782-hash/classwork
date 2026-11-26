# Classwork

A private Class 5 digital notebook built with React, TypeScript, Tailwind CSS, Supabase, and jsPDF.

## Supabase setup

1. Create a Supabase project.
2. Before changing an existing project, make and verify both a PostgreSQL backup and a Storage object backup. Never reset the database to install this application.
3. On a new project, apply every file in `supabase/migrations/` in numeric order, from `001_classwork.sql` through `008_firebase_verified_identity.sql`. On an existing project, first inspect its migration history and schema; apply only migrations that have not already run, in order, and review their effects before execution. Never rerun the base migration on an existing database. Do not stop at migration 001: later migrations replace its initial owner-join implementation and add required policies and workflow tables. Migration 008 adds verified-email restrictions and does not alter existing records.
4. In **Authentication**, enable Email/password sign-in. Set up Firebase Auth as a third-party provider in Supabase Auth using the Firebase Console's **Project ID** (`classwork-ec166`, not the public-facing name). This lets verified Firebase ID tokens use the existing Supabase RLS policies.
5. In Firebase, enable the Email/Password provider, register the web app, add your app domains to Authorized domains, and configure reCAPTCHA v3 in App Check. The provisioning function requires App Check.
6. Create `.env.local` from `.env.example` and fill in the Firebase web app settings and reCAPTCHA v3 site key. The Firebase project ID must match the one configured in Supabase:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_FIREBASE_API_KEY=your-firebase-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-firebase-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
VITE_FIREBASE_APP_ID=your-firebase-web-app-id
VITE_FIREBASE_APPCHECK_SITE_KEY=your-recaptcha-v3-site-key
```

7. Deploy the Firebase account-provisioning function. It creates a matching Supabase Auth identity for new Firebase users; existing class records are not migrated or rewritten. Install the Firebase CLI, sign in, set these secrets without committing or sharing the service-role key, then deploy:

```text
firebase functions:secrets:set SUPABASE_URL --project your-firebase-project-id
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY --project your-firebase-project-id
firebase deploy --only functions --project your-firebase-project-id
```

The Cloud Functions runtime service account needs permission to sign Firebase custom tokens. The service-role key is used only by the server-side function and must never be added to Vite or Vercel frontend variables.

8. Set the private class invite code. Replace the placeholder with a private code you have not shared publicly:

```sql
update public.classes
set invite_code_hash = extensions.crypt('YOUR_PRIVATE_INVITE_CODE', extensions.gen_salt('bf'))
where name = 'Class 5';
```

The migrations seed any missing default Class 5 subjects without re-enabling subjects the owner has paused.

9. Create the owner account through the app. If an owner identity already exists in Supabase Auth, registering the same email links Firebase to that existing UUID; verify the email before signing in. Then set ownership explicitly:

```sql
update public.students
set is_owner = true, status = 'approved'
where id = 'OWNER_AUTH_USER_UUID';
```

Never expose the Supabase service-role key in frontend code or Vite variables.

## Approving members

Sign in using the owner account, open **Admin Panel → Student approvals** (or **Member Approvals** in the sidebar), then choose **Approve** or **Decline**. New requests update the notification bell in real time; the app also refreshes the queue every 15 seconds as a fallback. Once approved, the student's pending screen refreshes automatically.

Students create an account with **Sign up**, verify the email, then submit their name, roll number, and class invite code. The request should appear in **Member Approvals** with status **pending**; sign in with an existing account using **Sign in**. Use **Forgot password?** to request a Firebase password reset. Account creation requires the deployed Firebase provisioning functions, a registered App Check reCAPTCHA v3 key for the production domain, and the Firebase third-party provider plus migrations configured in Supabase.

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

Deploy to Vercel with the `VITE_SUPABASE_*` and `VITE_FIREBASE_*` public environment variables. Set Firebase Authorized domains and App Check for the production domain as well.
