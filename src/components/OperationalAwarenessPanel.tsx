import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface AwarenessTask {
  id: string;
  title: string;
  moduleId: string;
  updatedAt: string;
  progress?: { completed: number; total: number };
  indicator: { icon: string; label: string; warning: string; explanation: string };
}
interface AwarenessSnapshot {
  generatedAt: string;
  databaseConnectivity: string;
  report: {
    total: number; executing: number; queued: number; waiting: number;
    approvalRequired: number; attentionRequired: number; completedVerified: number; offlineBlocked: number;
  };
  worker: {
    state: string; listenerState: string | null; listenerConnected: boolean;
    listenerSubscribed: boolean; lastRecoverySweepAt: string | null;
  };
  tasks: AwarenessTask[];
  status: 'online' | 'degraded';
  sources: { taskRuns: 'available' | 'unavailable'; database: 'available' | 'unavailable'; worker: 'available' | 'unavailable' };
}
function formatTime(value?: string | null) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString();
}
export default function OperationalAwarenessPanel({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<AwarenessSnapshot | null>(null);
  const [deviceOnline, setDeviceOnline] = useState(() => typeof navigator === 'undefined' ? null : navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [clock, setClock] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setDeviceOnline(false);
      setLoading(false);
      return;
    }
    try {
      const response = await authenticatedFetch('/api/agent/ops/awareness', { headers: { Accept: 'application/json' } });
      const payload = await response.json() as AwarenessSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Operational awareness is unavailable.');
      setSnapshot(payload);
      setReceivedAt(new Date().toISOString());
      setDeviceOnline(true);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh operational awareness.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const onOnline = () => { setDeviceOnline(true); void refresh(); };
    const onOffline = () => setDeviceOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const initialRefresh = window.setTimeout(() => { void refresh(); }, 0);
    const clockInterval = window.setInterval(() => setClock(Date.now()), 15_000);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearTimeout(initialRefresh);
      window.clearInterval(clockInterval);
      window.clearInterval(interval);
    };
  }, [refresh]);
  const report = snapshot?.report;
  const taskDataAvailable = snapshot?.sources.taskRuns === 'available';
  const workerReady = snapshot?.sources.worker === 'available' && snapshot?.worker.state === 'running' && snapshot.worker.listenerConnected && snapshot.worker.listenerSubscribed;
  const stale = Boolean(receivedAt && clock !== null && clock - Date.parse(receivedAt) > 90_000);
  return (
    <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-5" aria-labelledby="aioa-awareness-title" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">AIOA · continuous task awareness</p><h2 id="aioa-awareness-title" className="mt-1 text-lg font-semibold text-white">RyanAI operational report</h2><p className="mt-1 text-xs text-slate-400">Persisted tasks, database and worker signals. Device network state is separate.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading || deviceOnline === false} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className={'rounded-full border px-2.5 py-1 ' + (deviceOnline === false ? 'border-amber-300/30 text-amber-100' : 'border-emerald-300/20 text-emerald-100')}>{deviceOnline === false ? '☾ Device offline' : deviceOnline === true ? '● Device network available' : '? Device network unknown'}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-slate-200">Database: {snapshot?.databaseConnectivity ?? 'Not verified'}</span>
        <span className={'rounded-full border px-2.5 py-1 ' + (workerReady ? 'border-emerald-300/20 text-emerald-100' : 'border-amber-300/25 text-amber-100')}>Worker: {snapshot?.sources.worker === 'unavailable' ? 'Unknown' : snapshot?.worker.state ?? 'Not reported'} · listener {snapshot?.worker.listenerState ?? 'unknown'}</span>
      </div>
      {deviceOnline === false && <p role="status" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100">Device is offline. The report is last-known cached data, not a live update. Remote work is not represented as executing locally.</p>}
      {stale && <p role="status" className="mt-3 rounded-lg border border-amber-300/20 p-3 text-xs text-amber-100">Last successful snapshot is older than 90 seconds.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-300/20 bg-rose-950/20 p-3 text-xs text-rose-100">{error}</p>}
      {snapshot?.status === 'degraded' && <p role="status" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-100">Partial report: task records {snapshot.sources.taskRuns}, database probe {snapshot.sources.database}, worker observer {snapshot.sources.worker}. Unavailable sources are not treated as empty or healthy.</p>}
      {snapshot && !taskDataAvailable && <p role="status" className="mt-3 rounded-lg border border-amber-300/20 p-3 text-xs text-amber-100">Task records could not be retrieved. Task counts are withheld rather than reported as zero.</p>}
      {!snapshot && loading && <p className="mt-4 text-sm text-slate-400">Loading persisted operational state…</p>}
      {report && taskDataAvailable && <>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Executing" value={report.executing}/>
          <Metric label="Queued" value={report.queued}/>
          <Metric label="Waiting / approval" value={report.waiting + report.approvalRequired}/>
          <Metric label="Attention" value={report.attentionRequired + report.offlineBlocked} alert={report.attentionRequired + report.offlineBlocked > 0}/>
        </div>
        <p className="mt-3 text-xs text-slate-400">{report.total} tasks · {report.completedVerified} independently verified completions · Snapshot {formatTime(snapshot.generatedAt)} · Recovery sweep {formatTime(snapshot.worker.lastRecoverySweepAt)}</p>
        {!compact && <div className="mt-4 space-y-2">{snapshot.tasks.slice(0, 8).map((task) => <article key={task.id} className="rounded-lg border border-white/10 bg-slate-950/50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 flex-1 truncate text-sm text-slate-100">{task.title}</p><span className={'rounded-full border px-2 py-1 text-[10px] ' + (task.indicator.warning === 'critical' ? 'border-rose-300/25 text-rose-100' : task.indicator.warning === 'warning' ? 'border-amber-300/25 text-amber-100' : 'border-emerald-300/20 text-emerald-100')}>{task.indicator.icon} {task.indicator.label}</span></div><p className="mt-1 text-[11px] text-slate-500">Module: {task.moduleId} · {task.progress ? 'Handoffs ' + task.progress.completed + '/' + task.progress.total + ' · ' : ''}Updated {formatTime(task.updatedAt)}</p>{task.indicator.warning !== 'none' && <p className="mt-2 text-xs text-amber-100">⚠ {task.indicator.explanation}</p>}</article>)}</div>}
      </>}
      <p className="mt-3 text-[11px] text-slate-500">Read-only telemetry. Completion is not marked verified without verification evidence.</p>
    </section>
  );
}
function Metric({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className={'mt-1 text-xl font-semibold ' + (alert ? 'text-rose-200' : 'text-slate-100')}>{value}</p></div>;
}
