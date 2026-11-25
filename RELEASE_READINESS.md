# Classwork release readiness review

**Review date:** 2026-11-25
**Status:** **Not ready for public launch**
**Scope:** Local repository, ordered SQL migration files, local build/lint, and a basic HTTP check of the configured public URL. The connected Supabase database, Storage, provider settings, and Vercel project settings were not available for authenticated inspection.

## Project architecture observed

- React 19, TypeScript, and Vite single-page application.
- Supabase JavaScript client using the public URL and anon key from frontend environment variables.
- PostgreSQL schema and RLS policies are defined in `supabase/migrations/001_classwork.sql` through `007_preferences_routes_audit.sql`.
- Private Storage buckets are defined for notebook pages, class documents, and published PDFs.
- Notebook PDF compilation runs in the browser using jsPDF and signed Storage URLs.
- The repository contains CI for a production build and Oxlint. It has no automated application, database, or browser test suite.

## Existing features observed

- Email/password sign-in and registration, invite-code class joining, pending/approved/suspended account states.
- Six seeded subjects, task and submission workflows, multi-page uploads, class documents, owner review, reports, curated notebook pages, PDF archives, user preferences, and basic owner settings.
- Migration 004 replaces the initial migration's hard-coded email-based owner promotion with a pending-only class join. The full migration chain must be applied in order; applying only migration 001 leaves the unsafe original function in place.
- Migration 006 adds an approval lifecycle and backfills existing visible/hidden submissions without deleting rows or files. The actual production counts and migration state remain unknown. Do not apply it before database and Storage backups are independently verified.

## Changes made in this readiness branch

- Removed browser route and user-agent values from authentication audit events. Session refreshes are no longer written as audit activity.
- Sign-out no longer depends on an audit RPC succeeding.
- Updated public metadata and sign-in copy to identify Classwork as an independent, unofficial project and removed an unverified "secure" claim.
- Created this report to distinguish repository evidence from production facts that still require verification.

## Data and storage inventory from code review

| Data | Source and purpose | Location/access seen in code | Retention/deletion |
|---|---|---|---|
| Auth email and password credential | Email/password account creation and sign-in | Supabase Auth; password is submitted to Supabase Auth | Not configured or verified |
| Display name, roll number, class, account status, owner flag | Class join and owner-managed registration | `public.students`; access governed by database RLS | Not configured or verified |
| Task details, dates, subject, submissions, page metadata, reports, page selections, review history | Classwork and notebook workflows | Public-schema tables; private image objects in `classwork-pages` | Not configured or verified |
| Class documents and page metadata | Shared class reference pages | `class_documents`, `class_document_pages`; private objects in `classwork-documents` | Not configured or verified |
| Published PDF metadata and files | Owner-published notebook archives | `daily_pdf_archives`; private objects in `classwork-pdfs` | Not configured or verified |
| Theme, language, notification and view preferences | Settings screen | `user_preferences` | Deleted by account cascade only if configured schema is applied; production state unknown |
| Owner settings and audit events | Admin controls and operational history | `admin_settings`, `audit_logs` | Not configured or verified |
| Authentication session | Supabase client session persistence | Supabase JS client default browser persistence; live browser storage was not inspected | Session expiry/provider behavior not verified |

The repository has no analytics integration, advertising pixel, explicit cookie banner, optional-cookie loader, policy center, or guardian-consent workflow. Code review did not find direct `document.cookie`, `localStorage`, or `sessionStorage` calls. Supabase Auth uses browser session persistence; actual storage keys and provider cookies must be checked in a running browser and provider configuration before publishing a complete cookie inventory. Google OAuth is not implemented in this application.

## Confirmed gaps and launch blockers

- **Authentication:** Google OAuth, password reset/recovery UI, guardian-assisted account flow, consent verification, and account deletion request handling are absent. Registration currently accepts email/password, name, roll number, and invite code.
- **Child protection:** There is no guardian consent record or verified guardian workflow. Owner approval alone cannot establish guardian authorisation.
- **Privacy/legal:** Terms, Privacy, Cookie, guardian, content reporting/copyright, data rights, grievance, and responsible-use pages are absent. There is no owner Data Inventory screen, consent withdrawal, export, correction, or deletion request workflow.
- **Administration:** Admin settings are incomplete. The UI itself says maintenance mode is recorded for future enforcement; the approval-required setting also needs end-to-end enforcement verification. The requested live health, storage, backup, error, and PDF job metrics are not established by the reviewed UI.
- **Reliability and operations:** No configured retention policy, verified PostgreSQL backup, Storage backup, restore procedure/test, production migration inventory, or object reconciliation result is available.
- **Security verification:** RLS/storage rules have not been exercised against a staging project. IDOR, role escalation, upload limits, rate limits, grants, redirects, and private-object access are untested. Do not treat source inspection as a passing security test.
- **Internationalisation:** Settings offer English and Hindi only; the interface is otherwise hard-coded English. Hinglish and application-wide translations are absent.
- **Production configuration:** Local `.env.local` contains non-empty public Supabase frontend values and is ignored by Git. Its values were not disclosed or validated. No service-role key was found in tracked files. Supabase and Vercel project settings were not available for inspection.

## Verification results

- `npm run build`: **passed**. Vite reports the main generated JavaScript chunk is about 985 kB before gzip and recommends code splitting.
- `npm run lint`: **passed with warnings**. Oxlint reports existing React dependency and set-state-in-effect warnings in `src/App.tsx`. Warnings remain to be resolved.
- Automated tests: **not available**; no test script or test suite exists in `package.json`.
- Public URL `https://classwork-flax-one.vercel.app/`: **HTTP 200** on 2026-11-25. This confirms an HTTP response only, not login, data access, deployment commit, or application health.
- Supabase Auth health endpoint: **HTTP 401** without a provider health credential; this is not evidence that the project is healthy or unhealthy. No authenticated database or Storage inspection was performed.
- GitHub Actions: the `verify` job **succeeded** for both the branch push and pull request. The workflow runs the build and lint commands; warnings remain as listed above.
- GitHub: the local checkout was `main` at `d6c7598` (`origin/main`) before work. The reviewed changes are committed on `release-preparation/launch-readiness` and proposed in [draft pull request #1](https://github.com/arvind90782-hash/classwork/pull/1). The PR is a review artifact, not a launch approval.

## Required next actions before launch

1. Obtain read-only authenticated access to the connected Supabase project and verify applied migration versions, RLS, grants, bucket privacy, records, object counts, project region, and Auth providers.
2. Create and validate database and Storage backups, record recovery points, and perform a restore test in an isolated staging project before any production migration.
3. Review the child account and guardian authorisation model with the responsible adult and qualified legal reviewer; obtain any required school distribution permission.
4. Implement and stage-test OAuth/email recovery, guardian workflow, access requests, data rights, policies, cookie preferences, and actual owner inventory controls before collecting student data.
5. Add isolated staging, database/RLS and browser tests; test all subjects, upload/review, notebooks, PDFs, permissions, and recovery without production student records.
6. Resolve lint warnings, enforce each admin setting end to end, verify the production deployment commit/configuration, and complete the required review gates before considering merge or launch.

No production migration, database write, Storage change, push, merge, or deployment was performed during this review.
