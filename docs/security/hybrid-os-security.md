# RyanAI Hybrid OS v1 — Security Architecture

**Status:** Proposed implementation baseline  
**Scope:** Architecture and documentation; no production changes authorized.

## 1. Security objectives

Preserve confidentiality, integrity, availability, traceability, and human control across core, security-testing, edge, management, and recovery environments.

- Authenticate every human, service, workload, agent, and edge device.
- Authorize each capability for a specific resource and action.
- Deny by default; grant least privilege and short-lived access.
- Encrypt data in transit and protect sensitive data at rest.
- Record policy decisions and execution outcomes.
- Treat model output, tool output, and device input as untrusted until validated.

## 2. Trust zones

| Zone | Purpose | Default access |
|---|---|---|
| CORE | Ubuntu RyanAI services | Explicitly authorized service paths |
| SECURITY | Kali assessment and defensive testing | No standing production credentials |
| EDGE | Raspberry Pi OS devices and sensors | Outbound authenticated gateway path |
| MANAGEMENT | Operator/admin maintenance | Strong authentication and audited actions |
| RECOVERY | Backup, integrity, rebuild, restore | Isolated and independently controlled |

Inter-zone traffic is denied unless a documented rule permits a specific source, destination, protocol, and purpose. Documentation alone is not enforcement; network controls and reachability tests must prove segmentation.

## 3. Identity and authorization

Every principal has a distinct identity: human operator, service/workload, capability-scoped agent, or enrolled edge device. Authorization is evaluated at the execution boundary, not only in the UI.

1. Agent or operator submits an action request.
2. Capability gateway validates identity, schema, scope, and resource.
3. Gen-X evaluates policy and risk.
4. Human approval is obtained where required.
5. Executor receives narrowly scoped, action-bound authority.
6. Execution result and evidence receipt are recorded.

No model, agent, plugin, or device may grant itself authority. Approval for one action cannot authorize a different action.

## 4. Secrets and cryptography

- Never commit credentials, private keys, tokens, connection strings, or recovery codes.
- Do not place unrestricted production credentials on Kali or edge devices.
- Prefer workload identity and short-lived credentials.
- Keep key management separate from application logs and source control.
- Rotate credentials only through an explicitly approved procedure.
- Preserve system certificate validation; never disable TLS verification.
- Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` as a workaround.

## 5. Kali controls

Kali is a controlled security workstation/lab, not a production runtime dependency. Permitted activities include authorized vulnerability assessment, penetration testing, defensive validation, forensics, and security regression testing.

- Written scope and target authorization before testing.
- Isolated lab targets by default.
- No unrestricted production database write access.
- No persistence, exploitation, or disruptive production testing without a separately approved plan.
- Findings include reproducible evidence, severity, affected component, and remediation guidance.

## 6. Raspberry Pi edge controls

- Enrol each device with a unique identity and owner.
- Use authenticated, encrypted communication to the RyanAI gateway.
- Do not expose management interfaces directly to the public Internet.
- Disable unused services and interfaces.
- Restrict GPIO, camera, microphone, and sensor access to approved workloads.
- Provide revocation and quarantine for lost or compromised devices.
- Buffer data safely during outages; never silently replay consequential commands.

## 7. Audit and observability

Record with appropriate privacy controls: principal/workload identity; requested capability and target; policy decision/version; human approval reference; execution start/end and outcome; correlation ID and evidence receipt; denials, timeouts, retries, and device enrollment/revocation. Never log secrets or unnecessary sensitive payloads. Logs alone do not prove success; use authoritative execution receipts.

## 8. Security acceptance gates

Demonstrate authentication and authorization tests for every exposed execution path; negative tests for missing identity, expired authority, wrong resource, and replay; zone-boundary/default-deny tests; secret and dependency/container scans; TLS verification; audit evidence for allow/deny/approval/execution; and recovery plus compromised-device isolation exercises.

Queued, skipped, missing, or provider-blocked checks are not passes.
