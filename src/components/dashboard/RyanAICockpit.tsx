import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, Brain, CheckCircle2, CircleDot, Cpu, Database, LoaderCircle, Network, Send, ShieldAlert, Wifi } from 'lucide-react';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { API_ROUTES } from '@/config/core';
import { DEFAULT_MODEL } from '@/lib/models';
import { getSnapshotFreshness } from '@/lib/healthFreshness';
import TelemetryMetricCard from '@/components/telemetry/TelemetryMetricCard';
import { createTelemetryMetricSnapshot } from '@/lib/telemetry/contracts';

type BrainId = 'primary' | 'secondary' | 'logic';
interface BrainHealth { brain: BrainId; model?: string; status: string; latencyMs?: number | null; checkedAt?: string; lastSuccessAt?: string | null; lastError?: string | null; }
interface BrainHealthResponse { brains?: BrainHealth[]; timestamp?: string; }
interface HandoffSnapshot { fromAgent: string; toAgent: string; status: string; startedAt?: string; completedAt?: string | null; error?: string | null; }
interface StreamEvent { status?: 'processing' | 'complete'; message?: string; result?: string; error?: string; handoffs?: HandoffSnapshot[]; runId?: string; runStatus?: string; }
interface EvidenceSnapshot { eventType: string; payload: Record<string, unknown>; createdAt: string; sequence: number; }
interface OperationTask { id: string; status: string; createdAt: string; completedAt?: string | null; error?: string | null; handoffs?: HandoffSnapshot[]; evidence?: EvidenceSnapshot[]; }
interface OperationSnapshot { tasks?: OperationTask[]; queue?: { available?: boolean; queued?: number | null; running?: number | null; failed?: number | null; cancelled?: number | null; total?: number | null }; worker?: { state?: string; listenerState?: string | null; listenerConnected?: boolean; listenerSubscribed?: boolean; lastClaimedTask?: { runId: string; claimedAt: string } | null; lastProcessedTask?: { runId: string; completedAt: string; status: string } | null }; }
interface ProcessTelemetry { processCpuPercentOfOneCore?: number | null; processRssBytes?: number | null; inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null; tokensPerSecond?: number | null; gpuUtilization?: number | null; gpuMemoryBytes?: number | null; }
const labels: Record<BrainId, string> = { primary: 'NVIDIA', secondary: 'Qwen', logic: 'Logic' };
const regions = [
  { id: 'perception', label: 'Perception' },
  { id: 'planning', label: 'Planning' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'memory', label: 'Memory' },
  { id: 'verification', label: 'Verification' },
  { id: 'execution', label: 'Execution' },
] as const;
const BRAIN_SNAPSHOT_STALE_AFTER_MS = 60_000;
const BRAIN_PROVIDER_STALE_AFTER_MS = 600_000;
const API_SNAPSHOT_STALE_AFTER_MS = 90_000;

/** Cockpit renders only provider health and activity actually reported by the API. */
export default function RyanAICockpit({ userId }: { userId: string }) {
  const request = useCallback((input: string, init?: RequestInit) => authenticatedFetch(input, init, userId), [userId]);
  const { health, error: healthError, checking, refresh } = usePlatformHealth();
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState('No reasoning request is running.');
  const [brains, setBrains] = useState<BrainHealth[]>([]);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffSnapshot[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>('idle');
  const [operationStartedAt, setOperationStartedAt] = useState<number | null>(null);
  const [operationFinishedAt, setOperationFinishedAt] = useState<number | null>(null);
  const [operationSnapshot, setOperationSnapshot] = useState<OperationSnapshot | null>(null);
  const [operationSnapshotError, setOperationSnapshotError] = useState<string | null>(null);
  const [regionStates, setRegionStates] = useState<Record<string, string>>({});
  const [processTelemetry, setProcessTelemetry] = useState<ProcessTelemetry | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [request]);

  const refreshBrains = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await request(API_BASE_URL + '/api/agent/ops/brains', {
        method: 'GET', headers: { Accept: 'application/json' }, signal,
      });
      if (!response.ok) throw new Error('Brain health request failed (HTTP ' + response.status + ').');
      const payload = await response.json() as BrainHealthResponse;
      setBrains(Array.isArray(payload.brains) ? payload.brains : []);
      const snapshotMs = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : Number.NaN;
      setCheckedAt(Number.isFinite(snapshotMs) && snapshotMs <= Date.now() ? new Date(snapshotMs).toISOString() : null);
      setBrainError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setBrainError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    // Defer the initial state update until after the effect has committed.
    const initialRefresh = window.setTimeout(() => {
      void refreshBrains(controller.signal);
    }, 0);
    const timer = window.setInterval(() => void refreshBrains(), 20000);
    return () => {
      controller.abort();
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [refreshBrains]);

  const refreshOperation = useCallback(async (signal?: AbortSignal) => {
    try {
      const [tasksResponse, awarenessResponse] = await Promise.all([
        request(API_BASE_URL + '/api/agent/ops/tasks', { method: 'GET', headers: { Accept: 'application/json' }, signal }),
        request(API_BASE_URL + '/api/agent/ops/awareness', { method: 'GET', headers: { Accept: 'application/json' }, signal }),
      ]);
      if (!tasksResponse.ok || !awarenessResponse.ok) {
        throw new Error('Execution telemetry request failed (tasks HTTP ' + tasksResponse.status + ', worker HTTP ' + awarenessResponse.status + ').');
      }
      const [tasksPayload, awarenessPayload] = await Promise.all([tasksResponse.json(), awarenessResponse.json()]);
      const tasks = Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks as OperationTask[] : [];
      setOperationSnapshot({
        tasks,
        queue: awarenessPayload.globalQueue && typeof awarenessPayload.globalQueue === 'object' ? awarenessPayload.globalQueue : undefined,
        worker: awarenessPayload.worker && typeof awarenessPayload.worker === 'object' ? awarenessPayload.worker : undefined,
      });
      const selectedTask = (runId ? tasks.find((task) => task.id === runId) : undefined) ?? (!sending ? tasks[0] : undefined);
      if (selectedTask) {
        if (!sending) {
          setRunId(selectedTask.id);
          setRunStatus(selectedTask.status);
          setHandoffs(Array.isArray(selectedTask.handoffs) ? selectedTask.handoffs : []);
          const createdAt = Date.parse(selectedTask.createdAt);
          const completedAt = selectedTask.completedAt ? Date.parse(selectedTask.completedAt) : Number.NaN;
          setOperationStartedAt(Number.isFinite(createdAt) ? createdAt : null);
          setOperationFinishedAt(Number.isFinite(completedAt) ? completedAt : null);
        }
        const nextRegions: Record<string, string> = {};
        let latestTelemetry: ProcessTelemetry | null = null;
        for (const event of [...(selectedTask.evidence ?? [])].sort((a, b) => a.sequence - b.sequence)) {
          if (event.eventType === 'region.started' || event.eventType === 'region.completed' || event.eventType === 'region.failed') {
            const region = typeof event.payload.region === 'string' ? event.payload.region : '';
            if (region) nextRegions[region] = event.eventType.replace('region.', '');
          }
          if (event.eventType === 'execution.telemetry') latestTelemetry = event.payload as ProcessTelemetry;
        }
        setRegionStates(nextRegions);
        setProcessTelemetry(latestTelemetry);
      }
      setOperationSnapshotError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setOperationSnapshotError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [request, sending, runId]);

  useEffect(() => {
    const controller = new AbortController();
    const initialRefresh = window.setTimeout(() => { void refreshOperation(controller.signal); }, 0);
    const timer = window.setInterval(() => { void refreshOperation(); }, 5_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [refreshOperation]);

  async function runReasoning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = prompt.trim();
    if (!objective || sending) return;
    setSending(true);
    setRequestError(null);
    setAnswer('');
    setHandoffs([]);
    setRegionStates({});
    setProcessTelemetry(null);
    setRunId(null);
    setRunStatus('queued');
    setOperationStartedAt(Date.now());
    setOperationFinishedAt(null);
    setActivity('Opening authenticated reasoning stream…');
    try {
      const response = await request(API_BASE_URL + API_ROUTES.streamPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ prompt: objective, model: DEFAULT_MODEL }),
      });
      if (!response.ok) throw new Error('Reasoning request failed (HTTP ' + response.status + ').');
      if (!response.body) throw new Error('The reasoning stream is unavailable in this browser.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      const consume = (frame: string) => {
        const line = frame.split('\n').find((entry) => entry.startsWith('data:'));
        if (!line) return;
        const raw = line.slice(5).trim();
        if (!raw) return;
        const message = JSON.parse(raw) as StreamEvent;
        if (message.runId) setRunId(message.runId);
        if (message.runStatus) setRunStatus(message.runStatus);
        if (message.status === 'processing') {
          setActivity(message.message || 'Orchestrator is processing.');
          if (Array.isArray(message.handoffs)) setHandoffs(message.handoffs);
        }
        if (message.status === 'complete') {
          if (!message.result) throw new Error('RyanAI completed without returning a response.');
          setAnswer(message.result);
          setRunStatus(message.runStatus || 'completed');
          setOperationFinishedAt(Date.now());
          if (Array.isArray(message.handoffs)) setHandoffs(message.handoffs);
          setActivity('Reasoning stream completed successfully.');
          completed = true;
        }
        if (message.error) throw new Error(message.error);
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        frames.forEach(consume);
        if (chunk.done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!completed) throw new Error('Reasoning stream ended before a completion event was received.');
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : String(cause));
      setRunStatus('failed');
      setOperationFinishedAt(Date.now());
      setActivity('Reasoning request failed.');
    } finally {
      setSending(false);
      void refreshBrains();
      void refreshOperation();
    }
  }

  const byId = new Map(brains.map((brain) => [brain.brain, brain]));
  const checkedAtMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
  const brainSnapshotFreshness = getSnapshotFreshness(checkedAt, now, BRAIN_SNAPSHOT_STALE_AFTER_MS);
  const brainSnapshotKnown = brainSnapshotFreshness !== 'unknown' && Number.isFinite(checkedAtMs);
  const brainSnapshotStale = brainSnapshotFreshness === 'stale';
  const brainSnapshotFresh = brainSnapshotFreshness === 'fresh';
  const brainSnapshotUnverified = brainSnapshotFreshness === 'unknown';
  const apiSnapshotFreshness = getSnapshotFreshness(health?.timestamp, now, API_SNAPSHOT_STALE_AFTER_MS);
  const apiOnline = apiSnapshotFreshness === 'fresh' && health?.status === 'online';
  const apiStateLabel = apiSnapshotFreshness === 'stale'
    ? 'API telemetry stale'
    : apiSnapshotFreshness === 'unknown'
      ? checking ? 'Checking API' : 'API status unverified'
      : health?.status === 'online' ? 'API online' : 'API unavailable';
  const apiServiceValue = (value: boolean | undefined) => apiSnapshotFreshness === 'fresh'
    ? reported(value)
    : apiSnapshotFreshness === 'stale' ? 'Telemetry stale' : 'Not verified';
  const providerCheckFresh = (brain?: BrainHealth) => getSnapshotFreshness(brain?.checkedAt, now, BRAIN_PROVIDER_STALE_AFTER_MS) === 'fresh' && (brain?.status !== 'HEALTHY' || getSnapshotFreshness(brain.lastSuccessAt, now, BRAIN_PROVIDER_STALE_AFTER_MS) === 'fresh');
  const healthyCount = brainSnapshotFresh ? brains.filter((brain) => brain.status === 'HEALTHY' && providerCheckFresh(brain) && getSnapshotFreshness(brain.lastSuccessAt, now, BRAIN_PROVIDER_STALE_AFTER_MS) === 'fresh').length : 0;
  const providerReadinessSnapshot = createTelemetryMetricSnapshot({
    metricId: 'providers.healthy.count', label: 'Verified healthy providers',
    value: brainSnapshotFresh ? healthyCount : null, unit: 'count',
    source: '/api/agent/ops/brains', observedAt: checkedAt,
    staleAfterMs: BRAIN_SNAPSHOT_STALE_AFTER_MS,
    status: brainSnapshotKnown ? 'available' : 'unavailable',
  });

  return (
    <section className="mx-auto max-w-7xl px-4 py-7 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Neural operations interface</p>
          <h1 className="mt-2 text-3xl font-bold text-white">RyanAI Command Cockpit</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Live service health, authenticated reasoning activity and independently reported brain readiness.</p>
        </div>
        <div className={'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ' + (apiOnline ? 'border-emerald-300/30 text-emerald-200' : apiSnapshotFreshness === 'stale' || apiSnapshotFreshness === 'unknown' ? 'border-amber-300/30 text-amber-200' : 'border-rose-300/30 text-rose-200')}>
          <Activity className="h-4 w-4" />
          {apiStateLabel}
        </div>
      </header>
      {healthError && <Alert tone="error">{healthError}</Alert>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TelemetryMetricCard icon={<Database className="h-4 w-4 text-cyan-300" />} label="PostgreSQL" value={apiServiceValue(health?.services?.database)} detail="Dependency signal from the platform health snapshot." source="/health" observedAt={health?.timestamp ?? null} status={health ? 'available' : 'unavailable'} />
        <TelemetryMetricCard icon={<Wifi className="h-4 w-4 text-cyan-300" />} label="Redis" value={apiServiceValue(health?.services?.redis)} detail="Dependency signal from the platform health snapshot." source="/health" observedAt={health?.timestamp ?? null} status={health ? 'available' : 'unavailable'} />
        <TelemetryMetricCard icon={<Cpu className="h-4 w-4 text-cyan-300" />} label="Reasoning graph" value={apiSnapshotFreshness === 'fresh' ? health?.activeGraph || 'Not reported' : apiSnapshotFreshness === 'stale' ? 'Telemetry stale' : 'Not verified'} detail="Graph identity reported by the API health endpoint." source="/health" observedAt={health?.timestamp ?? null} status={health ? 'available' : 'unavailable'} />
        <TelemetryMetricCard icon={<ShieldAlert className="h-4 w-4 text-cyan-300" />} label="Provider readiness" value={brainSnapshotStale ? 'Telemetry stale' : !brainSnapshotKnown || !brains.length ? 'Not reported' : healthyCount + '/3 verified healthy'} detail="Provider snapshot; each provider has its own probe timestamp." source="/api/agent/ops/brains" observedAt={checkedAt} status={brains.length ? 'available' : 'unavailable'} staleAfterMs={BRAIN_SNAPSHOT_STALE_AFTER_MS} snapshot={providerReadinessSnapshot} />
      </div>

      <section className="mt-7 rounded-2xl border border-cyan-400/20 bg-slate-950/80 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Neural core network</p><h2 className="mt-1 text-xl font-semibold text-white">Three-brain status</h2></div>
          <span className={brainSnapshotStale ? 'text-xs text-amber-200' : 'text-xs text-slate-500'}>{brainSnapshotStale ? 'Brain snapshot stale · last read ' + new Date(checkedAtMs).toLocaleTimeString() : brainSnapshotUnverified && checkedAt ? 'Brain timestamp unverified' : checkedAt ? 'Health snapshot ' + new Date(checkedAt).toLocaleTimeString() : 'Awaiting provider health snapshot'}</span>
        </div>
        {brainError && <Alert tone="warning">{brainError}</Alert>}
        {brainSnapshotStale && <Alert tone="warning">No fresh brain snapshot has arrived in over 60 seconds. Last-known provider states are marked stale and are not counted as currently healthy.</Alert>}
        {brainSnapshotUnverified && <Alert tone="warning">A valid brain snapshot timestamp has not been verified. Provider states are not counted as currently healthy.</Alert>}
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {(['primary', 'secondary', 'logic'] as BrainId[]).map((id) => <BrainCard key={id} id={id} health={byId.get(id)} activity={brainActivity(id, handoffs)} snapshotFresh={brainSnapshotFresh} snapshotStale={brainSnapshotStale} providerFresh={providerCheckFresh(byId.get(id))} />)}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
          <Network className="h-4 w-4 text-cyan-300" />
          <span>Handoff states below are read from persisted PostgreSQL execution records.</span>
          <span className="text-slate-500">No connection is shown unless the worker records it.</span>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={runReasoning} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-7">
          <label htmlFor="cockpit-prompt" className="flex items-center gap-2 font-semibold text-white"><Brain className="h-5 w-5 text-cyan-300" /> Run a reasoning request</label>
          <textarea id="cockpit-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={20000} rows={4} placeholder="Describe the question or task for RyanAI…" className="mt-4 w-full resize-y rounded-xl border border-white/10 bg-slate-950 p-4 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{prompt.length.toLocaleString()} / 20,000 characters</span>
            <button type="submit" disabled={sending || !prompt.trim() || !apiOnline} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? 'Reasoning…' : 'Run request'}
            </button>
          </div>
        </form>
        <aside className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-cyan-300" /> Live operation</div>
          <div className="mt-4 flex items-start gap-3"><span className={'mt-1 inline-flex h-2.5 w-2.5 rounded-full ' + (sending ? 'animate-pulse bg-cyan-300' : runStatus === 'completed' ? 'bg-emerald-400' : runStatus === 'failed' ? 'bg-rose-400' : 'bg-slate-600')} /><p aria-live="polite" className="text-sm leading-6 text-slate-300">{activity}</p></div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
            <Metric label="Execution status" value={runStatus === 'idle' ? 'No active request' : runStatus} />
            <Metric label="Elapsed" value={operationStartedAt ? Math.max(0, Math.floor((((sending ? now : operationFinishedAt ?? operationStartedAt) - operationStartedAt)) / 1000)) + 's' : 'Not started'} />
            <Metric label="Request ID" value={runId ? runId.slice(0, 12) + '…' : 'Not assigned'} />
            <Metric label="Worker" value={operationSnapshot?.worker?.state || 'Not reported'} />
            <Metric label="Queue listener" value={operationSnapshot?.worker?.listenerConnected && operationSnapshot.worker.listenerSubscribed ? 'Connected' : operationSnapshot?.worker?.listenerState || 'Not reported'} />
            <Metric label="Global queue depth" value={operationSnapshot?.queue?.available && typeof operationSnapshot.queue.queued === 'number' ? String(operationSnapshot.queue.queued) : 'Not reported'} />
            <Metric label="Active executions" value={operationSnapshot?.queue?.available && typeof operationSnapshot.queue.running === 'number' ? String(operationSnapshot.queue.running) : 'Not reported'} />
          </div>
          {operationSnapshotError && <p className="mt-3 text-xs text-amber-200">Execution snapshot unavailable: {operationSnapshotError}</p>}
          <p className="mt-3 text-xs leading-5 text-slate-500">Worker state and global reasoning queue counts are read from authenticated operational endpoints. Task history and handoffs remain owner-scoped.</p>
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Persisted brain handoffs</p>
            {handoffs.length ? <ul className="mt-2 space-y-2">{handoffs.map((handoff, index) => <li key={handoff.fromAgent + '-' + handoff.toAgent + '-' + index} className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-300">{agentLabel(handoff.fromAgent)} → {agentLabel(handoff.toAgent)}</span><span className={handoff.status === 'completed' ? 'text-emerald-300' : handoff.status === 'failed' ? 'text-rose-300' : handoff.status === 'running' ? 'text-cyan-300' : 'text-slate-500'}>{handoff.status}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No handoff transitions reported for this request.</p>}
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Reasoning regions</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">{regions.map((region) => {
              const state = regionStates[region.id];
              const label = state === 'started' ? 'Active' : state === 'completed' ? 'Completed' : state === 'failed' ? 'Failed' : 'Not reported';
              const tone = state === 'started' ? 'text-cyan-300' : state === 'completed' ? 'text-emerald-300' : state === 'failed' ? 'text-rose-300' : 'text-slate-500';
              return <div key={region.id} className="flex justify-between gap-2 rounded-lg bg-white/[0.03] px-2 py-2"><span className="text-slate-400">{region.label}</span><span className={tone}>{label}</span></div>;
            })}</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Process CPU" value={typeof processTelemetry?.processCpuPercentOfOneCore === 'number' ? processTelemetry.processCpuPercentOfOneCore.toFixed(1) + '% of one core' : 'Not reported'} />
            <Metric label="Process RSS" value={typeof processTelemetry?.processRssBytes === 'number' ? (processTelemetry.processRssBytes / 1048576).toFixed(1) + ' MB' : 'Not reported'} />
            <Metric label="Token rate" value={typeof processTelemetry?.tokensPerSecond === 'number' ? processTelemetry.tokensPerSecond.toFixed(1) + ' tokens/s' : 'Not reported'} />
            <Metric label="GPU utilization" value={typeof processTelemetry?.gpuUtilization === 'number' ? processTelemetry.gpuUtilization.toFixed(1) + '%' : 'Not reported'} />
          </div>
        </aside>
      </section>
      {requestError && <Alert tone="error">{requestError}</Alert>}
      {answer && <article className="mt-4 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-7"><h2 className="font-semibold text-cyan-100">RyanAI response</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{answer}</p></article>}
      <button onClick={() => { void refresh(); void refreshBrains(); }} className="mt-5 text-xs text-slate-500 hover:text-cyan-200">Refresh service and brain health</button>
    </section>
  );
}

function BrainCard({ id, health, activity, snapshotFresh, snapshotStale, providerFresh }: { id: BrainId; health?: BrainHealth; activity: string; snapshotFresh: boolean; snapshotStale: boolean; providerFresh: boolean }) {
  const status = snapshotStale || (snapshotFresh && !providerFresh) ? 'STALE' : snapshotFresh && providerFresh ? health?.status || 'UNKNOWN' : 'UNKNOWN';
  const healthy = snapshotFresh && status === 'HEALTHY';
  const failed = status === 'DEGRADED' || status === 'UNCONFIGURED' || status === 'FAILED';
  const tone = healthy ? 'text-emerald-300' : failed ? 'text-rose-300' : 'text-amber-200';
  const border = healthy ? 'border-emerald-400/25' : failed ? 'border-rose-400/25' : 'border-amber-300/20';
  return (
    <article className={'rounded-xl border ' + border + ' bg-slate-900/80 p-4'}>
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-semibold text-white"><Brain className={'h-5 w-5 ' + tone} /> {labels[id]}</div><span className={'text-[10px] font-semibold uppercase tracking-wider ' + tone}>{status}</span></div>
      <div className="my-4 flex items-center justify-center"><div className={'relative flex h-24 w-24 items-center justify-center rounded-full border ' + border + ' bg-slate-950 '}><div className={'absolute inset-2 rounded-full border border-dashed ' + (healthy ? 'border-cyan-400/40' : 'border-slate-700')} style={{ animationDuration: '18s' }} /><Brain className={'h-10 w-10 ' + tone} /></div></div>
      <p className="truncate text-xs text-slate-400" title={health?.model}>{health?.model || 'Model not reported'}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Live execution</span><span className={activity === 'Completed' ? 'text-emerald-300' : activity === 'Failed' ? 'text-rose-300' : activity === 'Processing' ? 'text-cyan-300' : 'text-slate-400'}>{activity}</span></div>
      <div className="mt-2 flex justify-between gap-2 text-xs"><span className="text-slate-500">Last latency</span><span className="text-slate-300">{snapshotFresh && typeof health?.latencyMs === 'number' ? health.latencyMs + ' ms' : 'Not current'}</span></div>
      {health?.lastError && <p className="mt-2 text-xs text-rose-300">{health.lastError}</p>}
      <div className="mt-4 border-t border-white/10 pt-3"><p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Functional regions · live stage telemetry unavailable</p><div className="grid grid-cols-2 gap-1.5">{regions.map((region) => <div key={region} className="flex items-center gap-1.5 rounded-md bg-slate-950/70 px-2 py-1.5 text-[10px] text-slate-500"><CircleDot className="h-3 w-3 shrink-0" />{region}</div>)}</div></div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">{healthy ? <CheckCircle2 className="h-3 w-3 text-emerald-300" /> : <ShieldAlert className="h-3 w-3 text-amber-300" />}{healthy ? 'Provider health verified' : 'Provider requires attention or verification'}</div>
    </article>
  );
}
function agentLabel(agent: string): string {
  if (agent === 'supervisor') return 'Orchestrator';
  if (agent === 'primary') return 'NVIDIA';
  if (agent === 'secondary') return 'Qwen';
  if (agent === 'logic') return 'Logic';
  return 'Unknown agent';
}
function brainActivity(id: BrainId, handoffs: HandoffSnapshot[]): string {
  const relevant = id === 'logic'
    ? handoffs.filter((handoff) => handoff.toAgent === 'logic')
    : handoffs.filter((handoff) => handoff.fromAgent === 'supervisor' && handoff.toAgent === id);
  if (!relevant.length) return 'Not started';
  if (relevant.some((handoff) => handoff.status === 'running')) return 'Processing';
  if (relevant.some((handoff) => handoff.status === 'failed')) return 'Failed';
  if (relevant.every((handoff) => handoff.status === 'completed')) return 'Completed';
  if (relevant.every((handoff) => handoff.status === 'pending')) return 'Queued';
  return 'Waiting';
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-950/70 p-2"><div className="text-slate-500">{label}</div><div className="mt-1 font-medium text-slate-300">{value}</div></div>; }
function Alert({ children, tone }: { children: ReactNode; tone: 'error' | 'warning' }) { return <div role="alert" className={'mt-4 flex gap-2 rounded-xl border p-4 text-sm ' + (tone === 'error' ? 'border-rose-400/20 bg-rose-400/5 text-rose-200' : 'border-amber-400/20 bg-amber-400/5 text-amber-200')}><AlertCircle className="h-4 w-4 shrink-0" />{children}</div>; }
function reported(value: boolean | undefined) { return value === true ? 'Healthy' : value === false ? 'Unavailable' : 'Not reported'; }
