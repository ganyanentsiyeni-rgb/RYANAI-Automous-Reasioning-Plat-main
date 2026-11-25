import { describe, expect, it } from 'vitest';
import { resolveRequestCorrelationId } from './requestCorrelation.js';

describe('request correlation contract', () => {
  it('preserves a bounded transport-safe request ID', () => {
    expect(resolveRequestCorrelationId({ 'x-request-id': 'req_20261125:abc-123' })).toBe('req_20261125:abc-123');
  });

  it('rejects oversized and unsafe caller IDs', () => {
    expect(resolveRequestCorrelationId({ 'x-request-id': 'bad id' })).not.toBe('bad id');
    expect(resolveRequestCorrelationId({ 'x-request-id': 'x'.repeat(129) })).not.toBe('x'.repeat(129));
  });

  it('generates an ID when the header is absent', () => {
    const id = resolveRequestCorrelationId({});
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the first value from repeated headers', () => {
    expect(resolveRequestCorrelationId({ 'x-request-id': ['first-id', 'second-id'] })).toBe('first-id');
  });
});
