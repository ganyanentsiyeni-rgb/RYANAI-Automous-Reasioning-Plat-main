#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryPath = path.join(root, "scripts/ci/required-release-check-producers.json");
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const catalogPath = path.join(root, "scripts/ci/required-release-checks.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const inventoryNames = inventory.contexts.map((context) => context.name);
if (JSON.stringify(inventoryNames) !== JSON.stringify(catalog)) {
  throw new Error("Canonical producer inventory and required-release-checks.json are out of sync");
}

if (!Number.isInteger(inventory.version) || inventory.version < 1 || !Array.isArray(inventory.contexts)) {
  throw new Error("Invalid release-check producer inventory");
}

const seen = new Set();
const failures = [];

for (const context of inventory.contexts) {
  const name = context?.name;
  const workflow = context?.workflow;
  const job = context?.job;

  if (!name || !workflow || !job) {
    failures.push("Each producer entry requires name, workflow, and job");
    continue;
  }
  if (seen.has(name)) failures.push(`Duplicate required check context: ${name}`);
  seen.add(name);

  const workflowPath = path.join(root, workflow);
  if (!fs.existsSync(workflowPath)) {
    failures.push(`Producer workflow does not exist for "${name}": ${workflow}`);
    continue;
  }

  const source = fs.readFileSync(workflowPath, "utf8");
  const declared = source.includes(`name: ${name}`) ||
    source.includes(`name: "${name}"`) ||
    source.includes(`name: '${name}'`) ||
    (name.startsWith("Analyze (") && source.includes("name: Analyze (${{ matrix.language }})")) ||
    (name.startsWith("Upgrade legacy pgvector database safely (") && source.includes("name: Upgrade legacy pgvector database safely (${{ matrix.legacy_session_column }})"));
  if (!declared) {
    failures.push(`Producer workflow does not declare required check name "${name}": ${workflow}`);
  }
}

if (seen.size !== inventory.contexts.length) {
  failures.push("Required check producer inventory contains duplicate context names");
}

if (failures.length) {
  for (const failure of failures) console.error("::error::" + failure);
  process.exit(1);
}

console.log(`Validated ${inventory.contexts.length} canonical release-check producers with unique contexts and existing workflow declarations.`);
