import { describe, expect, it } from 'vitest';
import { loadPalantirConfig } from './config.js';

describe('Palantir configuration', () => {
  it('is disabled by default and never enables writes', () => {
    expect(loadPalantirConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      mode: 'disabled',
      baseUrl: null,
      timeoutMs: 10_000,
      readonly: true,
    });
  });

  it('requires HTTPS for an explicitly enabled external enrollment', () => {
    expect(() => loadPalantirConfig({
      PALANTIR_ENABLED: 'true',
      PALANTIR_BASE_URL: 'http://foundry.example.test',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv)).toThrow('must use HTTPS');
  });

  it('rejects credentials and query parameters embedded in the base URL', () => {
    expect(() => loadPalantirConfig({
      PALANTIR_ENABLED: 'true',
      PALANTIR_BASE_URL: 'https://user:pass@foundry.example.test?token=unsafe',
    } as NodeJS.ProcessEnv)).toThrow('must not contain credentials');
  });

  it('accepts a clean HTTPS endpoint but remains read-only', () => {
    expect(loadPalantirConfig({
      PALANTIR_ENABLED: 'true',
      PALANTIR_BASE_URL: 'https://foundry.example.test/',
    } as NodeJS.ProcessEnv)).toEqual({
      enabled: true,
      mode: 'external-read-only',
      baseUrl: 'https://foundry.example.test',
      timeoutMs: 10_000,
      readonly: true,
    });
  });

  it('allows HTTP only for localhost development', () => {
    expect(loadPalantirConfig({
      PALANTIR_ENABLED: 'true',
      PALANTIR_BASE_URL: 'http://127.0.0.1:8080',
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv).mode).toBe('external-read-only');
  });
});
