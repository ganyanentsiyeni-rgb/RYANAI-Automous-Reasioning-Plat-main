import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const requestSpans = new WeakMap<FastifyRequest, Span>();

/**
 * Add a privacy-bounded HTTP server span around each Fastify request.
 * Route paths, headers, bodies and authorization data are intentionally excluded.
 */
export function installHttpTelemetry(fastify: FastifyInstance): void {
  const tracer = trace.getTracer('ryanai.http');

  fastify.addHook('onRequest', async (request) => {
    const span = tracer.startSpan('http.server.request', {
      attributes: {
        'http.request.method': request.method,
      },
    });
    requestSpans.set(request, span);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const span = requestSpans.get(request);
    if (!span) return;

    span.setAttribute('http.response.status_code', reply.statusCode);
    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();

    request.log.info({
      requestId: request.id,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      statusCode: reply.statusCode,
    }, 'HTTP request observability');
  });
}
