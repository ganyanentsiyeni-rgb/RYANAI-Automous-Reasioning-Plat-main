import { resolveProviderRuntime } from './providerRegistry.js';

const OPENROUTER_MODEL_IDS = new Set([
  '~openai/gpt-latest',
  '~anthropic/claude-sonnet-latest',
]);

export interface SelectedReasoningModel {
  providerId: 'openrouter';
  model: string;
}

/**
 * Resolve only explicitly catalogued OpenRouter models through the canonical
 * API-owned registry. This returns no endpoint or credential to the worker.
 */
export function resolveSelectedReasoningModel(
  model: string | undefined,
  env: Record<string, string | undefined> = process.env,
): SelectedReasoningModel | null {
  if (!model || model === 'gpt-4o' || model === 'gpt-4o-mini') return null;
  if (!OPENROUTER_MODEL_IDS.has(model)) {
    throw new Error('Unsupported reasoning model selection.');
  }
  // Registry resolution enforces the server-side allowlist, HTTPS endpoint,
  // and credential presence before the worker attempts any provider request.
  resolveProviderRuntime('openrouter', model, env);
  return { providerId: 'openrouter', model };
}
