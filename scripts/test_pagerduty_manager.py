#!/usr/bin/env python3
"""Offline contract tests for pagerduty_manager.py."""
from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pagerduty_manager as manager


class PagerDutyManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env = patch.dict(
            os.environ,
            {
                "PAGERDUTY_TOKEN": "test-token",
                "PAGERDUTY_USER_EMAIL": "ci@example.invalid",
                "PAGERDUTY_SERVICE_IDS": "P123,P456",
                "PAGERDUTY_ROUTING_KEY": "routing-key-test",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_module_imports_without_pagerduty_environment(self) -> None:
        env = os.environ.copy()
        for key in (
            "PAGERDUTY_TOKEN",
            "PAGERDUTY_USER_EMAIL",
            "PAGERDUTY_SERVICE_IDS",
            "PAGERDUTY_ROUTING_KEY",
        ):
            env.pop(key, None)
        result = subprocess.run(
            [sys.executable, "-c", "import pagerduty_manager; print('import-ok')"],
            cwd=Path(__file__).resolve().parent,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("import-ok", result.stdout)

    def test_missing_credentials_fail_only_when_live_operation_requested(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "PAGERDUTY_TOKEN"):
                manager.create_multi_service_maintenance_window(service_ids=["P123"])

    def test_create_window_sends_all_services_and_10s_timeout(self) -> None:
        response = Mock(status_code=201, text="", json=lambda: {"maintenance_window": {"id": "MW_ABC"}})
        with patch.object(manager.requests, "request", return_value=response) as request:
            window_id = manager.create_multi_service_maintenance_window(duration_minutes=10)
        self.assertEqual(window_id, "MW_ABC")
        self.assertEqual(
            request.call_args.kwargs["json"]["maintenance_window"]["services"],
            [
                {"id": "P123", "type": "service_reference"},
                {"id": "P456", "type": "service_reference"},
            ],
        )
        self.assertEqual(request.call_args.kwargs["timeout"], 10)

    def test_403_fails_fast_without_retry(self) -> None:
        response = Mock(status_code=403, text="Access Denied: Invalid scope")
        with patch.object(manager.requests, "request", return_value=response) as request, patch.object(
            manager.time, "sleep"
        ) as sleep:
            with self.assertRaisesRegex(RuntimeError, "403.*Access Denied"):
                manager.create_multi_service_maintenance_window()
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    def test_post_timeout_retries_then_reraises_after_exhaustion(self) -> None:
        error = manager.requests.exceptions.Timeout("request timeout")
        with patch.object(manager.requests, "request", side_effect=error) as request, patch.object(
            manager.time, "sleep"
        ) as sleep:
            with self.assertRaises(manager.requests.exceptions.Timeout):
                manager.create_multi_service_maintenance_window()
        self.assertEqual(request.call_count, manager.DEFAULT_RETRIES)
        self.assertEqual(sleep.call_count, manager.DEFAULT_RETRIES - 1)

    def test_transient_503_retries_and_succeeds(self) -> None:
        responses = [
            Mock(status_code=503, text="busy"),
            Mock(status_code=201, text="", json=lambda: {"maintenance_window": {"id": "MW_RETRY"}}),
        ]
        with patch.object(manager.requests, "request", side_effect=responses) as request, patch.object(
            manager.time, "sleep"
        ) as sleep:
            result = manager.create_multi_service_maintenance_window()
        self.assertEqual(result, "MW_RETRY")
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once()

    def test_transient_5xx_exhaustion_raises(self) -> None:
        response = Mock(status_code=504, text="Gateway Timeout")
        with patch.object(manager.requests, "request", return_value=response) as request, patch.object(
            manager.time, "sleep"
        ) as sleep:
            with self.assertRaisesRegex(RuntimeError, "504.*Gateway Timeout"):
                manager.create_multi_service_maintenance_window()
        self.assertEqual(request.call_count, manager.DEFAULT_RETRIES)
        self.assertEqual(sleep.call_count, manager.DEFAULT_RETRIES - 1)

    def test_context_manager_preserves_deployment_exception_on_cleanup_failure(self) -> None:
        created = Mock(status_code=201, text="", json=lambda: {"maintenance_window": {"id": "MW_1"}})
        delete_error = manager.requests.exceptions.Timeout("delete timeout")
        with patch.object(manager.requests, "request", side_effect=[created, delete_error]), patch.object(
            manager.time, "sleep"
        ):
            with self.assertRaisesRegex(ValueError, "deployment failed"):
                with manager.pagerduty_maintenance_block():
                    raise ValueError("deployment failed")

    def test_cleanup_failure_after_success_is_visible(self) -> None:
        created = Mock(status_code=201, text="", json=lambda: {"maintenance_window": {"id": "MW_1"}})
        delete_error = manager.requests.exceptions.Timeout("delete timeout")
        with patch.object(manager.requests, "request", side_effect=[created, delete_error]), patch.object(
            manager.time, "sleep"
        ):
            with self.assertRaises(manager.requests.exceptions.Timeout):
                with manager.pagerduty_maintenance_block():
                    pass

    def test_context_manager_closes_window_on_success(self) -> None:
        created = Mock(status_code=201, text="", json=lambda: {"maintenance_window": {"id": "MW_1"}})
        deleted = Mock(status_code=204, text="")
        with patch.object(manager.requests, "request", side_effect=[created, deleted]) as request:
            with manager.pagerduty_maintenance_block():
                pass
        self.assertEqual(request.call_count, 2)

    def test_trigger_and_resolve_use_same_dedup_key(self) -> None:
        response = Mock(status_code=202, text="")
        with patch.object(manager.requests, "request", return_value=response) as request:
            manager.trigger_incident("deploy-123", "migration failed")
            manager.resolve_incident("deploy-123")
        self.assertEqual(request.call_args_list[0].kwargs["json"]["event_action"], "trigger")
        self.assertEqual(request.call_args_list[1].kwargs["json"]["event_action"], "resolve")
        self.assertEqual(request.call_args_list[0].kwargs["json"]["dedup_key"], "deploy-123")
        self.assertEqual(request.call_args_list[1].kwargs["json"]["dedup_key"], "deploy-123")


if __name__ == "__main__":
    unittest.main()
