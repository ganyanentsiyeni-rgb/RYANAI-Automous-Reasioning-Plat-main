# RyanAI Aerial AI-RAN development bridge

This is a development contract simulator, not NVIDIA Aerial software.

It exists so the RyanAI API can raise and exercise the Aerial integration boundary on
a normal development machine or CI runner without a GPU, NIC, real-time kernel, or
NVIDIA Aerial runtime.

The real NVIDIA Aerial Framework is a Python/C++ GPU runtime. RyanAI should point
AERIAL_BASE_URL and AERIAL_INFERENCE_URL at an approved Aerial-side service when
hardware/runtime validation is available.

## Start

    python3 aerial-bridge/server.py

Default endpoints:

- GET http://127.0.0.1:8791/health
- POST http://127.0.0.1:8791/v1/inference

Example environment:

    AERIAL_ENABLED=true
    AERIAL_BASE_URL=http://127.0.0.1:8791
    AERIAL_HEALTH_PATH=/health
    AERIAL_INFERENCE_URL=http://127.0.0.1:8791/v1/inference
    AERIAL_MODEL=aerial-dev

## Hardware validation boundary

NVIDIA documents Aerial Framework as the toolchain/runtime for GPU-accelerated
5G/6G pipelines. Its runtime validation requires a GPU, NIC and real-time kernel,
with MAC/RU emulation for PHY integration tests. The bridge does not satisfy those
hardware gates; it only validates RyanAI's application-side contract.
