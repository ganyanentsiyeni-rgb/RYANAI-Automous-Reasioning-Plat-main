# NVIDIA Aerial AI-RAN integration

## What is implemented

RyanAI now has an explicit Aerial integration boundary:

- src/server/aerial/client.ts — health and inference client.
- src/server/aerial/routes.ts — authenticated API surface.
- aerial-bridge/server.py — dependency-free development contract simulator.
- scripts/aerial-ai-ran-smoke.mjs — development health + inference smoke test.

The API exposes:

- GET /api/aerial/health
- GET /api/aerial/status
- POST /api/aerial/inference

Inference is governed by the existing Gen-X policy. No telecom control-plane mutation,
RAN configuration change, radio action, or production deployment is performed by this
integration.

## Development

The fastest validation path is:

    npm run aerial:smoke

For API-level development, run the bridge separately:

    python3 aerial-bridge/server.py

Then configure:

    AERIAL_ENABLED=true
    AERIAL_BASE_URL=http://127.0.0.1:8791
    AERIAL_HEALTH_PATH=/health
    AERIAL_INFERENCE_URL=http://127.0.0.1:8791/v1/inference
    AERIAL_MODEL=aerial-dev

Start RyanAI normally with npm run dev:api.

## NVIDIA runtime boundary

NVIDIA's current Aerial Framework documentation describes a Python/C++ development
toolchain and a GPU/NIC runtime for real-time RAN pipelines. RyanAI does not vendor or
pretend to implement NVIDIA's hardware runtime. The external runtime is attached
through the application bridge boundary so development can be verified without
fabricating hardware readiness.

For actual Aerial validation, the bridge must be replaced by the approved Aerial-side
service and the result must include GPU/NIC/runtime evidence. A healthy RyanAI bridge
is not evidence that NVIDIA Aerial hardware is operational.
