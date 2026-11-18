#!/usr/bin/env python3
"""RyanAI development contract bridge for NVIDIA Aerial AI-RAN.

This bridge intentionally contains no NVIDIA SDK. It provides the stable HTTP
contract used by RyanAI development and CI so the application can be raised
without pretending that a GPU/NIC/RAN runtime is present.
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import time


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/health", "/healthz"):
            self._send(200, {
                "status": "healthy",
                "service": "ryanai-aerial-dev-bridge",
                "runtime": "development-simulator",
            })
            return
        self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/v1/inference":
            self._send(404, {"error": "not_found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            self._send(400, {"error": "prompt_required"})
            return

        started = time.perf_counter()
        self._send(200, {
            "response": "Aerial development bridge received: " + prompt[:240],
            "model": body.get("model") or "aerial-dev",
            "runtime": "development-simulator",
            "latency_ms": round((time.perf_counter() - started) * 1000, 3),
        })

    def log_message(self, fmt: str, *args) -> None:
        print("[aerial-bridge] " + (fmt % args), flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("AERIAL_BRIDGE_PORT", "8791"))
    print("Aerial development bridge listening on 127.0.0.1:" + str(port), flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
