# Classwork

A private Class 5 digital notebook built with React, TypeScript, Tailwind CSS, Supabase, and jsPDF.

## Supabase setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/migrations/001_classwork.sql`.
3. In **Authentication**, enable Email/password sign-in.
4. Create `.env.local` from `.env.example` and set:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_OWNER_EMAIL=owner@example.com
```

5. Set the private class invite code. Replace the placeholder with a private code you have not shared publicly:

```sql
update public.classes
set invite_code_hash = extensions.crypt('YOUR_PRIVATE_INVITE_CODE', extensions.gen_salt('bf'))
where name = 'Class 5';
```

The migration seeds the six Class 5 subjects.

6. Create the owner account through the app or Supabase Auth, then set ownership explicitly:

```sql
update public.students
set is_owner = true, status = 'approved'
where id = 'OWNER_AUTH_USER_UUID';
```

Never expose the Supabase service-role key in frontend code or Vite variables.

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
