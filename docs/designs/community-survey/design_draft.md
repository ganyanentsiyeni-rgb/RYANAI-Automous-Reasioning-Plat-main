# RyanAI Community Survey — reliability design draft

**Status:** Draft only; not owner-approved.  
**EGM independent review:** Blocked — fresh Goldfish subagent contexts are not available in this connected environment. No Goldfish review is claimed.  
**Pilot scope:** Public Community Survey submission, anonymous response storage, separate Beta-interest registration, and private owner notification.

## Problem and source context

The public survey was introduced in PR #1388, then its anonymity and FAQ flow were changed in PR #1389, and its API handler / Supabase migration were repaired in PR #1390. Those PRs merged without recorded review submissions and their exact-head CI evidence included failures.

Current source references:
- `src/pages/CommunitySurvey.tsx`
- `src/server/launcher.ts` — `POST /api/community-feedback` and `POST /api/community-beta-interest`
- `supabase/migrations/20261108195000_community_feedback_submissions.sql`
- PRs #1388, #1389 and #1390
- Workflow run #42510586224 and job #128822559274 (survey UI change)
- Workflow run #42511346807 and job #128824883839 (survey API/migration repair)

## Goals

1. Keep public survey answers anonymous: no respondent account ID, name, or email in the answer record.
2. Keep optional Beta contact details in a separate table and route, gated by explicit consent.
3. Persist survey answers before attempting owner notification; a mail-provider failure must not discard a response.
4. Route owner notifications to the owner-confirmed address `rmnganyane@gmail.com`.
5. Show truthful notification state to the submitter. SMTP/provider acceptance is not final mailbox delivery.
6. Preserve server-side rate limits and input bounds.
7. Establish automated tests for anonymous payload shape, response persistence behavior, separate Beta registration, and notification outcomes.

## Current implementation facts

- `/api/community-feedback` validates required answers and limits requests to five per hour.
- The handler inserts answers into `public.community_feedback_submissions` before sending an owner email.
- Owner email currently depends on `RYANAI_OWNER_EMAIL`, `SMTP_USER`, and `SMTP_PASS`; the actual configured values have not been inspected or exposed here.
- The API returns `accepted`, `failed`, or `not_configured` for notification status. `accepted` means the mail transport accepted the send request, not that the mailbox received it.
- `/api/community-beta-interest` is separate, requires consent, and is limited to three requests per hour.
- The Supabase migration creates separate response and Beta-interest tables and revokes public/anon/authenticated table privileges.
- The UI source contained stale contact fields and duplicate component fragments. This PR removes those remnants, preserves the separate Beta form, and exposes the API's notification status.
- The UI FAQ previously claimed survey submission sends no messages, although the API attempts a private owner notification. The wording is corrected.

## Proposed reliability design — not yet approved

### Persistence and privacy
- Keep anonymous answers and Beta contact details in separate tables with no join key.
- Confirm table ownership and grants against the actual Supabase project and the API's database role.
- Add a durable notification outbox only after Prisma/Supabase migration ownership and existing outbox/queue contracts are reconciled.
- Define idempotency before enabling automatic retries, so a retry cannot create duplicate owner notifications.

### Owner notification
- Use the owner-confirmed recipient `rmnganyane@gmail.com`; do not rely on an unverified environment value.
- Store notification attempts and provider message identifiers in a durable, access-controlled outbox.
- Retry transient failures with bounded exponential backoff and a terminal dead-letter state.
- Distinguish queued, accepted, delivered (only with a provider delivery callback), bounced, failed, and not-configured.
- Never claim delivery from SMTP acceptance alone.
- Do not perform a live test send until provider callback capability, destination ownership, and explicit test authorization are verified.

### UI behavior
- Confirm survey persistence independently of notification outcome.
- Explain that the survey is anonymous and Beta registration is separate.
- Display notification status without exposing SMTP credentials or internal configuration.
- Do not imply a respondent will receive email or other messages.

## Acceptance criteria

- [ ] The survey page compiles and renders on mobile and desktop.
- [ ] The anonymous request contains no contact name, contact email, consent field, or account identifier.
- [ ] Valid survey answers persist in the expected table; invalid or rate-limited submissions are rejected.
- [ ] Beta details are written only through the separate consent-gated route.
- [ ] Owner notification targets `rmnganyane@gmail.com`.
- [ ] Mail-provider failure does not undo an already-persisted survey response.
- [ ] Provider acceptance is not displayed as confirmed delivery.
- [ ] A durable retry/idempotency design is approved and tested before retries are enabled.
- [ ] Supabase migration replay, schema validation, and relevant API regression tests pass on the exact PR head.
- [ ] No production migration or deployment occurs without separate approval.

## Open decisions and blockers

1. Confirm whether the existing API database role can insert into the two survey tables after the migration's privilege revocations.
2. Reconcile Supabase and Prisma migration ownership before adding an outbox table.
3. Confirm provider callback support and the destination verification path.
4. Obtain fresh Goldfish review in a supported EGM environment, or record a separate human review. This draft is not Goldfish-reviewed.
5. Obtain owner approval of the final specification before implementing schema changes or retry workers.

## Implementation traceability

- Current repair branch: `repair/community-survey-ui-20261108`
- UI repair and regression test are proposed in PR #1393.
- Exact PR head and CI results will be recorded after PR creation.
- No production database migration, deployment, secret change, or live email test is included.
