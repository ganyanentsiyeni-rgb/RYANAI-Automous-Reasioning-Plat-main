import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { useRyanOperations } from '@/hooks/useRyanOperations';

function count(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : 'Not reported';
}

function label(value: string): string {
  return value.replace(/[_-]+/g, ' ');
}

/** Displays only persisted AgentRun and queue telemetry confirmed by the API. */
export default function AgentRunQueuePanel() {
  const { tasks, awareness, loading, refreshing, error, lastConfirmedAt, hasActiveRuns, refresh } = useRyanOperations();
  const queue = awareness?.globalQueue;
  const recentTasks = tasks.slice(0, 6);

  return (
    <section aria-labelledby="agent-run-queue-title" className="mt-6 rounded-2xl border border-cyan-400/20 bg-slate-950/80 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Durable execution telemetry</p>
          <h2 id="agent-run-queue-title" className="mt-1 text-xl font-semibold text-white">AgentRun queue</h2>
          <p className="mt-1 text-xs text-slate-500">
            {lastConfirmedAt ? `Last API-confirmed snapshot: ${new Date(lastConfirmedAt).toLocaleTimeString()}` : 'Waiting for a confirmed API snapshot'}
            {hasActiveRuns ? ' · Active runs are being polled' : ''}
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh telemetry
        </button>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ['Queued', queue?.queued],
          ['Running', queue?.running],
          ['Failed', queue?.failed],
          ['Cancelled', queue?.cancelled],
          ['Total', queue?.total],
        ].map(([name, value]) => (
          <div key={String(name)} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{name}</p>
            <p className="mt-1 font-mono text-lg font-semibold text-cyan-100">{count(value as number | null | undefined)}</p>
          </div>
        ))}
      </div>

      {error && <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          Recent persisted AgentRuns
        </div>
        {loading && recentTasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 p-4 text-xs text-slate-500">Loading AgentRun telemetry…</p>
        ) : recentTasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 p-4 text-xs text-slate-500">No AgentRuns were returned by the API. This is not interpreted as proof that the queue is healthy or empty.</p>
        ) : (
          <ul className="space-y-2">
            {recentTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-200">{task.objective || task.id}</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{task.id}</p>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="rounded-full border border-white/10 px-2 py-1 text-slate-300">{label(task.status)}</span>
                  <span className="text-slate-500">{task.approvalStatus ? `Approval: ${label(task.approvalStatus)}` : 'Approval: not reported'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
