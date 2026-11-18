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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const workflowPath = resolve(root, '.github/workflows/provider-verification.yml');
const probePath = resolve(root, 'scripts/provider-live-probe.mjs');
const errors = [];

function fail(message) {
  errors.push(message);
}

let workflow;
try {
  workflow = parse(readFileSync(workflowPath, 'utf8'));
} catch (error) {
  console.error('ERROR .github/workflows/provider-verification.yml: ' + error.message);
  process.exit(1);
}

const triggers = workflow?.on ?? workflow?.['on'];
if (!triggers || Object.keys(triggers).length !== 1 || !Object.hasOwn(triggers, 'workflow_dispatch')) {
  fail('provider verification must remain manual-only; workflow_dispatch must be its only trigger');
}

const providerInput = triggers?.workflow_dispatch?.inputs?.provider;
const requiredProviders = ['primary', 'secondary', 'logic', 'all'];
if (providerInput?.required !== true || providerInput?.type !== 'choice' ||
    requiredProviders.some((provider) => !providerInput.options?.includes(provider))) {
  fail('workflow_dispatch must require the provider choice primary, secondary, logic, or all');
}

if (workflow?.permissions?.contents !== 'read') {
  fail('provider verification must retain read-only repository permissions');
}

const job = workflow?.jobs?.verify;
if (!job) {
  fail('missing verify job');
} else {
  if (job.environment !== 'ryanai-provider-verification') {
    fail('provider credentials must remain scoped to the ryanai-provider-verification environment');
  }
  const postgres = job.services?.postgres;
  if (postgres?.env?.POSTGRES_DB !== 'ryanai_probe' ||
      postgres?.env?.POSTGRES_USER !== 'ryanai_probe') {
    fail('provider probes must use the disposable ryanai_probe PostgreSQL service');
  }
  if (!String(job.env?.DATABASE_URL ?? '').includes('@127.0.0.1:5432/ryanai_probe')) {
    fail('DATABASE_URL must point only to the disposable loopback probe database');
  }
  if (!String(job.env?.RYANAI_PROBE_BRAIN ?? '').includes('matrix.provider')) {
    fail('the selected provider matrix value must control the probe identity');
  }
  const credentialBinding = String(job.env?.PROVIDER_API_KEY ?? '');
  for (const secret of ['NVIDIA_API_KEY', 'QWEN_API_KEY', 'LOGIC_API_KEY', 'OPENAI_API_KEY']) {
    if (!credentialBinding.includes('secrets.' + secret)) {
      fail('provider credential binding is missing the approved ' + secret + ' source');
    }
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (!steps.some((step) => String(step.run ?? '').includes('node --import tsx scripts/provider-live-probe.mjs'))) {
    fail('verify job must execute the reviewed provider-live-probe.mjs entrypoint');
  }
}

let probe = '';
try {
  probe = readFileSync(probePath, 'utf8');
} catch {
  fail('missing scripts/provider-live-probe.mjs');
}
if (!probe.includes('resolveProviderProbeConfig') || !probe.includes('assertBrainProbeResponse')) {
  fail('provider probe must use the centralized provider configuration and exact-response validator');
}
if (!probe.includes('safeProviderFailureDiagnostic') ||
    !probe.includes('Raw details withheld to protect credentials')) {
  fail('provider probe must emit sanitized diagnostics rather than raw provider errors');
}
if (/console\.(?:log|error|warn)\s*\([^)]*(?:apiKey|PROVIDER_API_KEY|authorization|x-api-key)/i.test(probe)) {
  fail('provider probe must never log credentials or authorization headers');
}
if (/console\.(?:error|warn)\s*\(\s*(?:error|err)\s*\)/i.test(probe)) {
  fail('provider probe must not print raw exception objects');
}

if (errors.length) {
  console.error(errors.map((message) => 'ERROR ' + message).join('\n'));
  process.exit(1);
}
console.log('PASS provider verification is manual-only, isolated, and credential-safe');
