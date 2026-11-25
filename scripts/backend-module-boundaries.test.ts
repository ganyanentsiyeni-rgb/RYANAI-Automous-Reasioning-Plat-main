import { describe, expect, it } from 'vitest';
import { findPluginBoundaryViolations } from './backend-module-boundaries.mjs';

describe('backend module boundaries', () => {
  it('keeps the server plugin module behind its public API', async () => {
    await expect(findPluginBoundaryViolations()).resolves.toEqual([]);
  });
});
