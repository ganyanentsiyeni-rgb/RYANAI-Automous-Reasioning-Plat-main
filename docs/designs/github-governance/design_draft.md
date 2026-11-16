# RyanAI GitHub governance — design draft

**Status:** Draft; owner/admin action required.  
**EGM independent review:** Blocked — fresh Goldfish subagent contexts are unavailable in this environment.

## Current evidence

Ruleset `26360956` is active on `main`. Its detail currently shows:
- Pull-request rule requiring one approval and dismissing stale reviews.
- Required status checks configured.
- Required deployment environments, merge queue, linear history and signed commits.
- `require_last_push_approval: false`.
- `current_user_can_bypass: always`.
- Multiple bypass actors, including OrganizationAdmin, repository roles and numerous integrations with `always` bypass.
- The connected GitHub integration cannot read classic branch protection (HTTP 403) and has no ruleset administration action.

PR #1391 merged without review submissions while its exact-head checks were queued. PR #1390 also merged without recorded review submissions; its exact-head CI included failures. PR #1392 proposes a workflow gate requiring a current approval on the exact head, but its check remains queued and is not currently listed in the ruleset's required status checks.

## Goals

1. Require a pull request for every main change.
2. Require at least one independent approval tied to the current PR head.
3. Require current, successful CI and security checks before merge.
4. Dismiss stale approvals and require approval after the latest push.
5. Prevent routine automation and integrations from bypassing protections.
6. Keep emergency bypass narrowly scoped, audited and time-limited.
7. Keep auto-merge disabled and preserve human merge authorization.

## Proposed owner/admin changes

- Add the exact `Human PR Approval Gate / Require independent human approval` check from PR #1392 to required checks only after its workflow is verified.
- Set last-push approval requirement true and retain stale-review dismissal and thread resolution.
- Remove routine `always` bypass actors, including integration actors. If a break-glass exception is retained, restrict it to an explicitly documented, audited emergency process.
- Prohibit force-push and branch deletion.
- Verify deployment environment names and required-check contexts against active workflows; remove stale contexts only after evidence confirms they are obsolete.
- Test protections with a non-bypass actor and prove that missing approval or failed/queued checks block merge.

## Acceptance criteria

- [ ] Effective ruleset JSON has no routine integration or role bypass.
- [ ] A PR cannot merge without an independent approval on its latest head.
- [ ] A PR cannot merge with failed, queued, skipped, cancelled or missing required checks.
- [ ] Force-push and deletion are blocked on main.
- [ ] A non-bypass integration actor is unable to bypass protections.
- [ ] Human reviewer and owner retain final merge authority.
- [ ] Admin change and test evidence are recorded.

## Limitations and approvals

The connected GitHub integration is read-only for ruleset administration; no settings mutation is attempted. A repository administrator must perform and verify the changes. This draft does not authorize merge, deployment, production migration, secret changes or infrastructure changes.

Goldfish review: blocked; fresh reviewer contexts not executed. Human owner/admin review and approval remain required.
