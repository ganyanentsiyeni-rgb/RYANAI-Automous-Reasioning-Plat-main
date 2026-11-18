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
});
