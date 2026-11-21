#!/usr/bin/env python3
"""Governed production release orchestrator.

This module is intentionally inert unless the workflow supplies an explicit
release approval flag. It performs the ephemeral database pre-flight before
any live migration, keeps PagerDuty maintenance active through rollout and
health verification, and triggers/resolves one PagerDuty incident key.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from pagerduty_manager import (
    pagerduty_maintenance_block,
    resolve_incident,
    trigger_incident,
)

DEPLOYMENT_ENVIRONMENT = os.getenv("RYANAI_DEPLOYMENT_ENVIRONMENT", "production").strip().lower()
if DEPLOYMENT_ENVIRONMENT not in {"production", "staging"}:
    raise RuntimeError("RYANAI_DEPLOYMENT_ENVIRONMENT must be production or staging")
DEPLOYMENT_DEDUP_KEY = os.getenv(
    "PAGERDUTY_DEDUP_KEY",
    f"ryanai-{DEPLOYMENT_ENVIRONMENT}-deployment-{os.getenv('GITHUB_RUN_ID', 'manual')}",
)
LOG_FILE = Path(os.getenv("DEPLOYMENT_LOG_FILE", "deployment-logs/release.log"))
SENSITIVE_ENV_KEYS = (
    "PAGERDUTY_TOKEN",
    "PAGERDUTY_ROUTING_KEY",
    "DATABASE_URL",
    "SLACK_WEBHOOK_URL",
)


class HealthCheckFailedError(RuntimeError):
    """Raised when post-deployment health probes never reach the required state."""


def _redact(value):
    if isinstance(value, str):
        for key in SENSITIVE_ENV_KEYS:
            secret = os.getenv(key)
            if secret:
                value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, dict):
        return {key: _redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def log_deployment_event(status: str, phase: str, message: str, extra: dict | None = None) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "service": f"ryanai-{DEPLOYMENT_ENVIRONMENT}",
        "event_type": "deployment",
        "status": status,
        "phase": phase,
        "message": message,
        "commit": os.getenv("GITHUB_SHA", "local"),
        "actor": os.getenv("GITHUB_ACTOR", "manual"),
    }
    if extra:
        entry.update(extra)
    entry = _redact(entry)

    line = json.dumps(entry, sort_keys=True)
    print(line, flush=True)

    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError as exc:
        print(
            json.dumps(
                {
                    "event_type": "deployment",
                    "status": "WARNING",
                    "phase": "logging",
                    "message": f"Could not write deployment log file: {exc}",
                }
            ),
            file=sys.stderr,
        )


def run_command(command: list[str], phase: str) -> None:
    # Do not log arbitrary command arguments; protected environment variables
    # may contain provider-specific values or credentials.
    executable = Path(command[0]).name if command else "[empty]"
    log_deployment_event(
        "IN_PROGRESS", phase, "Executing configured command.",
        {"executable": executable, "argument_count": max(0, len(command) - 1)},
    )
    subprocess.run(command, check=True)


def run_database_migration() -> None:
    """Use the production allowlist wrapper for production; isolate staging."""
    if DEPLOYMENT_ENVIRONMENT == "production":
        run_command(["npm", "run", "db:migrate"], "db_migration")
    else:
        run_command(["npx", "prisma", "migrate", "deploy"], "staging_db_migration")


def run_rollout() -> None:
    """Run the provider-specific rollout command supplied by protected env config."""
    raw = os.getenv("PRODUCTION_ROLLOUT_COMMAND", "").strip()
    if not raw:
        raise RuntimeError(
            "PRODUCTION_ROLLOUT_COMMAND is not configured; refusing to guess a production "
            "provider rollout command."
        )
    command = shlex.split(raw)
    if not command:
        raise RuntimeError("PRODUCTION_ROLLOUT_COMMAND is empty after parsing")
    run_command(command, "service_rollout")


def verify_post_deployment_health(
    target_url: str,
    *,
    expected_status: int = 200,
    timeout_sec: float = 5.0,
    max_attempts: int = 6,
    delay_sec: float = 10.0,
    require_database_health: bool = True,
) -> bool:
    """Poll the service health endpoint until HTTP and dependency health are valid."""
    if not target_url:
        raise ValueError("target_url is required")
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least one")

    for attempt in range(1, max_attempts + 1):
        try:
            started = time.monotonic()
            response = requests.get(target_url, timeout=timeout_sec)
            latency_ms = (time.monotonic() - started) * 1000

            if response.status_code == expected_status:
                if require_database_health:
                    content_type = response.headers.get("Content-Type", "")
                    if "application/json" not in content_type:
                        raise HealthCheckFailedError(
                            "Health endpoint returned HTTP 200 without an application/json body"
                        )
                    payload = response.json()
                    if not isinstance(payload, dict):
                        raise HealthCheckFailedError("Health endpoint JSON body must be an object")
                    if payload.get("database") != "ok":
                        raise HealthCheckFailedError(
                            f"Health endpoint database status is {payload.get('database')!r}"
                        )

                log_deployment_event(
                    "SUCCESS",
                    "health_check",
                    "Post-deployment health probe passed.",
                    {"attempt": attempt, "latency_ms": round(latency_ms, 1)},
                )
                return True

            log_deployment_event(
                "IN_PROGRESS",
                "health_check",
                f"Received HTTP {response.status_code}; expected {expected_status}.",
                {"attempt": attempt, "latency_ms": round(latency_ms, 1)},
            )
        except (requests.RequestException, ValueError, HealthCheckFailedError) as exc:
            log_deployment_event(
                "IN_PROGRESS",
                "health_check",
                f"Health probe attempt {attempt}/{max_attempts} failed: {exc}",
            )

        if attempt < max_attempts:
            time.sleep(delay_sec)

    raise HealthCheckFailedError(
        f"Post-deployment health check failed after {max_attempts} attempts against {target_url}"
    )


def main() -> None:
    if os.getenv("RYANAI_PRODUCTION_RELEASE_APPROVED") != "true":
        raise RuntimeError(
            "Production release is locked. Set RYANAI_PRODUCTION_RELEASE_APPROVED=true "
            "only from the manually approved production workflow."
        )

    if not os.getenv("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is not set for production deployment.")

    health_url = os.getenv("PRODUCTION_HEALTH_URL", "").strip()
    if not health_url:
        raise RuntimeError("PRODUCTION_HEALTH_URL is required.")

    start = time.monotonic()
    log_deployment_event("START", "orchestrator", "Starting governed production release.")

    try:
        with pagerduty_maintenance_block(
            duration_minutes=45,
            description=f"RyanAI {DEPLOYMENT_ENVIRONMENT} release and migration",
        ):
            run_command(
                ["bash", "scripts/run-ephemeral-postgres-integration.sh"],
                "db_dry_run",
            )
            run_command(["npx", "prisma", "generate"], "prisma_generate")
            run_database_migration()
            run_rollout()
            verify_post_deployment_health(
                health_url,
                expected_status=200,
                max_attempts=6,
                delay_sec=10,
                require_database_health=True,
            )

        duration = time.monotonic() - start
        log_deployment_event(
            "SUCCESS",
            "orchestrator",
            f"{DEPLOYMENT_ENVIRONMENT.capitalize()} release completed and health was certified.",
            {"duration_seconds": round(duration, 2)},
        )
        resolve_incident(
            DEPLOYMENT_DEDUP_KEY,
            summary=f"RyanAI {DEPLOYMENT_ENVIRONMENT} deployment completed successfully and health checks passed.",
        )
    except Exception as exc:
        duration = time.monotonic() - start
        log_deployment_event(
            "FAILURE",
            "orchestrator",
            f"{DEPLOYMENT_ENVIRONMENT.capitalize()} release failed: {exc}",
            {"duration_seconds": round(duration, 2), "error": str(exc)},
        )
        try:
            trigger_incident(DEPLOYMENT_DEDUP_KEY, str(exc))
        except Exception as incident_error:
            log_deployment_event(
                "WARNING",
                "pagerduty",
                f"Deployment failed and PagerDuty incident trigger also failed: {incident_error}",
            )
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Production release aborted: {exc}", file=sys.stderr)
        sys.exit(1)
