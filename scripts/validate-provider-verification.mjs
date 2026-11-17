#!/usr/bin/env node
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
