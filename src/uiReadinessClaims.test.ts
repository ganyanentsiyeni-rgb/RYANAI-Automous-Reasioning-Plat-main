import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('UI readiness truthfulness contracts', () => {
  it('does not present security controls as a live operational connection without backend evidence', () => {
    const content = source('src/components/SecurityControls.tsx');

    expect(content).not.toContain('STATUS: OPERATIONAL');
    expect(content).not.toContain('LIVE CONNECTION');
    expect(content).toContain('STATUS: NOT VERIFIED');
    expect(content).toContain('CONNECTION NOT VERIFIED');
    expect(content).not.toContain('>ACTIVE<');
    expect(content).not.toContain('>READY<');
    expect(content).not.toContain('>ENFORCED<');
  });

  it('does not claim MCP connectivity without a runtime probe', () => {
    const content = source('src/api/mcpRoute.ts');
    expect(content).toContain("status: 'unverified'");
    expect(content).toContain("connection: 'not_checked'");
    expect(content).not.toContain("status: 'active'");
  });

  it('bounds PA runtime refreshes and ignores late responses', () => {
    const content = source('src/pages/PAAgent.tsx');
    expect(content).toContain('new AbortController()');
    expect(content).toContain('controller.abort(), 10_000');
    expect(content).toContain('refreshRequestId');
    expect(content).toContain('signal: controller.signal');
  });

  it('does not seed the engine with unverified gateway or CUDA claims', () => {
    const content = source('src/hooks/useRyanEngine.ts');

    expect(content).not.toContain('Fastify gateway connection active');
    expect(content).not.toContain('Verified CUDA driver acceleration & memory allocation.');
    expect(content).toContain('Backend health and provider capability are not yet verified.');
    expect(content).toContain('Backend capability checks are not yet verified.');
  });
});
