import type { SystemStatus, ToolStep } from '@/lib/types';

interface TelemetryPanelProps {
  status: SystemStatus;
  steps: ToolStep[];
  sending: boolean;
}

function percentage(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Not reported'
    : `${value.toFixed(1)}%`;
}

function latency(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value)}ms`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</dd>
    </div>
  );
}

export default function TelemetryPanel({ status, steps, sending }: TelemetryPanelProps) {
  return (
    <section
      aria-label="System telemetry"
      className="rounded-xl border border-white/10 bg-slate-950/40 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">System telemetry</h3>
        <span className="text-xs text-slate-400">
          {sending ? 'Processing' : status.state}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="CPU" value={percentage(status.cpu)} />
        <Metric label="Memory" value={percentage(status.memory)} />
        <Metric label="Latency" value={latency(status.latency)} />
        <Metric label="Tokens in" value={Number.isFinite(status.tokensIn) ? status.tokensIn.toLocaleString() : '—'} />
        <Metric label="Tokens out" value={Number.isFinite(status.tokensOut) ? status.tokensOut.toLocaleString() : '—'} />
        <Metric label="Uptime" value={String(status.uptime ?? '—')} />
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>Model: {status.model}</span>
        <span>State: {status.state}</span>
      </div>
      {steps.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-white/10 pt-3">
          {steps.slice(-4).map((step, index) => (
            <li key={`${step.name}-${index}`} className="text-xs text-slate-300">
              <span className="font-medium">{step.name}</span>
              {step.result ? <span className="ml-2 text-slate-400">{step.result}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
