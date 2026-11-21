import { getSnapshotFreshness, type SnapshotFreshness } from '@/lib/healthFreshness';

export type TelemetryUnit =
  | 'count' | 'milliseconds' | 'seconds' | 'bytes' | 'mebibytes'
  | 'percent' | 'requests_per_second' | 'tokens_per_second' | 'unknown';

export interface TelemetryMetricSnapshot {
  schemaVersion: 'ryanai.telemetry.metric/v1';
  metricId: string;
  label: string;
  value: number | null;
  unit: TelemetryUnit;
  source: string;
  observedAt: string | null;
  freshness: SnapshotFreshness;
  windowStart?: string | null;
  windowEnd?: string | null;
  status: 'available' | 'unavailable' | 'error';
}

export function createTelemetryMetricSnapshot(input: {
  metricId: string;
  label: string;
  value: number | null;
  unit: TelemetryUnit;
  source: string;
  observedAt?: string | null;
  nowMs?: number;
  staleAfterMs?: number;
  status?: TelemetryMetricSnapshot['status'];
  windowStart?: string | null;
  windowEnd?: string | null;
}): TelemetryMetricSnapshot {
  const observedAt = input.observedAt ?? null;
  const value = typeof input.value === 'number' && Number.isFinite(input.value)
    ? input.value
    : null;
  const status = input.status ?? (value === null ? 'unavailable' : 'available');
  const freshness: SnapshotFreshness = status === 'error' || status === 'unavailable'
    ? 'unknown'
    : getSnapshotFreshness(observedAt, input.nowMs ?? Date.now(), input.staleAfterMs ?? 90_000);
  return {
    schemaVersion: 'ryanai.telemetry.metric/v1',
    metricId: input.metricId.slice(0, 80),
    label: input.label.slice(0, 100),
    value,
    unit: input.unit,
    source: input.source.slice(0, 80),
    observedAt,
    freshness,
    ...(input.windowStart ? { windowStart: input.windowStart } : {}),
    ...(input.windowEnd ? { windowEnd: input.windowEnd } : {}),
    status,
  };
}
