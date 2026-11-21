import { afterEach, describe, expect, it, vi } from 'vitest';
import { AerialClient } from './client.js';
import type { AerialConfig } from './config.js';

const externalConfig: AerialConfig = {
  enabled: true,
  mode: 'external',
  baseUrl: 'https://aerial.example.test',
  healthPath: '/health',
  inferenceUrl: 'https://aerial.example.test/v1/inference',
  model: 'aerial-test-model',
  timeoutMs: 1_000,
  apiKey: 'test-only-key',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AerialClient external runtime contract', () => {
  it('authenticates the health probe and reports a healthy runtime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AerialClient(externalConfig).health();

    expect(result.status).toBe('healthy');
    expect(result.mode).toBe('external');
    expect(result.endpoint).toBe(externalConfig.baseUrl);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://aerial.example.test/health');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      authorization: 'Bearer test-only-key',
    });
  });

  it('reports non-success health responses as degraded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const result = await new AerialClient(externalConfig).health();

    expect(result.status).toBe('degraded');
    expect(result.detail).toContain('503');
  });

  it('sends an authenticated inference request and returns the runtime response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      response: 'RAN inference completed',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AerialClient(externalConfig).infer({
      prompt: '  inspect cell metrics  ',
      inputs: { cellId: 'cell-01' },
    });

    expect(result).toMatchObject({
      response: 'RAN inference completed',
      model: 'aerial-test-model',
      provider: 'nvidia-aerial',
      simulated: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(externalConfig.inferenceUrl);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer test-only-key',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'aerial-test-model',
      prompt: 'inspect cell metrics',
      inputs: { cellId: 'cell-01' },
    });
  });

  it('rejects unsuccessful inference responses without exposing response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream detail', { status: 502 })));

    await expect(new AerialClient(externalConfig).infer({ prompt: 'run inference' }))
      .rejects.toThrow('Aerial inference endpoint returned HTTP 502.');
  });

  it('rejects malformed JSON from the inference runtime', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(new AerialClient(externalConfig).infer({ prompt: 'run inference' }))
      .rejects.toThrow();
  });

  it('rejects successful inference responses without textual output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ output: '   ' })));

    await expect(new AerialClient(externalConfig).infer({ prompt: 'run inference' }))
      .rejects.toThrow('Aerial inference endpoint returned no textual response.');
  });

  it('rejects blank prompts before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AerialClient(externalConfig).infer({ prompt: '   ' }))
      .rejects.toThrow('Aerial inference prompt is required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
