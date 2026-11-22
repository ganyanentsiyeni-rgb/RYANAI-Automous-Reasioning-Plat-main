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
  const providerSecretBindings = {
    NVIDIA_API_KEY: 'NVIDIA_API_KEY',
    QWEN_API_KEY: 'QWEN_API_KEY',
    TOGETHER_API_KEY: 'TOGETHER_API_KEY',
    OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
    DASHSCOPE_API_KEY: 'DASHSCOPE_API_KEY',
    SILICONFLOW_API_KEY: 'SILICONFLOW_API_KEY',
    LOGIC_API_KEY: 'LOGIC_API_KEY',
    OPENAI_API_KEY: 'OPENAI_API_KEY',
    GROK_API_KEY: 'GROK_API_KEY',
  };
  require(
    !Object.prototype.hasOwnProperty.call(env, 'PROVIDER_API_KEY'),
    'generic PROVIDER_API_KEY is prohibited because the runtime resolver does not read it',
  );
  for (const [runtimeKey, secret] of Object.entries(providerSecretBindings)) {
    const binding = String(env[runtimeKey] ?? '');
    require(
      binding.includes('secrets.' + secret),
      'runtime credential ' + runtimeKey + ' must be bound to the matching GitHub environment secret',
    );
    const expectedBrain = runtimeKey === 'NVIDIA_API_KEY' ? 'primary'
      : ['QWEN_API_KEY', 'TOGETHER_API_KEY', 'OPENROUTER_API_KEY', 'DASHSCOPE_API_KEY', 'SILICONFLOW_API_KEY'].includes(runtimeKey) ? 'secondary'
        : 'logic';
    require(
      binding.includes("matrix.provider == '" + expectedBrain + "'"),
      runtimeKey + ' must only be exposed to its matching provider matrix job',
    );
  }
  require(
    Object.prototype.hasOwnProperty.call(env, 'TOGETHER_API_ENDPOINT'),
    'TOGETHER_API_ENDPOINT must be passed through to the canonical Qwen endpoint resolver',
  );
  for (const selector of [
    'PRIMARY_REASONING_PROVIDER', 'SECONDARY_REASONING_PROVIDER', 'LOGIC_REASONING_PROVIDER',
    'NVIDIA_PROVIDER', 'QWEN_PROVIDER', 'LOGIC_PROVIDER',
    'GROK_API_ENDPOINT', 'GROK_MODEL', 'OLLAMA_BASE_URL', 'OLLAMA_URL', 'OLLAMA_MODEL',
  ]) {
    require(
      Object.prototype.hasOwnProperty.call(env, selector),
      selector + ' must be passed through so the probe uses the runtime provider selection',
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
