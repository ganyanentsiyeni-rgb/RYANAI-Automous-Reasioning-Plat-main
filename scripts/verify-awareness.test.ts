import { describe, expect, it, vi } from 'vitest';
import { verifyOperationalAwareness } from './verify-awareness.mjs';

const validPayload = {
  source: 'persisted-agent-runs-and-live-worker-observer',
  generatedAt: '2026-11-08T17:00:00.000Z',
  connectivity: 'unknown',
  worker: { state: 'not_started' },
  report: { total: 0 },
  tasks: [],
};

function response(status, contentType, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Service Unavailable',
    headers: { get: () => contentType },
    text: async () => body,
  };
}

describe('operational awareness verification script', () => {
  it('accepts a successful JSON response with the required contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, 'application/json; charset=utf-8', JSON.stringify(validPayload)));
    await expect(verifyOperationalAwareness({ fetchImpl, endpoint: 'https://example.test/awareness' }))
      .resolves.toMatchObject({ workerState: 'not_started', taskCount: 0, returnedTaskCount: 0 });
  });

  it('fails on HTTP 503 instead of treating an error payload as healthy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503, 'application/json', JSON.stringify({ error: 'database unavailable' })));
    await expect(verifyOperationalAwareness({ fetchImpl })).rejects.toThrow('HTTP 503');
  });

  it('rejects non-JSON responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, 'text/html', '<html>login</html>'));
    await expect(verifyOperationalAwareness({ fetchImpl })).rejects.toThrow('Expected application/json');
  });

  it('rejects a JSON response with an incomplete awareness contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, 'application/json', JSON.stringify({ worker: {}, tasks: [] })));
    await expect(verifyOperationalAwareness({ fetchImpl })).rejects.toThrow('source marker');
  });
});
