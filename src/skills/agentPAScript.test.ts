import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPAScript } from './agentPAScript.js';

describe('AgentPAScript read-only observer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to report active without real health probes', async () => {
    const observer = new AgentPAScript();
    await expect(observer.start()).rejects.toThrow('without real API, PostgreSQL and Redis health probes');
    expect(observer.getStatus().active).toBe(false);
    expect(observer.getStatus().workState).toBe('stopped');
  });

  it('performs a real initial observation and reports each dependency', async () => {
    const healthCheck = vi.fn().mockResolvedValue({ api: true, database: true, redis: true });
    const observer = new AgentPAScript({ healthCheck, heartbeatIntervalMs: 60000 });
    const reports: unknown[] = [];
    observer.on('report', (report) => reports.push(report));

    await observer.start();

    expect(healthCheck).toHaveBeenCalledTimes(1);
    expect(observer.getStatus()).toMatchObject({
      active: true,
      workState: 'monitoring',
      health: { api: true, database: true, redis: true },
      observationsCompleted: 1,
      eBPFPolicyEnforced: false,
      genXPolicyEngineAvailable: false,
    });
    expect(reports).toHaveLength(1);
    expect(observer.getStatus().lastTransitionAt).toBeTruthy();
    await observer.stop();
    expect(observer.getStatus().active).toBe(false);
  });

  it('continues read-only monitoring and reports degraded probes without leaking errors', async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn()
      .mockResolvedValueOnce({ api: true, database: true, redis: true })
      .mockRejectedValueOnce(new Error('postgres://user:secret@example.invalid/db'));
    const observer = new AgentPAScript({ healthCheck, heartbeatIntervalMs: 1000 });

    await observer.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(healthCheck).toHaveBeenCalledTimes(2);
    expect(observer.getStatus().workState).toBe('degraded');
    expect(observer.getStatus().health).toEqual({ api: true, database: true, redis: true });
    expect(observer.getStatus().lastError).not.toContain('secret');
    expect(observer.getStatus().lastReport).toContain('Read-only monitoring continues');
    await observer.stop();
  });

  it('records outage start and recovery timestamps when dependencies change state', async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn()
      .mockResolvedValueOnce({ api: true, database: true, redis: true })
      .mockResolvedValueOnce({ api: true, database: false, redis: true })
      .mockResolvedValueOnce({ api: true, database: true, redis: true });
    const observer = new AgentPAScript({ healthCheck, heartbeatIntervalMs: 1000 });
    const transitions: unknown[] = [];
    observer.on('transition', (event) => transitions.push(event));
    await observer.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(observer.getStatus().outageStartedAt).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(observer.getStatus().outageStartedAt).toBeNull();
    expect(observer.getStatus().lastRecoveryAt).toBeTruthy();
    expect(transitions).toHaveLength(3);
    await observer.stop();
  });

  it('treats unconfigured optional MCP and Neon integrations as neutral while core probes are healthy', async () => {
    const observer = new AgentPAScript({
      healthCheck: async () => ({ api: true, database: true, redis: true, mcpServer: null, neonAudiobookDatabase: null }),
    });
    await observer.start();
    expect(observer.getStatus().workState).toBe('monitoring');
    expect(observer.getStatus().lastReport).toContain('Optional MCP and Neon audiobook integrations are reported separately');
    expect(observer.getStatus().adoptedSkills).toContain('task-awareness');
    await observer.stop();
  });

  it('reports an unavailable MCP server as degraded', async () => {
    const observer = new AgentPAScript({
      healthCheck: async () => ({ api: true, database: true, redis: true, mcpServer: false, neonAudiobookDatabase: null }),
    });
    await observer.start();
    expect(observer.getStatus().workState).toBe('degraded');
    expect(observer.getStatus().lastReport).toContain('MCP=false');
    await observer.stop();
  });

  it('reports a configured but unavailable Neon audiobook database as degraded', async () => {
    const observer = new AgentPAScript({
      healthCheck: async () => ({ api: true, database: true, redis: true, mcpServer: true, neonAudiobookDatabase: false }),
    });
    await observer.start();
    expect(observer.getStatus().workState).toBe('degraded');
    expect(observer.getStatus().lastReport).toContain('Neon audiobook DB=false');
    await observer.stop();
  });

  it('reports an unhealthy dependency as degraded rather than healthy', async () => {
    const observer = new AgentPAScript({
      healthCheck: async () => ({ api: true, database: false, redis: true }),
    });
    await observer.start();
    expect(observer.getStatus().workState).toBe('degraded');
    expect(observer.getStatus().health.database).toBe(false);
    await observer.stop();
  });
});
