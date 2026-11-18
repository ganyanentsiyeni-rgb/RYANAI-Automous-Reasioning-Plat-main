import { useEffect, useState, type ReactNode } from 'react';
import type { TelemetryMetricSnapshot } from '@/lib/telemetry/contracts';
import { getSnapshotFreshness } from '@/lib/healthFreshness';
export interface TelemetryMetricCardProps {
  label: string;
  value: string;
  detail: string;
  source: string;
  observedAt?: string | null;
  staleAfterMs?: number;
  status?: 'available' | 'unavailable' | 'error';
  icon?: ReactNode;
  snapshot?: TelemetryMetricSnapshot;
}

/** Shared snapshot card. It never invents a trend from a single observation. */
export default function TelemetryMetricCard({
  label, value, detail, source, observedAt = null, staleAfterMs = 90_000,
  status = 'available', icon, snapshot,
}: TelemetryMetricCardProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
  }, [observedAt, snapshot?.observedAt]);

  const resolvedStatus = snapshot?.status ?? status;
  const resolvedObservedAt = snapshot ? snapshot.observedAt : observedAt;
  const resolvedSource = snapshot?.source ?? source;
  const freshness = snapshot?.freshness ?? (nowMs === null
    ? 'unknown'
    : getSnapshotFreshness(resolvedObservedAt, nowMs, staleAfterMs));
  const freshnessLabel = resolvedStatus === 'error' ? 'Error'
    : resolvedStatus === 'unavailable' ? 'Unavailable'
    : freshness === 'fresh' ? 'Fresh'
    : freshness === 'stale' ? 'Stale'
    : 'Freshness unknown';
  const tone = freshness === 'fresh' ? 'text-emerald-300'
    : resolvedStatus === 'error' ? 'text-rose-300' : 'text-amber-200';

  return (
    <article className="rounded-xl border border-white/10 bg-slate-900/70 p-4" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-slate-400">{icon}{label}</span>
        <span className={'text-[10px] font-semibold uppercase tracking-wider ' + tone}>{freshnessLabel}</span>
      </div>
      <p className="mt-3 text-xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p>
      <p className="mt-2 text-[10px] text-slate-600">
        Source: {resolvedSource} · Observed: {resolvedObservedAt ? new Date(resolvedObservedAt).toLocaleString() : 'Not reported'}{snapshot ? ' · Unit: ' + snapshot.unit : ''}
      </p>
    </article>
  );
}
