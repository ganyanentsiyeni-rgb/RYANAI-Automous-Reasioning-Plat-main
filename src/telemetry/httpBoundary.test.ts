import { describe, expect, it, vi } from 'vitest';
import { buildHttpBoundaryAttributes, finishHttpBoundarySpan } from './httpBoundary.js';

describe('HTTP telemetry boundary privacy contract', () => {
  it('records only bounded method and registered route metadata', () => {
    expect(buildHttpBoundaryAttributes({
      method: 'post',
      routeOptions: { url: '/api/tasks/:id' },
    })).toEqual({
      'http.method': 'POST',
      'http.route': '/api/tasks/:id',
    });
    expect(buildHttpBoundaryAttributes({
      method: 'GET',
      routeOptions: { url: '/api/tasks/:id?secret=query' },
    })).toEqual({
      'http.method': 'GET',
      'http.route': '/api/tasks/:id?secret=query',
    });
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
