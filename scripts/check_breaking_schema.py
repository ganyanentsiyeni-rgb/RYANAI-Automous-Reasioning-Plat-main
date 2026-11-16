#!/usr/bin/env python3
"""Fail-closed Prisma schema/migration compatibility guard for pull requests."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

BREAKING_PATTERNS = (
    re.compile(r"\bDROP\s+TABLE\b", re.IGNORECASE),
    re.compile(r"\bDROP\s+COLUMN\b", re.IGNORECASE),
    re.compile(r"\bDROP\s+CONSTRAINT\b", re.IGNORECASE),
    re.compile(r"\bALTER\s+(?:TABLE\s+\S+\s+)?ALTER\s+COLUMN\b.*\bTYPE\b", re.IGNORECASE),
    re.compile(r"\bALTER\s+(?:TABLE\s+\S+\s+)?ALTER\s+COLUMN\b.*\bSET\s+NOT\s+NULL\b", re.IGNORECASE),
    re.compile(r"\bTRUNCATE\s+(?:TABLE\s+)?", re.IGNORECASE),
    re.compile(r"\bRENAME\s+(?:COLUMN|TO)\b", re.IGNORECASE),
)


def find_breaking_statements(sql: str) -> list[str]:
    """Return SQL statements/lines matching destructive or compatibility-risk DDL."""
    found: list[str] = []
    for raw_line in sql.splitlines():
        line = raw_line.strip()
        if line and any(pattern.search(line) for pattern in BREAKING_PATTERNS):
            found.append(line)
    return found


def git_text(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True, stderr=subprocess.STDOUT)


def prisma_schema_diff(base_schema: Path, current_schema: Path) -> str:
    command = [
        "npx", "--no-install", "prisma", "migrate", "diff",
        "--from-schema-datamodel", str(base_schema),
        "--to-schema-datamodel", str(current_schema),
        "--script",
    ]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(
            "Prisma schema diff failed; refusing to skip the guard. "
            f"stdout={result.stdout[-2000:]} stderr={result.stderr[-2000:]}"
        )
    return result.stdout


def changed_migration_sql(base_ref: str) -> list[tuple[str, str]]:
    changed = git_text("diff", "--name-only", f"origin/{base_ref}...HEAD")
    files: list[tuple[str, str]] = []
    for name in changed.splitlines():
        if name.startswith("prisma/migrations/") and name.endswith(".sql"):
            path = Path(name)
            if path.is_file():
                files.append((name, path.read_text(encoding="utf-8")))
    return files


def main() -> int:
    base_ref = os.getenv("GITHUB_BASE_REF", "main").strip()
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", base_ref):
        print(f"::error::Invalid base ref: {base_ref!r}")
        return 2

    try:
        base_schema_text = git_text("show", f"origin/{base_ref}:prisma/schema.prisma")
    except subprocess.CalledProcessError as exc:
        print("::error::Could not read the target branch Prisma schema; guard cannot pass.")
        print(exc.output)
        return 2

    current_schema = Path("prisma/schema.prisma")
    if not current_schema.is_file():
        print("::error::PR schema prisma/schema.prisma is missing.")
        return 2

    findings: list[tuple[str, str]] = []
    with tempfile.TemporaryDirectory(prefix="ryanai-prisma-base-") as temp_dir:
        base_schema = Path(temp_dir) / "schema.prisma"
        base_schema.write_text(base_schema_text, encoding="utf-8")
        try:
            schema_sql = prisma_schema_diff(base_schema, current_schema)
        except RuntimeError as exc:
            print(f"::error::{exc}")
            return 2
        findings.extend(("schema diff", line) for line in find_breaking_statements(schema_sql))

    try:
        for filename, sql in changed_migration_sql(base_ref):
            findings.extend((filename, line) for line in find_breaking_statements(sql))
    except subprocess.CalledProcessError as exc:
        print("::error::Could not enumerate changed migration files; guard cannot pass.")
        print(exc.output)
        return 2

    if findings:
        print("## Potentially breaking Prisma/database changes")
        print()
        print("These operations require explicit database-owner review and an expand/contract plan.")
        for source, statement in findings:
            safe_statement = statement.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            print(f"::error title=Breaking database change::{source}: {safe_statement}")
            print(f"- **{source}**: `{statement}`")
        summary = os.getenv("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as handle:
                handle.write("## Potentially breaking Prisma/database changes\n\n")
                for source, statement in findings:
                    handle.write(f"- **{source}**: `{statement}`\n")
        return 1

    print("No configured destructive-DDL patterns detected. This is a static guard, not proof of zero downtime.")
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("No configured destructive-DDL patterns detected. Static analysis does not prove zero downtime.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
