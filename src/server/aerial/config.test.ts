import { describe, expect, it } from 'vitest';
import { loadAerialConfig } from './config.js';

describe('Aerial development configuration', () => {
  it('raises the development simulator without a manual flag', () => {
    const config = loadAerialConfig({
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('development-simulator');
    expect(config.baseUrl).toBeNull();
  });

  it('prefers an explicitly configured external runtime', () => {
    const config = loadAerialConfig({
      NODE_ENV: 'development',
      AERIAL_BASE_URL: 'https://aerial.example.test',
      AERIAL_INFERENCE_URL: 'https://aerial.example.test/v1/inference',
    } as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('external');
    expect(config.baseUrl).toBe('https://aerial.example.test');
    expect(config.inferenceUrl).toBe('https://aerial.example.test/v1/inference');
  });

  it('parses exact allowed hostnames and normalizes case and whitespace', () => {
    const config = loadAerialConfig({
      AERIAL_BASE_URL: 'https://aerial.example.test',
      AERIAL_ALLOWED_HOSTS: ' AERIAL.EXAMPLE.TEST, metrics.example.test ',
    } as NodeJS.ProcessEnv);

    expect(config.allowedHosts).toEqual(['aerial.example.test', 'metrics.example.test']);
  });

  it('defaults the external host allowlist to empty (fail closed)', () => {
    const config = loadAerialConfig({
      AERIAL_BASE_URL: 'https://aerial.example.test',
    } as NodeJS.ProcessEnv);

    expect(config.allowedHosts).toEqual([]);
  });

  it('keeps the external runtime when the simulator flag is also enabled', () => {
    const config = loadAerialConfig({
      NODE_ENV: 'development',
      AERIAL_DEV_SIMULATOR: 'true',
      AERIAL_BASE_URL: 'https://aerial.example.test',
      AERIAL_INFERENCE_URL: 'https://aerial.example.test/v1/inference',
    } as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('external');
    expect(config.baseUrl).toBe('https://aerial.example.test');
  });
});
