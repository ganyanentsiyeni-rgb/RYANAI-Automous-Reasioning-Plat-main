#!/usr/bin/env python3
"""Unit tests for the fail-closed Prisma breaking-change detector."""
import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("check_breaking_schema.py")
SPEC = importlib.util.spec_from_file_location("check_breaking_schema", MODULE_PATH)
assert SPEC and SPEC.loader
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class BreakingSchemaGuardTests(unittest.TestCase):
    def test_normalizes_only_identical_duplicate_baseline_models(self):
        baseline = (
            "model A {\n  id String @id\n}\n"
            "model A {\n  id String @id\n}\n"
            "model B {\n  id String @id\n}\n"
        )
        normalized = guard.normalize_base_schema(
            baseline,
            '"outbound_comms_dispatches_communication_message_id_fkey" '
            'REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE '
            '"comms_delivery_receipts_dispatch_id_fkey" '
            'REFERENCES "public"."outbound_comms_dispatches"("id") '
            '"comms_delivery_receipts_communication_message_id_fkey"',
        )
        self.assertEqual(normalized.count("model A"), 1)
        self.assertEqual(normalized.count("model B"), 1)

    def test_rejects_conflicting_duplicate_baseline_models(self):
        baseline = (
            "model A {\n  id String @id\n}\n"
            "model A {\n  id String @id\n  name String\n}\n"
        )
        with self.assertRaises(RuntimeError):
            guard.normalize_base_schema(
                baseline,
                '"outbound_comms_dispatches_communication_message_id_fkey" '
                'REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE '
                '"comms_delivery_receipts_dispatch_id_fkey" '
                'REFERENCES "public"."outbound_comms_dispatches"("id") '
                '"comms_delivery_receipts_communication_message_id_fkey"',
            )

    def test_detects_drop_table_and_column(self):
        sql = "DROP TABLE public.legacy;\nALTER TABLE users DROP COLUMN old_name;"
        findings = guard.find_breaking_statements(sql)
        self.assertEqual(len(findings), 2)

    def test_detects_type_change_not_null_and_truncate(self):
        sql = (
            "ALTER TABLE users ALTER COLUMN age TYPE bigint;\n"
            "ALTER TABLE users ALTER COLUMN email SET NOT NULL;\n"
            "TRUNCATE TABLE users;"
        )
        self.assertEqual(len(guard.find_breaking_statements(sql)), 3)

    def test_ignores_non_destructive_statements(self):
        sql = (
            "CREATE TABLE public.new_table (id uuid primary key);\n"
            "ALTER TABLE users ADD COLUMN display_name text;\n"
            "CREATE INDEX users_email_idx ON users(email);"
        )
        self.assertEqual(guard.find_breaking_statements(sql), [])

    def test_does_not_treat_set_default_as_destructive(self):
        self.assertEqual(
            guard.find_breaking_statements("ALTER TABLE users ALTER COLUMN active SET DEFAULT true;"),
            [],
        )


if __name__ == "__main__":
    unittest.main()
