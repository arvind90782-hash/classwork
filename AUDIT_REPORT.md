# Phase 0-2 Repair Audit

## Confirmed root cause

The original submissions table had no explicit approval lifecycle. It used `is_hidden` only, while the UI had no database-backed approve/reject action. As a result, every submitted page could be queried as part of the class archive regardless of whether an owner had reviewed it, and approved/pending/rejected state was ambiguous.

## Bugs fixed

- Added `pending_review`, `approved`, `rejected`, and `archived` submission states.
- Added owner-only database RPC approval/rejection review.
- Added review notes, reviewer, review timestamp, approval timestamp, and audit logging.
- Made owner All Submissions load pending and historical submissions.
- Made ordinary student subject and notebook queries require approved submissions.
- Allowed contributors to see their own submission history regardless of review state.
- Restricted owner curation to approved submission pages.
- Corrected the class-document storage upload policy syntax in migration 005.
- Added indexes for task, contributor, and approval-state queries.

## Existing data preservation

Migration 006 is additive. It does not delete or overwrite image files or submission records.

- Existing submissions with `is_hidden = false` are backfilled to `approved`.
- Existing submissions with `is_hidden = true` are backfilled to `rejected`.
- Original upload timestamps and storage paths remain unchanged.
- Existing approved pages remain in the archive.

Before running migration 006, take both a PostgreSQL backup and a Supabase Storage bucket backup. Record the counts of submissions, submission pages, tasks, and storage objects before and after migration.

## Security

- Private Storage buckets remain private.
- Signed URLs are used for approved or contributor-owned pages.
- Student RLS allows approved cross-student class library access only for approved submissions.
- The owner-only review RPC verifies owner status and class membership in PostgreSQL.
- Students cannot call the review RPC unless they are the owner of the submission's class.

## Remaining external work

The following cannot be verified from repository code alone:

- Applying migrations to the production Supabase project.
- Counting and verifying existing production records.
- Running database/RLS tests against an isolated Supabase test project.
- Confirming Supabase Storage bucket configuration and backup/restore status.
- Confirming deployment URL and production health.
- Confirming GitHub branch protection and deployment credentials.

Do not apply migration 006 to production until the PostgreSQL backup and Storage backup checks are complete.
