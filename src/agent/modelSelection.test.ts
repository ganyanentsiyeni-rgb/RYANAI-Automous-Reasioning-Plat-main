import { describe, expect, it } from 'vitest';
import { resolveSelectedReasoningModel } from './modelSelection.js';

describe('optional OpenRouter Logic model selection', () => {
  it('keeps the configured Logic provider when no override is requested', () => {
    expect(resolveSelectedReasoningModel(undefined, {})).toBeNull();
  });

  it.each(['~openai/gpt-latest', '~anthropic/claude-sonnet-latest'])(
    'resolves the catalogued model without exposing endpoint or key: %s',
    (model) => {
      expect(resolveSelectedReasoningModel(model, { OPENROUTER_API_KEY: 'test-only-key' })).toEqual({
        providerId: 'openrouter',
        model,
      });
    },
  );

  it('fails closed when the existing OpenRouter credential is unavailable', () => {
    expect(() => resolveSelectedReasoningModel('~openai/gpt-latest', {})).toThrow(/unconfigured/);
  });

  it('rejects arbitrary model IDs rather than allowing client-selected provider routing', () => {
    expect(() => resolveSelectedReasoningModel('https://attacker.example/model', { OPENROUTER_API_KEY: 'test' })).toThrow(/Unsupported reasoning model/);
  });

  it('uses the canonical registry endpoint validation', () => {
    expect(() => resolveSelectedReasoningModel('~openai/gpt-latest', {
      OPENROUTER_API_KEY: 'test',
      OPENROUTER_API_ENDPOINT: 'http://gateway.example.test/v1',
    })).toThrow(/must use HTTPS/);
  });

  it('requires the model to be in the configured OpenRouter allowlist', () => {
    expect(() => resolveSelectedReasoningModel('~openai/gpt-latest', {
      OPENROUTER_API_KEY: 'test',
      OPENROUTER_MODEL_ALLOWLIST: '~anthropic/claude-sonnet-latest',
    })).toThrow(/not allowlisted/);
  });
});
