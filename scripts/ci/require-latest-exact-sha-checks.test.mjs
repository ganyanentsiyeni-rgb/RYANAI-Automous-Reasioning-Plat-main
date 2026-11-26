import test from "node:test";
import assert from "node:assert/strict";
import { latestChecksByName, parseCheckRuns, validateChecks } from "./require-latest-exact-sha-checks.mjs";

const sha = "a".repeat(40);
const name = "Validate (typecheck, lint, test, build)";
const run = (id, started_at, overrides = {}) => ({
  id, name, started_at, head_sha: sha, status: "completed", conclusion: "success", ...overrides
});

test("new successful attempt supersedes an older failure", () => {
  const checks = [run(10, "2026-11-26T10:00:00Z", { conclusion: "failure" }), run(11, "2026-11-26T11:00:00Z")];
  assert.deepEqual(validateChecks(checks, [name], sha), []);
});

test("new pending attempt blocks despite an older success", () => {
  const checks = [run(10, "2026-11-26T10:00:00Z"), run(11, "2026-11-26T11:00:00Z", { status: "in_progress", conclusion: null })];
  assert.match(validateChecks(checks, [name], sha)[0], /in_progress/);
});

test("latest attempt on a different SHA is rejected", () => {
  const checks = [run(10, "2026-11-26T11:00:00Z", { head_sha: "b".repeat(40) })];
  assert.match(validateChecks(checks, [name], sha)[0], /different SHA/);
});

test("missing required context is rejected", () => {
  assert.match(validateChecks([], [name], sha)[0], /missing/);
});

test("equal timestamps use the greater check-run ID", () => {
  const checks = [run(10, "2026-11-26T11:00:00Z", { conclusion: "failure" }), run(11, "2026-11-26T11:00:00Z")];
  assert.equal(latestChecksByName(checks).get(name).id, 11);
  assert.deepEqual(validateChecks(checks, [name], sha), []);
});

test("parses newline-delimited check runs", () => {
  const checks = [run(10, "2026-11-26T10:00:00Z"), run(11, "2026-11-26T11:00:00Z")];
  const ndjson = checks.map((check) => JSON.stringify(check)).join("\n");
  assert.deepEqual(parseCheckRuns(ndjson), checks);
});
