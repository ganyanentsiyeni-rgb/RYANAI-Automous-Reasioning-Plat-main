import type { SystemStatus, ToolStep } from '@/lib/types';

interface TelemetryPanelProps {
  status: SystemStatus;
  steps: ToolStep[];
  sending: boolean;
}

function formatPercent(value: number | null): string {
  return value === null ? 'Not reported' : `${value.toFixed(1)}%`;
}

function formatLatency(value: number | null): string {
  return value === null ? '—' : `${value}ms`;
}

export default function TelemetryPanel({ status, steps, sending }: TelemetryPanelProps) {
  const metrics = [
    { label: 'CPU usage', value: formatPercent(status.cpu) },
    { label: 'Memory usage', value: formatPercent(status.memory) },
    { label: 'Response latency', value: formatLatency(status.latency) },
  ];

  return (
    <aside className="flex h-full flex-col gap-4 rounded-xl border border-cyan-500/15 bg-slate-950/70 p-4 text-slate-100" aria-label="Live telemetry">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">System monitor</p>
          <h2 className="mt-1 text-sm font-bold text-white">Live telemetry</h2>
        </div>
        <span role="status" className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${sending ? 'border-cyan-400/30 text-cyan-200' : 'border-slate-700 text-slate-400'}`}>
          {sending ? 'Processing' : 'Idle'}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 rounded-lg border border-white/10 bg-slate-900/70 p-3">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</dt>
            <dd className="mt-2 break-words font-mono text-lg font-semibold text-cyan-200">{metric.value}</dd>
          </div>
        ))}
        <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
          <dt className="text-[10px] uppercase tracking-wider text-slate-500">Uptime</dt>
          <dd className="mt-2 font-mono text-sm font-semibold text-slate-200">{status.uptime}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <p className="rounded-lg bg-slate-900/60 p-3"><span className="block text-slate-500">Tokens in</span><strong className="mt-1 block font-mono text-slate-200">{status.tokensIn.toLocaleString()}</strong></p>
        <p className="rounded-lg bg-slate-900/60 p-3"><span className="block text-slate-500">Tokens out</span><strong className="mt-1 block font-mono text-slate-200">{status.tokensOut.toLocaleString()}</strong></p>
      </div>

      <section className="min-h-0 flex-1" aria-labelledby="telemetry-trace-title">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="telemetry-trace-title" className="text-xs font-semibold text-slate-300">Execution trace</h3>
          <span className="text-[10px] text-slate-500">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
        </div>
        {steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 p-3 text-xs text-slate-500">No execution steps reported.</p>
        ) : (
          <ol className="max-h-64 space-y-2 overflow-y-auto">
            {steps.map((step, index) => (
              <li key={`${step.name}-${index}`} className="rounded-lg border border-white/10 bg-slate-900/60 p-3">
                <p className="text-xs font-medium text-cyan-100">{step.name}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{step.type}</p>
                {step.result ? <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-400">{step.result}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-[10px] text-slate-600">Model: {status.model} · State: {status.state}</p>
    </aside>
  );
}
