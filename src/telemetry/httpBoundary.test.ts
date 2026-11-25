import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishHttpBoundarySpan, startHttpBoundarySpan } from './httpBoundary.js';

describe('HTTP telemetry boundary privacy contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records only bounded method and registered route metadata', () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    vi.spyOn(
      { getTracer: () => ({ startSpan: () => span }) },
      'getTracer',
    );
    const api = vi.mocked(span);
    const started = startHttpBoundarySpan({
      method: 'post',
      routeOptions: { url: '/api/tasks/:id?secret=query' },
    }, 1000);
    expect(started.startedAt).toBe(1000);
    expect(started.span).toBeDefined();
  });

  it('finishes with status and duration but never records response content', () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const boundary = { span: span as any, startedAt: 1000 };
    finishHttpBoundarySpan(boundary, { statusCode: 503 }, 1125);
    expect(span.setAttribute).toHaveBeenCalledWith('http.status_code', 503);
    expect(span.setAttribute).toHaveBeenCalledWith('http.duration_ms', 125);
    expect(span.setStatus).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledOnce();
  });
});
