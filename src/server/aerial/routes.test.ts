import { describe, expect, it } from 'vitest';
import { toPublicAerialHealth } from './routes.js';
import type { AerialHealth } from './client.js';

describe('public Aerial health diagnostics', () => {
  it('omits upstream endpoint and model metadata', () => {
    const health: AerialHealth = {
      status: 'healthy',
      mode: 'external',
      endpoint: 'https://internal-aerial-runtime.example.test',
      model: 'operator-private-model-name',
      latencyMs: 18,
      detail: 'Runtime is healthy.',
    };

    const result = toPublicAerialHealth(health);

    expect(result).toEqual({
      status: 'healthy',
      mode: 'external',
      latencyMs: 18,
      detail: 'Runtime is healthy.',
    });
    expect(JSON.stringify(result)).not.toContain('internal-aerial-runtime');
    expect(JSON.stringify(result)).not.toContain('operator-private-model-name');
  });

  it('preserves safe simulator and disabled diagnostics', () => {
    expect(toPublicAerialHealth({
      status: 'healthy',
      mode: 'development-simulator',
      endpoint: 'in-process://aerial-dev',
      model: 'aerial-dev',
      latencyMs: 0,
      detail: 'Development simulator is active.',
    })).toEqual({
      status: 'healthy',
      mode: 'development-simulator',
      latencyMs: 0,
      detail: 'Development simulator is active.',
    });

    expect(toPublicAerialHealth({
      status: 'disabled',
      mode: 'disabled',
      endpoint: null,
      model: 'aerial-dev',
      detail: 'Aerial integration is not configured.',
    })).toEqual({
      status: 'disabled',
      mode: 'disabled',
      detail: 'Aerial integration is not configured.',
    });
  });
});
