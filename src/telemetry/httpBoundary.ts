import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

export interface HttpBoundaryRequest {
  method?: string;
  routeOptions?: { url?: string };
}

export interface HttpBoundaryReply {
  statusCode?: number;
}

export interface HttpBoundarySpan {
  span: Span;
  startedAt: number;
}

/** Keep HTTP telemetry bounded: method and registered route only, never URL/query/body/header content. */
export function buildHttpBoundaryAttributes(request: HttpBoundaryRequest): Record<string, string> {
  const method = typeof request.method === 'string' ? request.method.slice(0, 16).toUpperCase() : 'UNKNOWN';
  const rawRoute = typeof request.routeOptions?.url === 'string' ? request.routeOptions.url : 'unknown';
  const route = rawRoute.split(/[?#]/, 1)[0].slice(0, 160) || 'unknown';
  return { 'http.method': method, 'http.route': route };
}

export function startHttpBoundarySpan(request: HttpBoundaryRequest, now = Date.now()): HttpBoundarySpan {
  const span = trace.getTracer('ryanai.http').startSpan('http.server', {
    attributes: buildHttpBoundaryAttributes(request),
  });
  return { span, startedAt: now };
}

/** End the request span with bounded status/duration metadata; response bodies are never recorded. */
export function finishHttpBoundarySpan(boundary: HttpBoundarySpan, reply: HttpBoundaryReply, now = Date.now()): void {
  const statusCode = typeof reply.statusCode === 'number' && Number.isFinite(reply.statusCode)
    ? Math.trunc(reply.statusCode)
    : 0;
  const durationMs = Math.max(0, now - boundary.startedAt);
  boundary.span.setAttribute('http.status_code', statusCode);
  boundary.span.setAttribute('http.duration_ms', durationMs);
  if (statusCode >= 500) boundary.span.setStatus({ code: SpanStatusCode.ERROR });
  boundary.span.end();
}
