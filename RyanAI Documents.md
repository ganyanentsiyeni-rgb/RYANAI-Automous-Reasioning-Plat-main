# RyanAI Documents — Canonical Index

**Last reconciled:** 21 November 2026  
**Repository:** `ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main`  
**Documentation branch:** `docs/ryanai-documentation-sync-2026-11-21`  
**Main snapshot at start of this documentation update:** `daf185b348917e5c63f1b0b33917a65d9faabb25`

This index identifies the primary documents for product, architecture, agents, security, testing, data, communications, and release operations. A document is guidance, not evidence that a capability is deployed or passing. Source code, migrations, workflow files, provider deployment records, and exact-head test results are authoritative.

## 1. Start here

| Document | Purpose |
|---|---|
| [README.md](README.md) | Product overview, repository map, setup, and documentation entry point |
| [AGENTS.md](AGENTS.md) | Mandatory engineering, safety, review, and evidence contract |
| [agent.md](agent.md) | Agent authority model, task lifecycle, Comms rules, and handoff |
| [RyanAI.agent.skills.md](RyanAI.agent.skills.md) | Shared and domain-specific agent skill boundaries |
| [test.md](test.md) | Test layers, Comms regression matrix, CI/deployment gates, acceptance |
| [RyanAI architecture, security and patches.md](RyanAI%20architecture,%20security%20and%20patches.md) | Architecture, security baseline, migration ownership, patch protocol |
| [SECURITY.md](SECURITY.md) | Security reporting and disclosure policy |

## 2. Architecture and governance

- [Architecture overview](docs/ARCHITECTURE.md)
- [Canonical topology](docs/architecture/RYANAI_CANONICAL_TOPOLOGY.md)
- [Mission-centric operating architecture](docs/architecture/mission-centric-operating-architecture.md)
- [API control-plane contract](docs/architecture/API_CONTROL_PLANE_CONTRACT.md)
- [Agent governance engine](docs/architecture/AGENT_GOVERNANCE_ENGINE.md)
- [12-module agent workforce](docs/architecture/RYANAI-12-MODULE-AGENT-WORKFORCE.md)
- [Jarvis internal control plane](docs/architecture/internal-jarvis-control-plane.md)
- [MCP delegated runtime](docs/architecture/MCP_DELEGATED_RUNTIME.md)
- [Specialist adapter contract](docs/architecture/SPECIALIST-ADAPTER-CONTRACT.md)
- [Governed provider gateway](docs/architecture/GOVERNED_PROVIDER_GATEWAY_CONTRACT.md)

## 3. Agent execution, memory, and integrations

- [Jarvis integration](docs/JARVIS_INTEGRATION.md)
- [Agent evaluation and incremental migration](docs/agent-evaluation-and-incremental-migration.md)
- [Durable queue execution planner](docs/durable-queue-execution-planner.md)
- [Targeted execution reliability](docs/targeted-execution-reliability.md)
- [Agent run runtime recovery](docs/operations/agent-runs-runtime-recovery.md)
- [Agent run runtime schema review](docs/operations/agent-runs-runtime-schema-review.md)
- [Plugin integrations centre](docs/PLUGIN_INTEGRATIONS_CENTRE.md)
- [AI engineering tools registry](docs/ai-engineering-tools-registry.md)

## 4. Communications, voice, and attachments

- [Communications Gateway](docs/communications-gateway.md)
- [Owner communications production setup](docs/owner-communications-production-setup.md)
- [Private attachment storage](docs/SECURE_ATTACHMENT_STORAGE.md)
- [Attachment malware scanning](docs/ATTACHMENT_MALWARE_SCANNING.md)
- [Attachment message-path guard](docs/ATTACHMENT_MESSAGE_PATH_GUARD.md)
- [Attachment quarantine retention](docs/ATTACHMENT_QUARANTINE_RETENTION.md)
- [Attachment orphan cleanup](docs/ATTACHMENT_ORPHAN_CLEANUP.md)
- [RyanAI audio intelligence architecture](docs/ryanai-audio-intelligence-architecture.md)

**Required Comms invariant:** inbound admission is durable/idempotent; interrupted `in_flight` work is explicitly reconciled; AgentRun execution state is separate from append-only provider delivery receipts. Live external communications remain separately authorized and callback-verified.

## 5. Data, database, and migrations

- [Supabase migration ownership and local setup](supabase/README.md)
- [Database migration ownership and reproducibility](docs/operations/DATABASE_MIGRATION_OWNERSHIP_AND_REPRODUCIBILITY.md)
- [Database migration reconciliation](docs/operations/DATABASE_MIGRATION_RECONCILIATION_2026-11-08.md)
- [Supabase U2EB migration runbook](docs/operations/supabase-u2eb-migration-runbook.md)
- [Supabase PostgreSQL TLS trust](docs/operations/supabase-postgres-tls.md)
- [Production migrations runbook](docs/operations/production-migrations.md)
- [Shared Render/Railway environment variables](docs/operations/SHARED_ENV_VARIABLES_RENDER_RAILWAY.md)
- [Audiobook staging contract](AGENTS.md#neon-database-workflow)

## 6. CI, deployment, and operations

- [Governed production release](docs/governed-production-release.md)
- [Deployment and quota runbook](docs/DEPLOYMENT_AND_QUOTA_RUNBOOK.md)
- [Render environment alignment](docs/operations/render-environment-alignment.md)
- [Render/Railway deployment plan](docs/operations/render-primary-railway-backup-deployment-plan.md)
- [Main protection and Render recovery](docs/operations/main-protection-and-render-recovery.md)
- [Staging Render runtime verification](docs/ops/render-staging-runtime-verification.md)
- [Database branching and CI](docs/database-branching-cicd.md)
- [Engineering evidence workbench](docs/engineering-evidence-workbench.md)

Release CI targets: **Railway (primary gate), Render, Vercel, and MCP/MCP servers**. Each target requires exact-head terminal results, deployment identity, and runtime health evidence. Check current workflow files for exact job names and service mappings.

## 7. Product workspaces

- [Studio lifecycle](docs/studio/README.md)
- [Studio product blueprint](docs/studio/PRODUCT_BLUEPRINT.md)
- [Studio worker service](docs/studio/WORKER_SERVICE.md)
- [PhoneLink](docs/phonelink/README.md)
- [Audiobook render worker](docs/AUDIOBOOK_RENDER_WORKER.md)
- [Quant Engine](quant-engine/README.md)
- [Quant market data contract](docs/QUANT_MARKET_DATA.md)
- [Hybrid OS v1](docs/hybrid-os-v1.md)
- [Raspberry Pi edge platform](docs/hardware/ryanai-edge.md)
- [Recovery and integrity layer](docs/recovery/ryanai-recovery.md)

## 8. Model and benchmark governance

- [RIIP model registry](docs/architecture/RIIP-MODEL-REGISTRY.md)
- [RIIP universal model governance](docs/architecture/RIIP-UNIVERSAL-MODEL-GOVERNANCE.md)
- [Specialist model fit and adoption](docs/architecture/SPECIALIST_MODEL_FIT_AND_ADOPTION.md)
- [Benchmark operational readiness](docs/architecture/BENCHMARK-OPERATIONAL-READINESS.md)
- [Benchmark executable checks](docs/architecture/BENCHMARK-GATE-EXECUTABLE-CHECKS.md)
- [Offline benchmark harness proposal](docs/architecture/OFFLINE-BENCHMARK-HARNESS-IMPLEMENTATION-PROPOSAL.md)

## 9. Security and privacy

- [Hybrid OS security architecture](docs/security/hybrid-os-security.md)
- [Gen-X security hardening](docs/GENX_HARDCORE_SECURITY.md)
- [Security Centre data contract](docs/SECURITY_CENTRE_DATA_CONTRACT.md)
- [Security cleanup runbook](docs/SECURITY_CLEANUP.md)
- [Static security audit](docs/PR-1345-static-security-audit.md)
- [Supabase Auth completion](docs/auth/supabase-auth-completion.md)

## 10. Document maintenance rules

1. Update the owning technical document when implementation contracts change; do not rely on README-only summaries.
2. Date operational snapshots and include exact commit/workflow/provider references.
3. Label target architecture, implemented behavior, tested behavior, deployed behavior, and runtime-verified behavior separately.
4. Remove stale statements when contradicted by newer evidence; retain historical records only when clearly dated.
5. Never include secrets, personal data, unredacted provider payloads, or private connection strings.
6. Validate every link and path before claiming this index is exhaustive.
7. Keep this index aligned with README and the actual repository tree during each documentation release.

## 11. Explicit non-claims

This document does not certify that all listed files are present, all integrations are enabled, CI is green, services are deployed, or production is ready. The repository's workflows and runtime evidence must be checked at the candidate SHA. No deployment, production migration, secret change, infrastructure mutation, paid upgrade, or live communication is authorized by documentation.
