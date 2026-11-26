#!/usr/bin/env node
import fs from "node:fs";

const [inputPath, expectedSha] = process.argv.slice(2);
if (!inputPath || !/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
  console.error("Usage: node scripts/ci/require-latest-exact-sha-checks.mjs <check-runs.ndjson> <full-commit-sha>");
  process.exit(2);
}

const required = JSON.parse(fs.readFileSync(new URL("./required-release-checks.json", import.meta.url), "utf8"));
const lines = fs.readFileSync(inputPath, "utf8").split(/\\r?\\n/).filter(Boolean);
const checks = lines.map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error("Invalid check-run JSON on line " + (index + 1)); }
});
const latestByName = new Map();
for (const check of checks) {
  if (!check || typeof check.name !== "string" || !Number.isSafeInteger(check.id)) continue;
  const previous = latestByName.get(check.name);
  const timestamp = Date.parse(check.started_at ?? check.created_at ?? 0) || 0;
  const previousTimestamp = previous ? (Date.parse(previous.started_at ?? previous.created_at ?? 0) || 0) : -1;
  if (!previous || timestamp > previousTimestamp || (timestamp === previousTimestamp && check.id > previous.id)) {
    latestByName.set(check.name, check);
  }
}
const failures = [];
for (const name of required) {
  const check = latestByName.get(name);
  if (!check) {
    failures.push(name + ": missing");
    continue;
  }
  if (check.head_sha !== expectedSha) {
    failures.push(name + ": latest attempt is for a different SHA");
    continue;
  }
  if (check.status !== "completed" || check.conclusion !== "success") {
    failures.push(name + ": latest attempt status=" + check.status + ", conclusion=" + (check.conclusion ?? "none"));
  }
}
if (failures.length) {
  for (const failure of failures) console.error("::error::" + failure);
  process.exit(1);
}
console.log("All " + required.length + " required check contexts have a successful latest attempt on " + expectedSha);
