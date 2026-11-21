#!/usr/bin/env python3
"""PagerDuty maintenance-window and deployment-incident helpers.

Importing this module is side-effect free. Credentials are validated only
when a live PagerDuty operation is requested.
"""
from __future__ import annotations

import os
import random
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, Sequence

import requests

API_URL = "https://api.pagerduty.com"
EVENTS_API_URL = "https://events.pagerduty.com/v2/enqueue"
DEFAULT_TIMEOUT_SECONDS = 10
DEFAULT_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 1.5
TRANSIENT_STATUS_CODES = frozenset({500, 502, 503, 504})


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for this PagerDuty operation")
    return value


def _api_headers() -> dict[str, str]:
    return {
        "Accept": "application/vnd.pagerduty+json;version=2",
        "Authorization": f"Token token={_required_env('PAGERDUTY_TOKEN')}",
        "Content-Type": "application/json",
        "From": _required_env("PAGERDUTY_USER_EMAIL"),
    }


def _configured_service_ids() -> tuple[str, ...]:
    return tuple(
        item.strip()
        for item in os.getenv("PAGERDUTY_SERVICE_IDS", "").split(",")
        if item.strip()
    )


def _utc_iso8601(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _service_references(service_ids: Sequence[str]) -> list[dict[str, str]]:
    return [{"id": service_id, "type": "service_reference"} for service_id in service_ids]


def _request_with_retry(
    method: str,
    url: str,
    *,
    session: requests.Session | None = None,
    retries: int = DEFAULT_RETRIES,
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    **kwargs: object,
) -> requests.Response:
    """Retry only transient HTTP/network failures with exponential backoff + jitter."""
    if retries < 1:
        raise ValueError("retries must be at least one")
    if timeout <= 0:
        raise ValueError("timeout must be greater than zero")

    client = session or requests
    delay = backoff_seconds
    for attempt in range(1, retries + 1):
        try:
            response = client.request(method, url, timeout=timeout, **kwargs)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
            if attempt == retries:
                raise
        else:
            if response.status_code not in TRANSIENT_STATUS_CODES:
                return response
            if attempt == retries:
                return response

        time.sleep(delay + random.uniform(0, 0.5))
        delay *= 2

    raise AssertionError("unreachable retry loop")


def create_multi_service_maintenance_window(
    duration_minutes: int = 30,
    description: str = "Automated Deployment",
    *,
    service_ids: Sequence[str] | None = None,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> str:
    """Create an active maintenance window and return its PagerDuty ID."""
    selected_services = tuple(service_ids) if service_ids is not None else _configured_service_ids()
    if duration_minutes <= 0:
        raise ValueError("duration_minutes must be greater than zero")
    if not selected_services:
        raise RuntimeError("PAGERDUTY_SERVICE_IDS must contain at least one service ID")

    start_time = datetime.now(timezone.utc)
    payload = {
        "maintenance_window": {
            "type": "maintenance_window",
            "start_time": _utc_iso8601(start_time),
            "end_time": _utc_iso8601(start_time + timedelta(minutes=duration_minutes)),
            "description": description,
            "services": _service_references(selected_services),
        }
    }
    response = _request_with_retry(
        "POST",
        f"{API_URL}/maintenance_windows",
        session=session,
        headers=_api_headers(),
        json=payload,
        timeout=timeout,
    )
    if response.status_code != 201:
        raise RuntimeError(
            f"Failed to create PagerDuty maintenance window: {response.status_code} - {response.text}"
        )
    try:
        window_id = response.json()["maintenance_window"]["id"]
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("PagerDuty create response did not contain a window ID") from exc
    print(f"PagerDuty maintenance window activated: {window_id}")
    return str(window_id)


def end_maintenance_window(
    window_id: str,
    *,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Terminate an active maintenance window."""
    if not window_id:
        raise ValueError("window_id is required")
    response = _request_with_retry(
        "DELETE",
        f"{API_URL}/maintenance_windows/{window_id}",
        session=session,
        headers=_api_headers(),
        timeout=timeout,
    )
    if response.status_code == 204:
        print(f"PagerDuty maintenance window terminated: {window_id}")
        return
    raise RuntimeError(
        f"Failed to close PagerDuty maintenance window: {response.status_code} - {response.text}"
    )


@contextmanager
def pagerduty_maintenance_block(
    duration_minutes: int = 30,
    description: str = "Automated Deployment",
    *,
    service_ids: Sequence[str] | None = None,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> Iterator[str]:
    """Wrap a deployment while preserving its exception if cleanup also fails."""
    window_id = create_multi_service_maintenance_window(
        duration_minutes,
        description,
        service_ids=service_ids,
        session=session,
        timeout=timeout,
    )
    deployment_failed = False
    try:
        yield window_id
    except BaseException:
        deployment_failed = True
        raise
    finally:
        try:
            end_maintenance_window(window_id, session=session, timeout=timeout)
        except Exception as cleanup_error:
            if deployment_failed:
                print(
                    f"Warning: PagerDuty maintenance cleanup failed for {window_id}: {cleanup_error}",
                    file=sys.stderr,
                )
            else:
                raise


def _event_request(
    event_action: str,
    dedup_key: str,
    summary: str,
    severity: str,
    *,
    routing_key: str | None = None,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    selected_key = routing_key or _required_env("PAGERDUTY_ROUTING_KEY")
    if not dedup_key.strip():
        raise ValueError("dedup_key is required")
    payload = {
        "routing_key": selected_key,
        "event_action": event_action,
        "dedup_key": dedup_key,
        "payload": {
            "summary": summary,
            "source": "ryanai-ci-cd-pipeline",
            "severity": severity,
        },
    }
    response = _request_with_retry(
        "POST",
        EVENTS_API_URL,
        session=session,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=timeout,
    )
    if response.status_code not in (200, 202):
        raise RuntimeError(
            f"PagerDuty Events API {event_action} failed: {response.status_code} - {response.text}"
        )


def trigger_incident(
    dedup_key: str,
    error_message: str,
    *,
    routing_key: str | None = None,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Open/update a critical deployment incident."""
    _event_request(
        "trigger",
        dedup_key,
        f"RyanAI production deployment failed: {error_message}",
        "critical",
        routing_key=routing_key,
        session=session,
        timeout=timeout,
    )


def resolve_incident(
    dedup_key: str,
    summary: str = "RyanAI production deployment completed successfully.",
    *,
    routing_key: str | None = None,
    session: requests.Session | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    """Resolve the deployment incident using the same deduplication key."""
    _event_request(
        "resolve",
        dedup_key,
        summary,
        "info",
        routing_key=routing_key,
        session=session,
        timeout=timeout,
    )


if __name__ == "__main__":
    print("PagerDuty manager is import-only; no live API operation was requested.")
