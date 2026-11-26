import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const auditScript = fileURLToPath(new URL("./audit-deployment-readiness.mjs", import.meta.url));

test("deployment readiness reports each provider exactly once", () => {
  const result = spawnSync(process.execPath, [auditScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      RENDER_STAGING_DEPLOY_ENABLED: "false",
      RAILWAY_STAGING_DEPLOY_ENABLED: "false",
      AWS_ECS_DEPLOY_ENABLED: "false",
      AZURE_AKS_DEPLOY_ENABLED: "false",
      DATADOG_SYNTHETICS_ENABLED: "false",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  for (const name of ["Render", "Railway", "AWS ECS staging", "Azure AKS staging", "Datadog Synthetics"]) {
    const matches = result.stdout.split(/\r?\n/).filter((line) => line.includes(` | ${name} | `));
    assert.equal(matches.length, 1, `${name} must appear exactly once`);
  }
});
