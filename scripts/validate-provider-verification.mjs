#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';

export function validateProviderVerification(workflow, repositoryRoot = process.cwd()) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const triggers = workflow?.on ?? workflow?.['on'];

  require(workflow?.name === 'Isolated Provider Verification', 'workflow name must identify isolated provider verification');
  require(
    triggers && typeof triggers === 'object' &&
      Object.keys(triggers).length === 1 &&
      Object.prototype.hasOwnProperty.call(triggers, 'workflow_dispatch'),
    'provider verification must be manual-only (workflow_dispatch); automatic triggers are prohibited',
  );
  require(workflow?.permissions?.contents === 'read', 'workflow contents permission must remain read-only');

  const dispatchInputs = triggers?.workflow_dispatch?.inputs ?? {};
  require(
    JSON.stringify(dispatchInputs?.provider?.options ?? []) === JSON.stringify(['primary', 'secondary', 'logic', 'all']),
    'manual provider input must offer only primary, secondary, logic, and all',
  );

  const job = workflow?.jobs?.verify;
  require(Boolean(job), 'verify job is required');
  require(job?.environment === 'ryanai-provider-verification', 'provider credentials must be scoped to the dedicated verification environment');
  require(job?.permissions?.contents === undefined || job?.permissions?.contents === 'read', 'verify job must not elevate repository permissions');

  const services = job?.services ?? {};
  const postgres = services.postgres;
  require(Boolean(postgres), 'a disposable PostgreSQL service is required');
  require(String(postgres?.image ?? '').startsWith('postgres:'), 'database service must use the PostgreSQL image');
  require(postgres?.env?.POSTGRES_DB === 'ryanai_probe', 'database service must use the disposable ryanai_probe database');
  require(postgres?.env?.POSTGRES_USER === 'ryanai_probe', 'database service must use the disposable ryanai_probe user');

  const env = job?.env ?? {};
  require(
    typeof env.DATABASE_URL === 'string' && /127\.0\.0\.1|localhost/.test(env.DATABASE_URL) && /ryanai_probe/.test(env.DATABASE_URL),
    'DATABASE_URL must target only the disposable local probe database',
  );
  require(typeof env.PROVIDER_API_KEY === 'string' && /secrets\./.test(env.PROVIDER_API_KEY), 'provider credentials must come from GitHub environment secrets');
  require(typeof env.RYANAI_PROBE_BRAIN === 'string' && /matrix\.provider/.test(env.RYANAI_PROBE_BRAIN), 'probe brain must be selected by the provider matrix');

  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const probeStep = steps.find((step) => String(step?.run ?? '').includes('scripts/provider-live-probe.mjs'));
  require(Boolean(probeStep), 'workflow must invoke the reviewed provider-live-probe.mjs entrypoint');
  require(
    existsSync(resolve(repositoryRoot, 'scripts/provider-live-probe.mjs')),
    'scripts/provider-live-probe.mjs must exist in the repository',
  );

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const workflowPath = resolve('.github/workflows/provider-verification.yml');
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const errors = validateProviderVerification(workflow);
  if (errors.length) {
    console.error(errors.map((error) => `FAIL ${error}`).join('\\n'));
    process.exit(1);
  }
  console.log('PASS provider verification workflow: manual-only, read-only, isolated database and environment-scoped credentials');
}
