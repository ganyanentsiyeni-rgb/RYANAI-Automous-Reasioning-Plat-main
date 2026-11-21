#!/usr/bin/env python3
"""Offline tests for the governed production release orchestrator."""

from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

os.environ.setdefault("PAGERDUTY_TOKEN", "test-token")
os.environ.setdefault("PAGERDUTY_USER_EMAIL", "ci@example.invalid")
os.environ.setdefault("PAGERDUTY_SERVICE_IDS", "P123")
os.environ.setdefault("PAGERDUTY_ROUTING_KEY", "routing-key-test")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_production as deploy


class DeploymentHealthTests(unittest.TestCase):
    def test_health_check_passes_on_second_attempt(self) -> None:
        response_503 = Mock(status_code=503, headers={}, text="starting")
        response_200 = Mock(
            status_code=200,
            headers={"Content-Type": "application/json"},
            json=lambda: {"database": "ok"},
        )

        with patch.object(deploy.requests, "get", side_effect=[response_503, response_200]) as get, patch.object(
            deploy.time, "sleep"
        ) as sleep:
            self.assertTrue(
                deploy.verify_post_deployment_health(
                    "http://test/health",
                    max_attempts=3,
                    delay_sec=1,
                )
            )

        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_health_check_rejects_degraded_database(self) -> None:
        response = Mock(
            status_code=200,
            headers={"Content-Type": "application/json"},
            json=lambda: {"database": "down"},
        )
        with patch.object(deploy.requests, "get", return_value=response), patch.object(
            deploy.time, "sleep"
        ):
            with self.assertRaises(deploy.HealthCheckFailedError):
                deploy.verify_post_deployment_health(
                    "http://test/health",
                    max_attempts=2,
                    delay_sec=0,
                )

    def test_health_check_rejects_non_object_json_and_retries(self) -> None:
        response = Mock(
            status_code=200,
            headers={"Content-Type": "application/json"},
            json=lambda: ["not", "an", "object"],
        )
        with patch.object(deploy.requests, "get", return_value=response) as get, patch.object(
            deploy.time, "sleep"
        ):
            with self.assertRaises(deploy.HealthCheckFailedError):
                deploy.verify_post_deployment_health(
                    "http://test/health",
                    max_attempts=2,
                    delay_sec=0,
                )
        self.assertEqual(get.call_count, 2)

    def test_deployment_logs_redact_configured_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = io.StringIO()
            with patch.object(deploy, "LOG_FILE", Path(temp_dir) / "release.log"), patch.dict(
                os.environ,
                {
                    "PAGERDUTY_TOKEN": "unit-test-token",
                    "PAGERDUTY_ROUTING_KEY": "unit-test-routing-key",
                    "DATABASE_URL": "postgresql://user:password@db.invalid/test",
                    "SLACK_WEBHOOK_URL": "https://hooks.slack.invalid/unit-test",
                },
                clear=False,
            ), redirect_stdout(output):
                deploy.log_deployment_event(
                    "FAILURE",
                    "test",
                    "failure unit-test-token",
                    {"details": "unit-test-routing-key"},
                )
            logged = output.getvalue() + (Path(temp_dir) / "release.log").read_text()
            for secret in (
                "unit-test-token",
                "unit-test-routing-key",
                "postgresql://user:password@db.invalid/test",
                "https://hooks.slack.invalid/unit-test",
            ):
                self.assertNotIn(secret, logged)
            self.assertIn("[REDACTED]", logged)

    def test_health_check_exhaustion_raises_error(self) -> None:
        response = Mock(status_code=500, headers={}, text="unhealthy")
        with patch.object(deploy.requests, "get", return_value=response) as get, patch.object(
            deploy.time, "sleep"
        ):
            with self.assertRaises(deploy.HealthCheckFailedError):
                deploy.verify_post_deployment_health(
                    "http://test/health",
                    max_attempts=3,
                    delay_sec=0,
                    require_database_health=False,
                )
        self.assertEqual(get.call_count, 3)

    def test_production_migration_uses_allowlisted_wrapper(self) -> None:
        with patch.object(deploy, "DEPLOYMENT_ENVIRONMENT", "production"), patch.object(
            deploy, "run_command"
        ) as run:
            deploy.run_database_migration()
        run.assert_called_once_with(["npm", "run", "db:migrate"], "db_migration")

    def test_staging_migration_uses_staging_database_command(self) -> None:
        with patch.object(deploy, "DEPLOYMENT_ENVIRONMENT", "staging"), patch.object(
            deploy, "run_command"
        ) as run:
            deploy.run_database_migration()
        run.assert_called_once_with(
            ["npx", "prisma", "migrate", "deploy"],
            "staging_db_migration",
        )

    def test_rollout_command_is_required(self) -> None:
        with patch.dict(os.environ, {"PRODUCTION_ROLLOUT_COMMAND": ""}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "PRODUCTION_ROLLOUT_COMMAND"):
                deploy.run_rollout()

    def test_release_requires_explicit_approval_flag(self) -> None:
        with patch.dict(os.environ, {"RYANAI_PRODUCTION_RELEASE_APPROVED": "false"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "Production release is locked"):
                deploy.main()


if __name__ == "__main__":
    unittest.main()
