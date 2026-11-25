import { describe, expect, it, afterEach } from 'vitest';
import {
  incrementMetric,
  MAX_RUNTIME_METRIC_SERIES,
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

  it('caps distinct counter and duration series and reports dropped observations', () => {
    for (let index = 0; index < MAX_RUNTIME_METRIC_SERIES + 5; index += 1) {
      incrementMetric(`dynamic.counter.${index}`);
      observeMetricDuration(`dynamic.duration.${index}`, 10);
    }

    const snapshot = snapshotRuntimeMetrics();
    expect(Object.keys(snapshot.counters)).toHaveLength(MAX_RUNTIME_METRIC_SERIES);
    expect(Object.keys(snapshot.durations)).toHaveLength(MAX_RUNTIME_METRIC_SERIES);
    expect(snapshot.limits.maxSeriesPerType).toBe(MAX_RUNTIME_METRIC_SERIES);
    expect(snapshot.limits.droppedSeries).toBe(10);
  });

  it('continues updating existing series after the series cap is reached', () => {
    for (let index = 0; index < MAX_RUNTIME_METRIC_SERIES; index += 1) {
      incrementMetric(`counter.${index}`);
    }
    incrementMetric('counter.0');
    incrementMetric('counter.new');

    const snapshot = snapshotRuntimeMetrics();
    expect(snapshot.counters['counter.0'].count).toBe(2);
    expect(Object.keys(snapshot.counters)).toHaveLength(MAX_RUNTIME_METRIC_SERIES);
    expect(snapshot.limits.droppedSeries).toBe(1);
  });
});
