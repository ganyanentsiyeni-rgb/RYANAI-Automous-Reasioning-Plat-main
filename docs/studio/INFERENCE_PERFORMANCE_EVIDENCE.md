# Studio inference performance evidence profile

**Status:** Reviewable design increment; no provider activation or benchmark execution is authorized.
**Owner:** RyanAI Studio
**Policy:** RIIP model governance; Gen-X remains the independent authorization authority.

## Purpose

Give Studio a truthful, comparable view of inference performance for single-agent and concurrent agentic workloads. The profile translates the 6 November 2026 Artificial Analysis AA-AgentPerf DeepSeek V4.1 Flash results into measurements RyanAI can reproduce on its own approved hardware and serving stack.

This is an evidence and observability capability, not a claim that RyanAI has GB300 NVL72 or Vera Rubin capacity, that DeepSeek is configured, or that the reported throughput is available to RyanAI.

## Reference observation (external, not a RyanAI baseline)

The supplied Artificial Analysis AA-AgentPerf post reports the following DeepSeek V4.1 Flash measurements:

| Platform/configuration | Workload point | Reported result | Relative comparison |
| --- | --- | ---: | ---: |
| GB300 NVL72, updated vLLM/Dynamo stack | One agent | 848 tok/s | 1.42x versus prior 596 tok/s |
| GB300 NVL72, updated stack | Approximately 80 tok/s per agent | Approximately 1.6x throughput per GPU | Versus prior GB300 result |
| Vera Rubin NVL72, submitted configuration | One agent | 1,249 tok/s | 1.47x versus improved GB300 |
| Vera Rubin NVL72, submitted configuration | Approximately 260 tok/s per agent | 5.0x throughput per GPU | Versus improved GB300 |
| Vera Rubin NVL72, submitted configuration | Approximately 80 tok/s per agent | 1.7x throughput per GPU | Versus improved GB300 |

The post attributes the GB300 improvement to a newer vLLM version, DeepSeek-specific vLLM kernels, FlashInfer autotuning, broader CUDA Graph coverage, tuned speculative decoding, and NVIDIA Dynamo + vLLM scheduling with prefill and decode on the same GPUs.

These figures are workload- and platform-specific. They must not be copied into RyanAI's live performance dashboard as observed metrics, used as an SLO, or compared with a different model, hardware, tokenisation, concurrency pattern, or measurement method without qualification. The source excerpt supplied for this design is dated 6 November 2026; preserve its source attribution and retrieval date in any future evidence bundle.

## Studio experience

Add a read-only **Inference Performance** workspace section with four views:

1. **Runtime inventory** — provider/model identity, immutable model revision, serving runtime/version, accelerator model/count, memory, driver/CUDA versions, and configuration fingerprint. Display configured, reachable, authenticated, benchmarked, and production-enabled as separate states.
2. **Single-agent performance** — time to first token, inter-token latency, output tokens/second, end-to-end latency, cold-start/load time, success rate, and sample count.
3. **Agent concurrency** — concurrent agents, per-agent generation rate, aggregate completed tokens/second, completed tasks/minute, queue delay, saturation, failure/timeout rate, and per-GPU throughput when a trustworthy GPU denominator is available.
4. **Evidence comparison** — compare only runs with compatible model revision, workload/dataset version, tokenisation, output limits, warm-up policy, concurrency, runtime configuration, and hardware topology. Show incompatible dimensions and refuse to rank incomparable runs.

The UI must label external reference values as **external benchmark**, uploaded/reviewed run bundles as **evidence submitted**, and independently validated runs as **verified benchmark**. A missing measurement is unknown, never zero or a pass.

## Run evidence contract

Every run must have a versioned manifest containing:

- run ID, start/end timestamps, operator/approver reference, environment class, and evidence status;
- provider, model ID, immutable model revision or explicit inability to pin it, tokenizer identity, licence reference, and prompt/configuration hashes;
- serving runtime and exact version, backend/kernel versions, scheduler version, CUDA/driver/NCCL versions where applicable;
- accelerator SKU, accelerator count, memory capacity, topology, interconnect, and whether prefill/decode share GPUs or are disaggregated;
- workload suite/version/hash, task-family and language slices, prompt/output token distributions, context lengths, stop conditions, and held-out-set reference;
- warm-up count, repetitions, concurrency levels, request arrival pattern, agent count, max in-flight requests, and resource limits;
- TTFT, inter-token latency, end-to-end latency, p50/p95/p99 with sample counts, output tokens/second, aggregate throughput, queue delay, task completion rate, and error/timeout/abort counts;
- GPU utilisation, peak VRAM, CPU/RAM, energy and ZAR cost when actually measured; unavailable fields must carry an explicit reason;
- quality/safety scorecard, accepted-task denominator, provenance, raw-result hashes, evaluator version, and reviewer disposition.

Store evidence as immutable, append-only run bundles. Do not put secrets, raw credentials, production prompts, private user payloads, or held-out answers into the manifest or UI. Studio must enforce owner-scoped access and redact sensitive fields.

## Runtime optimisation experiments

Treat each optimisation as an independently switchable experimental variable, pinned to a compatible runtime/model/hardware combination:

- vLLM release and build provenance;
- model-specific kernels;
- FlashInfer version and autotuning result;
- CUDA Graph capture coverage and fallback rate;
- speculative decoding method, draft model/revision, acceptance rate, and overhead;
- NVIDIA Dynamo scheduling and prefill/decode placement;
- same-GPU versus disaggregated prefill/decode topology.

Run a baseline first, then change one variable at a time before testing combinations. Record all flags and effective settings, not just requested settings. A feature being supported by a runtime does not prove it was active during a run.

Do not add GB300-specific kernels, CUDA flags, speculative-decoding settings, Dynamo configuration, NVFP4 settings, or hardware assumptions to the generic RyanAI API/Render container. The serving operator owns accelerator-specific deployment and tuning. Studio consumes verified runtime descriptors and evidence; it does not provision GPUs or mutate serving infrastructure.

## Acceptance and promotion gates

The existing RIIP offline benchmark six-gate process remains authoritative. In addition:

1. Reproduce a baseline and candidate on the same pinned model, workload, hardware, runtime boundary, and measurement procedure.
2. Validate quality, safety, abstention, and task success before considering speed improvements. Critical-slice regressions block promotion.
3. Report both single-agent latency/throughput and concurrent-agent throughput; do not optimise one by hiding degradation in the other.
4. Include p50/p95, sample counts, confidence intervals where meaningful, failure rates, peak resources, and cost per accepted successful task in ZAR.
5. Demonstrate isolation, no unintended egress, no credential leakage, and independent Gen-X denial/approval behavior.
6. Pin the previous known-good serving configuration and prove rollback before any controlled pilot.
7. Require human review and exact-head CI/security evidence before changing model/runtime configuration. Production activation requires separate explicit authorization.

No benchmark may use production user data by default. Use synthetic or approved, de-identified held-out workloads in a disposable environment. A benchmark runner must not receive production database credentials, deployment credentials, GitHub write access, or permission to alter model policy.

## Delivery sequence

- **Phase A — evidence contract:** define and validate the run manifest and synthetic fixtures; no model invocation.
- **Phase B — read-only Studio view:** render external references and uploaded evidence with explicit provenance and comparability warnings; no execution controls.
- **Phase C — isolated benchmark runner:** only after separate approval of the existing offline harness design, isolation proof, dataset controls, and hardware availability.
- **Phase D — controlled serving experiment:** only after model licence, exact revision, cost ceiling, rollback, security, and human approval gates pass.

Until Phases A and B are implemented and verified, this document is a design contract only. No provider is promoted, no runtime is enabled, and no benchmark is claimed as executed.
