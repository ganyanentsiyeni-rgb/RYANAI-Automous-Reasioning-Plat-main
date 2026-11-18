#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'yaml';

export function validateProviderVerification(workflow, repositoryRoot = process.cwd()) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const triggers = workflow?.on ?? workflow?.['on'];

  require(workflow?.name === 'Isolated Provider Verification',
    'workflow name must identify isolated provider verification');
  require(
    triggers && typeof triggers === 'object' &&
      Object.keys(triggers).length === 1 &&
      Object.prototype.hasOwnProperty.call(triggers, 'workflow_dispatch'),
    'provider verification must be manual-only (workflow_dispatch); automatic triggers are prohibited',
  );

  const providerInput = triggers?.workflow_dispatch?.inputs?.provider;
  const requiredProviders = ['primary', 'secondary', 'logic', 'all'];
  require(
    providerInput?.required === true &&
      providerInput?.type === 'choice' &&
      JSON.stringify(providerInput?.options ?? []) === JSON.stringify(requiredProviders),
    'manual provider input must require exactly primary, secondary, logic, and all',
  );
  require(workflow?.permissions?.contents === 'read',
    'workflow contents permission must remain read-only');

  const job = workflow?.jobs?.verify;
  require(Boolean(job), 'verify job is required');
  require(job?.environment === 'ryanai-provider-verification',
    'provider credentials must be scoped to the dedicated verification environment');
  require(job?.permissions?.contents === undefined || job?.permissions?.contents === 'read',
    'verify job must not elevate repository permissions');

  const postgres = job?.services?.postgres;
  require(Boolean(postgres), 'a disposable PostgreSQL service is required');
  require(String(postgres?.image ?? '').startsWith('postgres:'),
    'database service must use the PostgreSQL image');
  require(
    postgres?.env?.POSTGRES_DB === 'ryanai_probe' &&
      postgres?.env?.POSTGRES_USER === 'ryanai_probe',
    'database service must use the disposable ryanai_probe database and user',
  );

  const env = job?.env ?? {};
  require(
    typeof env.DATABASE_URL === 'string' &&
      /127\.0\.0\.1|localhost/.test(env.DATABASE_URL) &&
      /ryanai_probe/.test(env.DATABASE_URL),
    'DATABASE_URL must target only the disposable local probe database',
  );
  require(
    typeof env.PROVIDER_API_KEY === 'string' && /secrets\./.test(env.PROVIDER_API_KEY),
    'provider credentials must come from GitHub environment secrets',
  );
  for (const secret of ['NVIDIA_API_KEY', 'QWEN_API_KEY', 'LOGIC_API_KEY', 'OPENAI_API_KEY']) {
    require(
      String(env.PROVIDER_API_KEY ?? '').includes('secrets.' + secret),
      'provider credential binding is missing the approved ' + secret + ' source',
    );
  }
  require(
    typeof env.RYANAI_PROBE_BRAIN === 'string' && /matrix\.provider/.test(env.RYANAI_PROBE_BRAIN),
    'probe brain must be selected by the provider matrix',
  );

  const steps = Array.isArray(job?.steps) ? job.steps : [];
  require(
    steps.some((step) =>
      String(step?.run ?? '').includes('node --import tsx scripts/provider-live-probe.mjs'),
    ),
    'verify job must execute the reviewed provider-live-probe.mjs entrypoint',
  );

  const probePath = resolve(repositoryRoot, 'scripts/provider-live-probe.mjs');
  require(existsSync(probePath), 'scripts/provider-live-probe.mjs must exist in the repository');
  if (existsSync(probePath)) {
    const probe = readFileSync(probePath, 'utf8');
    require(
      probe.includes('resolveProviderProbeConfig') && probe.includes('assertBrainProbeResponse'),
      'provider probe must use centralized provider configuration and exact-response validation',
    );
    require(
      probe.includes('safeProviderFailureDiagnostic') &&
        probe.includes('Raw details withheld to protect credentials'),
      'provider probe must emit sanitized diagnostics rather than raw provider errors',
    );
    require(
      !/console\.(?:log|error|warn)\s*\([^)]*(?:apiKey|PROVIDER_API_KEY|authorization|x-api-key)/i.test(probe),
      'provider probe must never log credentials or authorization headers',
    );
    require(
      !/console\.(?:error|warn)\s*\(\s*(?:error|err)\s*\)/i.test(probe),
      'provider probe must not print raw exception objects',
    );
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const workflowPath = resolve('.github/workflows/provider-verification.yml');
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8'));
  const errors = validateProviderVerification(workflow);
  if (errors.length) {
    console.error(errors.map((error) => `FAIL ${error}`).join(String.fromCharCode(10)));
    process.exit(1);
  }
  console.log('PASS provider verification is manual-only, read-only, isolated, and credential-safe');
}
