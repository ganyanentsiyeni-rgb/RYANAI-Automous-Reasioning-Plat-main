import { resolveBrainApiKey, resolveBrainProviderConfig } from './providerConfig.js';
import type { BrainId } from './operationsCore.js';

type ProbeEnvironment = Record<string, string | undefined>;

export interface ProbeProviderConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

/**
 * Resolve a provider probe through the exact same endpoint, model, and
 * credential-selection rules as live brain execution.
 *
 * A probe-only credential override can certify a different key from the one
 * the runtime uses, so credentials must come from the canonical resolver.
 * Credential values are never logged or returned in probe status.
 */
export function resolveProviderProbeConfig(
  brain: BrainId,
  env: ProbeEnvironment = process.env,
): ProbeProviderConfig {
  const resolved = resolveBrainProviderConfig(brain, env);

  return {
    apiKey: resolveBrainApiKey(brain, resolved, env),
    model: resolved.model,
    endpoint: resolved.endpoint,
  };
}
