import { describe, expect, it } from 'vitest';
import {
  findPluginBoundaryViolations,
  isPluginImplementationImport,
} from './backend-module-boundaries.mjs';

describe('backend module boundaries', () => {
  it('keeps the server plugin module behind its public API', async () => {
    await expect(findPluginBoundaryViolations()).resolves.toEqual([]);
  });

  it('rejects relative imports into plugin implementation files', () => {
    expect(isPluginImplementationImport(
      '/repo/src/server/routes/example.ts',
      '../plugins/providerHealth.js',
      '/repo/src/server',
    )).toBe(true);
  });

  it('rejects TypeScript alias imports into plugin implementation files', () => {
    expect(isPluginImplementationImport(
      '/repo/src/server/routes/example.ts',
      '@/server/plugins/providerHealth',
      '/repo/src/server',
    )).toBe(true);
  });

  it('allows imports through the plugin public index', () => {
    expect(isPluginImplementationImport(
      '/repo/src/server/launcher.ts',
      '@/server/plugins/index.js',
      '/repo/src/server',
    )).toBe(false);
    expect(isPluginImplementationImport(
      '/repo/src/server/launcher.ts',
      '../plugins/index.js',
      '/repo/src/server',
    )).toBe(false);
  });
});
