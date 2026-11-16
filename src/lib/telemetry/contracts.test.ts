import { describe, expect, it } from 'vitest';
import { createTelemetryMetricSnapshot } from './contracts.js';

describe('shared telemetry snapshot contract', () => {
  it('records units, source and timestamped freshness', () => {
    const snapshot = createTelemetryMetricSnapshot({
      metricId: 'api.uptime', label: 'API process uptime', value: 42,
      unit: 'seconds', source: 'admin-metrics', observedAt: '2026-11-08T10:00:00Z',
      nowMs: Date.parse('2026-11-08T10:00:30Z'), staleAfterMs: 90_000,
    });
    expect(snapshot).toMatchObject({
      schemaVersion: 'ryanai.telemetry.metric/v1',
      value: 42, unit: 'seconds', freshness: 'fresh', status: 'available',
    });
  });

  it('does not turn missing, stale or future timestamps into fresh data', () => {
    const nowMs = Date.parse('2026-11-08T10:00:00Z');
    expect(createTelemetryMetricSnapshot({
      metricId: 'missing', label: 'Missing', value: 1, unit: 'count', source: 'test', nowMs,
    }).freshness).toBe('unknown');
    expect(createTelemetryMetricSnapshot({
      metricId: 'stale', label: 'Stale', value: 1, unit: 'count', source: 'test',
      observedAt: '2026-11-08T09:00:00Z', nowMs,
    }).freshness).toBe('stale');
    expect(createTelemetryMetricSnapshot({
      metricId: 'future', label: 'Future', value: 1, unit: 'count', source: 'test',
      observedAt: '2999-01-01T00:00:00Z', nowMs,
    }).freshness).toBe('unknown');
    expect(createTelemetryMetricSnapshot({
      metricId: 'malformed', label: 'Malformed', value: 1, unit: 'count', source: 'test',
      observedAt: 'not-a-timestamp', nowMs,
    }).freshness).toBe('unknown');
  });

  it('rejects non-finite values and keeps error/unavailable states explicit', () => {
    const snapshot = createTelemetryMetricSnapshot({
      metricId: 'invalid', label: 'Invalid', value: Number.POSITIVE_INFINITY,
      unit: 'unknown', source: 'test', status: 'error',
    });
    expect(snapshot.value).toBeNull();
    expect(snapshot.status).toBe('error');
    expect(snapshot.freshness).toBe('unknown');

    const invalidDefault = createTelemetryMetricSnapshot({
      metricId: 'invalid-default', label: 'Invalid default', value: Number.POSITIVE_INFINITY,
      unit: 'unknown', source: 'test', observedAt: '2026-11-08T10:00:00Z',
      nowMs: Date.parse('2026-11-08T10:00:30Z'),
    });
    expect(invalidDefault.value).toBeNull();
    expect(invalidDefault.status).toBe('unavailable');
    expect(invalidDefault.freshness).toBe('unknown');
  });
});
