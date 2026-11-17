# RyanAI Hybrid OS v1

## Status

**Architecture:** Approved  
**Version:** v1.0  
**Implementation state:** Documentation and architecture phase  
**Production deployment:** Not authorized

RyanAI Hybrid OS is a security-first operating environment assembled from specialized operating-system layers. It is not a Linux distribution fork. The operating systems remain separate; RyanAI supplies the common identity, policy, observability, and recovery model.

## 1. Architecture

- **Ubuntu LTS — Core:** primary trusted environment for RyanAI APIs, services, containers, AI/model and agent workloads, memory, internal APIs, and observability.
- **Kali Linux — Security:** isolated security workstation/lab for authorized assessment, defensive validation, forensics, and security regression testing. It is not a production dependency.
- **Raspberry Pi OS 64-bit — Edge:** controlled physical environment for voice/audio, sensors, GPIO, cameras, local status interfaces, automation, and constrained inference.
- **Security Fabric:** common identity, authentication, authorization, encrypted transport, policy enforcement, audit, and telemetry.
- **Recovery Layer:** independently controlled integrity verification, backup/restore, compromised-node isolation, and rebuild.

## 2. Trust zones

| Zone | Responsibility |
|---|---|
| CORE | Ubuntu RyanAI services and workloads |
| SECURITY | Isolated Kali assessment environment |
| EDGE | Enrolled Raspberry Pi devices and peripherals |
| MANAGEMENT | Operator and administrative access |
| RECOVERY | Integrity, backup, restore, and rebuild |

Default posture is deny unless explicitly required. Every inter-zone path must define source, destination, protocol, purpose, identity, and authorization. A documented zone is not enforcement; network controls and negative tests must demonstrate the boundary.

## 3. Ubuntu Core

Ubuntu LTS is the stable, minimal host for RyanAI services, containers, model and agent runtimes, memory, vector workloads, internal APIs, and monitoring. Application lifecycle and host lifecycle remain separate. Kali repositories and packages must not be mixed into the Ubuntu host.

## 4. Kali Security Zone

Kali is used only for authorized vulnerability assessment, penetration testing, network/security validation, defensive testing, forensics, and attack-surface assessment. Testing requires a written scope and authorized targets. Use isolated lab targets by default. No unrestricted production credentials or standing production database write access are permitted. Production testing requires separate explicit authorization and an auditable plan.

## 5. Raspberry Pi Edge

Raspberry Pi OS supports physical and constrained workloads. Each node must have a distinct device identity, named owner, approved capabilities, minimal services, restricted inbound management, and authenticated encrypted communication to the RyanAI gateway. Avoid direct public Internet exposure and direct database access. Offline buffering must be bounded and must not replay consequential commands without fresh authorization.

## 6. Security Fabric and AI authority

The Security Fabric supplies machine/workload/device identity, authentication, Gen-X policy authorization, encrypted transport, audit events, and service-to-service access control. Network location alone never confers trust.

Consequential execution follows:

`Agent request → capability boundary → Gen-X policy → human approval where required → exact-action execution → audit/evidence receipt`

No model, agent, plugin, or device can grant itself authority or broaden its capabilities.

## 7. Containerization and recovery

Run application workloads in controlled containers where appropriate. Keep host and application lifecycles distinct. Recovery must not depend entirely on the normal RyanAI runtime; protect known-good source/artifacts, backup metadata, recovery instructions, and integrity evidence under separate access control.

## 8. Security invariants

1. No automatic production deployment or merge.
2. No production database mutation without explicit approval.
3. No secrets committed to source control.
4. No unrestricted production credentials in Kali or edge devices.
5. No unnecessary public exposure of Raspberry Pi nodes.
6. Least privilege and default-deny network policy.
7. Queued, skipped, missing, or unverifiable checks are not passes.
8. Consequential actions require an authorization boundary and evidence.
9. Recovery remains independently usable.
10. Changes include rollback and recovery considerations.

## 9. Implementation phases

- **Phase 0 — Documentation:** architecture, README, trust boundaries, hardware targets, recovery requirements.
- **Phase 1 — Ubuntu Core:** hardened host, container runtime, firewall, identity, audit, monitoring, backup/recovery.
- **Phase 2 — Kali Security:** isolated lab, approved tooling, regression harness, evidence collection, CI integration.
- **Phase 3 — Raspberry Pi Edge:** hardened image, device identity, authenticated enrollment, encrypted communication, remote management, recovery.
- **Phase 4 — RyanAI integration:** AI runtime, memory, agents, voice, hardware events, edge inference, observability.
- **Phase 5 — Validation:** test every intended trust path and every privileged capability.

Architecture approval does not authorize deployment, procurement, production migrations, secret changes, or infrastructure mutation. Each implementation phase requires a reviewed PR, required checks, human review, rollback plan, and separate approvals where applicable.
