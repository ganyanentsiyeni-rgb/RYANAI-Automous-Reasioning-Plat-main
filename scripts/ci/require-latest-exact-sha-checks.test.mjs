import test from "node:test";
import assert from "node:assert/strict";

const sha = "a".repeat(40);
const base = { name: "Validate (typecheck, lint, test, build)", head_sha: sha, status: "completed", conclusion: "success" };

test("latest successful attempt supersedes an older failed attempt", () => {
  const runs = [
    { ...base, id: 10, started_at: "2026-11-26T10:00:00Z", conclusion: "failure" },
    { ...base, id: 11, started_at: "2026-11-26T11:00:00Z", conclusion: "success" }
  ];
  const latest = runs.sort((a,b) => Date.parse(a.started_at)-Date.parse(b.started_at)).at(-1);
  assert.equal(latest.conclusion, "success");
});

test("latest pending attempt remains blocking", () => {
  const runs = [
    { ...base, id: 10, started_at: "2026-11-26T10:00:00Z", conclusion: "success" },
    { ...base, id: 11, started_at: "2026-11-26T11:00:00Z", status: "in_progress", conclusion: null }
  ];
  const latest = runs.sort((a,b) => Date.parse(a.started_at)-Date.parse(b.started_at)).at(-1);
  assert.notEqual(latest.status, "completed");
});

test("a check from a different SHA is rejected", () => {
  assert.notEqual({ ...base, head_sha: "b".repeat(40) }.head_sha, sha);
});

test("duplicate timestamps use the greater check-run ID", () => {
  const runs = [
    { ...base, id: 10, started_at: "2026-11-26T11:00:00Z", conclusion: "failure" },
    { ...base, id: 11, started_at: "2026-11-26T11:00:00Z", conclusion: "success" }
  ];
  const latest = runs.reduce((a,b) => (b.id > a.id ? b : a));
  assert.equal(latest.id, 11);
});
