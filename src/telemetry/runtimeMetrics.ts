export type MetricOutcome = 'success' | 'error' | 'rejected' | 'cancelled' | 'unknown';

interface CounterSnapshot {
  count: number;
  lastAt?: string;
}

interface HistogramSnapshot extends CounterSnapshot {
  totalMs: number;
  maxMs: number;
}

// Bound both the length of each key and the number of distinct series. The
// registry is process-local diagnostics, not a place to retain caller data.
export const MAX_RUNTIME_METRIC_SERIES = 100;
const MAX_METRIC_KEY_LENGTH = 80;
const counters = new Map<string, CounterSnapshot>();
const histograms = new Map<string, HistogramSnapshot>();
let droppedSeries = 0;

function boundedKey(name: string, outcome?: MetricOutcome): string {
  const base = name.slice(0, MAX_METRIC_KEY_LENGTH);
  return outcome ? `${base}.${outcome}` : base;
}

function canRecord<T>(registry: Map<string, T>, key: string): boolean {
  if (registry.has(key)) return true;
  if (registry.size >= MAX_RUNTIME_METRIC_SERIES) {
    droppedSeries += 1;
    return false;
  }
  return true;
}

export function incrementMetric(name: string, outcome?: MetricOutcome): void {
  const key = boundedKey(name, outcome);
  if (!canRecord(counters, key)) return;
  const current = counters.get(key) ?? { count: 0 };
  counters.set(key, { count: current.count + 1, lastAt: new Date().toISOString() });
}

export function observeMetricDuration(name: string, durationMs: number, outcome?: MetricOutcome): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const key = boundedKey(name, outcome);
  if (!canRecord(histograms, key)) return;
  const current = histograms.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
  histograms.set(key, {
    count: current.count + 1,
    totalMs: current.totalMs + Math.min(durationMs, 300_000),
    maxMs: Math.max(current.maxMs, Math.min(durationMs, 300_000)),
    lastAt: new Date().toISOString(),
  });
}

export function snapshotRuntimeMetrics() {
  return {
    counters: Object.fromEntries(counters.entries()),
    durations: Object.fromEntries(
      [...histograms.entries()].map(([key, value]) => [
        key,
        {
          count: value.count,
          totalMs: Math.round(value.totalMs),
          maxMs: Math.round(value.maxMs),
          averageMs: value.count ? Math.round(value.totalMs / value.count) : 0,
          lastAt: value.lastAt,
        },
      ]),
    ),
    limits: {
      maxSeriesPerType: MAX_RUNTIME_METRIC_SERIES,
      droppedSeries,
    },
  };
}

export function resetRuntimeMetricsForTests(): void {
  counters.clear();
  histograms.clear();
  droppedSeries = 0;
}
