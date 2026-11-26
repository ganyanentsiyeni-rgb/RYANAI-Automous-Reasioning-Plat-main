#!/usr/bin/env node
import fs from "node:fs";

const [catalogPath, expectedSha, maxWaitSeconds = "1800"] = process.argv.slice(2);
if (!catalogPath || !expectedSha) {
  console.error("Usage: node verify-ci-execution.mjs <catalog.json> <expected-sha> [max-wait-seconds]");
  process.exit(2);
}

const required = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
if (!Array.isArray(required) || required.length === 0) {
  throw new Error("Required CI check catalog is empty or invalid");
}

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");

const deadline = Date.now() + Number(maxWaitSeconds) * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getChecks() {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits/${expectedSha}/check-runs?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub check-runs API returned ${response.status}`);
  return (await response.json()).check_runs ?? [];
}

function latestByName(runs) {
  const map = new Map();
  for (const run of runs) {
    if (run.name === "CI execution completeness") continue;
    const current = map.get(run.name);
    if (!current) {
      map.set(run.name, run);
      continue;
    }
    const currentTime = Date.parse(current.started_at ?? current.created_at ?? 0);
    const runTime = Date.parse(run.started_at ?? run.created_at ?? 0);
    if (runTime > currentTime || (runTime === currentTime && run.id > current.id)) {
      map.set(run.name, run);
    }
  }
  return map;
}

let lastReport = "";
while (true) {
  const runs = await getChecks();
  const latest = latestByName(runs);
  const missing = required.filter(name => !latest.has(name));
  const pending = required.filter(name => {
    const run = latest.get(name);
    return run && (run.status !== "completed" || run.conclusion == null);
  });
  const failed = required.filter(name => {
    const run = latest.get(name);
    return run && run.status === "completed" && run.conclusion !== "success";
  });
  const wrongSha = required.filter(name => {
    const run = latest.get(name);
    return run && run.head_sha !== expectedSha;
  });

  const report = JSON.stringify({
    expectedSha,
    totalObserved: runs.length,
    required: required.length,
    missing,
    pending,
    failed,
    wrongSha,
  });
  if (report !== lastReport) {
    console.log(report);
    lastReport = report;
  }

  if (missing.length === 0 && pending.length === 0 && failed.length === 0 && wrongSha.length === 0) {
    console.log(`CI execution completeness PASS: ${required.length} required contexts completed successfully on ${expectedSha}`);
    process.exit(0);
  }

  if (Date.now() >= deadline) {
    console.error(`CI execution completeness BLOCKED: required contexts did not all complete successfully on ${expectedSha}`);
    process.exit(1);
  }

  await sleep(20000);
}
