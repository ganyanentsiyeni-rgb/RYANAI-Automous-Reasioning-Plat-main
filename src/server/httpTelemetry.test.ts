import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { installHttpTelemetry } from './httpTelemetry.js';

describe('HTTP observability boundary', () => {
  it('creates and closes a bounded server span without recording request content', async () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
      spanContext: vi.fn(() => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
        isRemote: false,
      })),
    };
    const startSpan = vi.fn(() => span);
    vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan } as never);

    const app = Fastify();
    installHttpTelemetry(app);
    app.get('/test', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/test?secret=must-not-be-recorded',
      headers: { authorization: 'Bearer must-not-be-recorded' },
    });

    expect(response.statusCode).toBe(200);
    expect(startSpan).toHaveBeenCalledWith('http.server.request', {
      attributes: { 'http.request.method': 'GET' },
    });
    expect(span.setAttribute).toHaveBeenCalledWith('http.response.status_code', 200);
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.setStatus).not.toHaveBeenCalled();
    await app.close();
  });

  it('marks server failures as span errors', async () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
      spanContext: vi.fn(() => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1, isRemote: false })),
    };
    vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan: vi.fn(() => span) } as never);

    const app = Fastify();
    installHttpTelemetry(app);
    app.get('/failure', async (_request, reply) => reply.code(500).send({ error: 'failed' }));

    const response = await app.inject({ method: 'GET', url: '/failure' });

    expect(response.statusCode).toBe(500);
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.end).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
