# RyanAI Hybrid OS v1 — Implementation Validation Matrix

This matrix defines evidence required before moving from documentation into implementation. It does not authorize production changes.

| Workstream | Required evidence | Acceptance condition |
|---|---|---|
| Ubuntu Core | Service inventory, runtime boundaries, health checks | Core workloads isolated and reproducibly built |
| Kali Security | Written scope, isolated lab, findings and regression tests | Assessment is authorized and cannot silently mutate production |
| Raspberry Pi Edge | Device enrollment, certificate, gateway and revocation tests | Untrusted/revoked devices are denied |
| Security Fabric | Route/capability authorization matrix, negative tests | Every consequential path enforces identity and policy |
| Network zones | Firewall/ACL configuration and reachability tests | Default-deny boundaries are demonstrated |
| Secrets | Secret scan, runtime identity review, TLS validation | No source leaks; certificate validation remains enabled |
| Audit | Allow/deny/approval/execution event samples | Events are correlated and contain no secrets |
| Recovery | Isolated restore and integrity report | Restore is demonstrated, not merely backup completion |
| CI/security | Exact commit SHA and workflow/check-run evidence | Required checks pass; skipped/queued/missing are not passes |

## Phase gates

- **Gate 0 — Documentation:** architecture, security, edge, recovery, README alignment, and threat assumptions reviewed.
- **Gate 1 — Repository validation:** architecture mapped to actual services, packages, workflows, and current authorization paths.
- **Gate 2 — Lab implementation:** Ubuntu/Kali/Pi experiments in isolated non-production environments.
- **Gate 3 — Integration:** identity, gateway, audit, policy, and recovery controls tested end-to-end.
- **Gate 4 — Production proposal:** separate change plan, rollback plan, required approvals, and evidence package.

Each gate requires a named reviewer and evidence links. A green status must be tied to the exact tested commit.
