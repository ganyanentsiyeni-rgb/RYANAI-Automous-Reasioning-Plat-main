# Governed production release

This repository now contains a manually invoked release orchestrator and workflow. It is intentionally not self-triggering.

## Release order

1. GitHub Actions starts only through workflow_dispatch.
2. The operator must enter RELEASE.
3. The selected GitHub Environment (production or staging) applies its configured protection rules before the job can access environment secrets.
4. Offline PagerDuty/deployment contract tests run.
5. The disposable PostgreSQL integration dry-run runs before any live migration.
6. Prisma generates the client and applies the committed migration chain to the selected target database.
7. A provider-specific rollout command is executed from the protected environment variable PRODUCTION_ROLLOUT_COMMAND or STAGING_ROLLOUT_COMMAND.
8. The configured health endpoint is polled until HTTP 200 and, for this workflow, a JSON database: "ok" state are observed.
9. PagerDuty maintenance is closed by the context manager.
10. A successful deployment resolves the same PagerDuty Events API v2 dedup_key. A failed deployment triggers/updates the same key.

## Required protected configuration

The repository does **not** create secrets or infrastructure. Configure these only in the appropriate GitHub Environment.

### Production secrets

- PRODUCTION_DATABASE_URL
- PAGERDUTY_TOKEN
- PAGERDUTY_USER_EMAIL
- PAGERDUTY_SERVICE_IDS
- PAGERDUTY_ROUTING_KEY
- SLACK_WEBHOOK_URL (optional)

### Production environment variables

- PRODUCTION_HEALTH_URL
- PRODUCTION_ROLLOUT_COMMAND

Use equivalent STAGING_* names in the staging environment.

The production environment should require a human reviewer and should disallow administrator bypass where organizational policy permits. Environment protection rules are the control that prevents the job from receiving environment secrets before approval.

## Rollout command boundary

The orchestrator deliberately refuses to invent a provider-specific rollout command. This repository currently spans Render, Vercel, and Railway workloads, so the command must be supplied by an authorized environment configuration rather than hard-coded from an assumption.

The configured command should be the smallest reviewed provider command required for the selected environment.

## PagerDuty safety

pagerduty_manager.py uses:

- 10-second HTTP request timeout.
- Three attempts for transient 5xx and network timeout/connection failures.
- Exponential backoff with jitter.
- Immediate failure for 403 and other non-transient client responses.
- Exception-preserving maintenance cleanup.
- A stable incident deduplication key for trigger/resolve.

No live PagerDuty call occurs in the offline contract tests.

## Slack

The workflow sends success/failure notifications only when SLACK_WEBHOOK_URL is configured. The webhook value is read from a GitHub secret and is never stored in source.

## Grafana Alloy

observability/grafana/alloy/config.alloy is a configuration example for a persistent deployment/observability host. GitHub-hosted runners are ephemeral; the workflow therefore emits structured JSON logs and uploads the release log as an artifact. A persistent Alloy installation can tail the configured log path and forward telemetry to Grafana Cloud.

The provisioning files use placeholders for the Grafana Cloud Loki datasource UID and PagerDuty integration key. They contain no credentials.

## Explicit non-actions

This PR does not:

- create or modify GitHub secrets;
- execute a production deployment;
- execute a production database migration;
- create a PagerDuty maintenance window or incident during CI tests;
- change paid plans;
- bypass branch protection or required review;
- enable an automatic push-to-production trigger.
