#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function latestChecksByName(checks) {
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
  return latestByName;
}

export function parseCheckRuns(ndjson) {
  return ndjson.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error("Invalid check-run JSON on line " + (index + 1)); }
  });
}

export function validateChecks(checks, required, expectedSha) {
  const latest = latestChecksByName(checks);
  const failures = [];
  for (const name of required) {
    const check = latest.get(name);
    if (!check) failures.push(name + ": missing");
    else if (check.head_sha !== expectedSha) failures.push(name + ": latest attempt is for a different SHA");
    else if (check.status !== "completed" || check.conclusion !== "success") {
      failures.push(name + ": latest attempt status=" + check.status + ", conclusion=" + (check.conclusion ?? "none"));
    }
  }
  return failures;
}

export function loadRequiredChecks(catalogPath) {
  const required = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (!Array.isArray(required) || required.length === 0 || required.some(name => typeof name !== "string" || !name.trim())) {
    throw new Error("Required CI check catalog is empty or invalid");
  }
  if (new Set(required).size !== required.length) {
    throw new Error("Required CI check catalog contains duplicate contexts");
  }
  return required;
}

async function main() {
  const [inputPath, expectedSha, catalogPath = new URL("./required-release-checks.json", import.meta.url)] = process.argv.slice(2);
  if (!inputPath || !/^[0-9a-f]{40}$/.test(expectedSha ?? "")) {
    console.error("Usage: node scripts/ci/require-latest-exact-sha-checks.mjs <check-runs.ndjson> <full-commit-sha> [catalog.json]");
    process.exit(2);
  }
  const required = loadRequiredChecks(catalogPath);
  const checks = parseCheckRuns(fs.readFileSync(inputPath, "utf8"));
  const failures = validateChecks(checks, required, expectedSha);
  if (failures.length) {
    for (const failure of failures) console.error("::error::" + failure);
    process.exit(1);
  }
  console.log("All " + required.length + " required check contexts have a successful latest attempt on " + expectedSha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
