import { describe, expect, it, afterEach } from 'vitest';
import {
  incrementMetric,
  observeMetricDuration,
  resetRuntimeMetricsForTests,
  snapshotRuntimeMetrics,
} from './runtimeMetrics.js';

describe('runtime metrics', () => {
  afterEach(() => resetRuntimeMetricsForTests());

  it('keeps bounded outcome counters', () => {
    incrementMetric('agent.run', 'success');
    incrementMetric('agent.run', 'error');
    const snapshot = snapshotRuntimeMetrics();
    expect(snapshot.counters['agent.run.success'].count).toBe(1);
    expect(snapshot.counters['agent.run.error'].count).toBe(1);
  });

  it('records bounded duration aggregates without raw payloads', () => {
    observeMetricDuration('agent.run.duration', 120);
    observeMetricDuration('agent.run.duration', 80, 'success');
    const snapshot = snapshotRuntimeMetrics();
    expect(snapshot.durations['agent.run.duration'].averageMs).toBe(120);
    expect(snapshot.durations['agent.run.duration.success'].averageMs).toBe(80);
  });
});
