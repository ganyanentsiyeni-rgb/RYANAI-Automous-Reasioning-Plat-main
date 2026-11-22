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
        dispatch = (
            "model OutboundCommsDispatch {\n"
            "  communicationMessage   CommunicationMessage     @relation(fields: [communicationMessageId], references: [id], onDelete: Cascade)\n"
            "}\n"
        )
        receipt = (
            "model CommsDeliveryReceipt {\n"
            "  dispatch               OutboundCommsDispatch @relation(fields: [dispatchId], references: [id], onDelete: Cascade)\n"
            "  communicationMessageId String                @map(\"communication_message_id\")\n"
            "  providerMessageId String\n"
            "}\n"
        )
        baseline = (
            "model CommunicationMessage {\n  outboundDispatch  OutboundCommsDispatch?\n}\n"
            + dispatch + receipt + dispatch + receipt
        )
        migration_sql = (
            '"outbound_comms_dispatches_communication_message_id_fkey" '
            'REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE '
            '"comms_delivery_receipts_dispatch_id_fkey" '
            'REFERENCES "public"."outbound_comms_dispatches"("id") '
            '"comms_delivery_receipts_communication_message_id_fkey"'
        )
        normalized = guard.normalize_base_schema(baseline, migration_sql)
        self.assertEqual(normalized.count("model OutboundCommsDispatch"), 1)
        self.assertEqual(normalized.count("model CommsDeliveryReceipt"), 1)
        self.assertIn("deliveryReceipts  CommsDeliveryReceipt[]", normalized)
        self.assertIn("onDelete: Restrict", normalized)
        self.assertIn("comms_delivery_receipts_communication_message_id_fkey", normalized)

    def test_accepts_already_normalized_comms_baseline_idempotently(self):
        baseline = (
            "model CommunicationMessage {\n"
            "  outboundDispatch  OutboundCommsDispatch?\n"
            "  deliveryReceipts  CommsDeliveryReceipt[]\n"
            "}\n"
            "model OutboundCommsDispatch {\n"
            '  communicationMessage   CommunicationMessage     @relation(fields: [communicationMessageId], references: [id], onDelete: Restrict, onUpdate: Cascade, map: "outbound_comms_dispatches_communication_message_id_fkey")\n'
            "}\n"
            "model CommsDeliveryReceipt {\n"
            '  dispatch               OutboundCommsDispatch @relation(fields: [dispatchId], references: [id], onDelete: Restrict, onUpdate: Cascade, map: "comms_delivery_receipts_dispatch_id_fkey")\n'
            '  communicationMessageId String                @map("communication_message_id")\n'
            '  communicationMessage   CommunicationMessage @relation(fields: [communicationMessageId], references: [id], onDelete: Restrict, onUpdate: Cascade, map: "comms_delivery_receipts_communication_message_id_fkey")\n'
            "}\n"
        )
        migration_sql = (
            '"outbound_comms_dispatches_communication_message_id_fkey" '
            'REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE '
            '"comms_delivery_receipts_dispatch_id_fkey" '
            'REFERENCES "public"."outbound_comms_dispatches"("id") '
            '"comms_delivery_receipts_communication_message_id_fkey" '
            'ON DELETE RESTRICT ON UPDATE CASCADE'
        )
        self.assertEqual(guard.normalize_base_schema(baseline, migration_sql), baseline)

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
