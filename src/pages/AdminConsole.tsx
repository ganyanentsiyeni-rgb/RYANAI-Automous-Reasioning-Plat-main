import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import TelemetryMetricCard from '@/components/telemetry/TelemetryMetricCard';
import { createTelemetryMetricSnapshot } from '@/lib/telemetry/contracts';
import AdminSettingsHub from '@/components/admin/AdminSettingsHub';
import SelfPatchPanel from '@/components/SelfPatchPanel';
import ResiliencePanel from '@/components/admin/ResiliencePanel';

interface AdminIdentity {
  authenticated: boolean;
  user: { id: string; email?: string; role: 'user' | 'admin'; displayName?: string; isOwner: boolean };
}
interface DirectoryProfile { id: string; email: string | null; fullName: string | null; createdAt: string | null; updatedAt: string | null; }
interface AuthDirectoryUser { id: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; role: string | null; }
interface AuthInventory { status: 'available' | 'not_configured' | 'unavailable'; users: AuthDirectoryUser[]; page: number; perPage: number; }
interface LifecycleRequest {
  id: string;
  action?: 'role_change' | 'suspend_account' | 'revoke_sessions';
  targetUserId?: string;
  requestedRole?: 'user' | 'admin' | null;
  reason?: string;
  state?: string;
  policyDecision?: string;
  policyRuleId?: string;
  capabilityNote?: string | null;
  actorId: string;
  createdAt: string;
}
interface AuditEvent {
  id: string;
  actorId: string;
  eventType: string;
  resourceId: string | null;
  createdAt: string;
}
interface RuntimeMetrics {
  status: string;
  readiness?: string;
  uptime: number;
  timestamp: string;
  database: { status: string; driver: string; note?: string };
  system: {
    nodeVersion: string;
    platform?: string;
    platformRelease?: string;
    architecture?: string;
    logicalProcessors?: number;
    loadAverage?: number[];
    totalMemoryMB?: number;
    freeMemoryMB?: number;
    rssMemoryMB: number;
    heapUsedMB: number;
    heapTotalMB?: number;
    externalMemoryMB?: number;
    arrayBuffersMB?: number;
    processCpuUserMs?: number;
    processCpuSystemMs?: number;
  };
}
interface PendingAction {
  id: string;
  userId: string;
  tool: string;
  args: unknown;
  summary: string;
  createdAt: string;
  expiresAt: string;
}
interface EngineeringJob {
  id: string;
  userId: string;
  objective: string;
  status: string;
  approvalStatus: string;
  planHash: string | null;
  baseCommitSha: string | null;
  proposedDiffHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  _count: { evidence: number; handoffs: number };
}

async function readJson<T>(path: string, userId: string): Promise<T> {
  const response = await authenticatedFetch(path, { headers: { Accept: 'application/json' } }, userId);
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || 'Request failed (' + response.status + ').');
  return payload;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString();
}
function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Not reported';
  const value = Math.floor(seconds);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return (days ? days + 'd ' : '') + hours + 'h ' + minutes + 'm';
}
function statusTone(value: string) {
  if (['executed', 'approved', 'completed'].includes(value.toLowerCase())) return 'text-emerald-300';
  if (['failed', 'rejected', 'cancelled', 'expired'].includes(value.toLowerCase())) return 'text-rose-300';
  return 'text-amber-200';
}

export default function AdminConsole({ userId }: { userId: string }) {
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [directoryProfiles, setDirectoryProfiles] = useState<DirectoryProfile[]>([]);
  const [authInventory, setAuthInventory] = useState<AuthInventory | null>(null);
  const [authPage, setAuthPage] = useState(1);
  const [lifecycleRequests, setLifecycleRequests] = useState<LifecycleRequest[]>([]);
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleRequest['action']>('role_change');
  const [lifecycleTarget, setLifecycleTarget] = useState('');
  const [lifecycleRole, setLifecycleRole] = useState<'user' | 'admin'>('user');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [metrics, setMetrics] = useState<RuntimeMetrics | null>(null);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [jobs, setJobs] = useState<EngineeringJob[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [resourceErrors, setResourceErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [langGraphSetupStatus, setLangGraphSetupStatus] = useState('Not run');
  const refreshRequestId = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    const results = await Promise.allSettled([
      readJson<AdminIdentity>('/api/auth/verify', userId),
      readJson<{ events: AuditEvent[] }>('/api/admin/audit-events?limit=30', userId),
      readJson<{ profiles: DirectoryProfile[]; authInventory?: AuthInventory }>('/api/admin/users?limit=50&page=' + authPage, userId),
      readJson<RuntimeMetrics>('/api/admin/metrics', userId),
      readJson<{ actions: PendingAction[] }>('/api/actions', userId),
      readJson<{ jobs: EngineeringJob[] }>('/api/engineering/jobs', userId),
    ]);
    if (requestId !== refreshRequestId.current) return;
    const nextErrors: string[] = [];
    const nextResourceErrors: Record<string, string> = {};
    if (results[0].status === 'fulfilled' && results[0].value.authenticated && results[0].value.user?.id === userId && results[0].value.user.isOwner) {
      try {
        const ledger = await readJson<{ requests: LifecycleRequest[] }>('/api/admin/account-lifecycle/requests', userId);
        setLifecycleRequests(ledger.requests ?? []);
      } catch (cause) {
        nextResourceErrors.lifecycle = String(cause);
        nextErrors.push('Owner lifecycle ledger: ' + String(cause));
      }
    } else {
      setLifecycleRequests([]);
    }
    if (results[0].status === 'fulfilled' && results[0].value.authenticated && results[0].value.user?.id === userId) {
      setIdentity(results[0].value);
    } else {
      setIdentity(null);
      nextErrors.push(results[0].status === 'rejected'
        ? 'Identity verification: ' + String(results[0].reason)
        : 'Identity verification: the API did not confirm this signed-in account.');
    }
    if (results[1].status === 'fulfilled') setAuditEvents(results[1].value.events ?? []);
    else { nextResourceErrors.audit = String(results[1].reason); nextErrors.push('Security audit: ' + String(results[1].reason)); }
    if (results[2].status === 'fulfilled') {
      setDirectoryProfiles(results[2].value.profiles ?? []);
      setAuthInventory(results[2].value.authInventory ?? null);
    } else { nextResourceErrors.directory = String(results[2].reason); nextErrors.push('User directory: ' + String(results[2].reason)); }
    if (results[3].status === 'fulfilled') setMetrics(results[3].value);
    else { nextResourceErrors.metrics = String(results[3].reason); nextErrors.push('Runtime metrics: ' + String(results[3].reason)); }
    if (results[4].status === 'fulfilled') setActions(results[4].value.actions ?? []);
    else { nextResourceErrors.actions = String(results[4].reason); nextErrors.push('Pending actions: ' + String(results[4].reason)); }
    if (results[5].status === 'fulfilled') setJobs(results[5].value.jobs ?? []);
    else { nextResourceErrors.jobs = String(results[5].reason); nextErrors.push('Engineering approvals: ' + String(results[5].reason)); }
    if (requestId === refreshRequestId.current) {
      setErrors(nextErrors);
      setResourceErrors(nextResourceErrors);
      setLoading(false);
    }
  }, [userId, authPage]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await refresh();
      if (!active) return;
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => { active = false; refreshRequestId.current += 1; window.clearInterval(timer); };
  }, [refresh]);

  async function decideAction(action: PendingAction, decision: 'approve' | 'reject') {
    if (busyId) return;
    const consequence = decision === 'approve'
      ? 'Approving this request executes the queued external action. Confirm the destination and content in the action scope first.'
      : 'Reject this queued action? It will not be sent.';
    if (!window.confirm(consequence + '\n\n' + action.summary)) return;
    setBusyId(action.id);
    setNotice('');
    setErrors([]);
    try {
      const response = await authenticatedFetch('/api/actions/' + encodeURIComponent(action.id) + '/' + decision, { method: 'POST' }, userId);
      const payload = await response.json().catch(() => ({})) as { status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Decision failed (' + response.status + ').');
      setNotice(decision === 'approve'
        ? 'Approval completed. Execution result: ' + (payload.status || 'recorded') + '.'
        : 'The pending action was rejected.');
      await refresh();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not decide this action.']);
    } finally {
      setBusyId('');
    }
  }

  async function approveJob(job: EngineeringJob) {
    if (!job.planHash || !job.baseCommitSha || !job.proposedDiffHash) {
      setErrors(['This job is missing exact plan, commit or diff bindings. It cannot be approved.']);
      return;
    }
    if (job.userId === userId) {
      setErrors(['Self-approval is prohibited. A different administrator must review this job.']);
      return;
    }
    const confirmed = window.confirm(
      'Approve this exact engineering plan for the coding queue?\n\n' +
      'Objective: ' + job.objective + '\n\n' +
      'This approves the persisted plan, base commit and diff hashes only. It does not itself enqueue or run a coding task.',
    );
    if (!confirmed) return;
    setBusyId(job.id);
    setNotice('');
    setErrors([]);
    try {
      const response = await authenticatedFetch('/api/engineering/jobs/' + encodeURIComponent(job.id) + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planHash: job.planHash,
          baseCommitSha: job.baseCommitSha,
          proposedDiffHash: job.proposedDiffHash,
        }),
      }, userId);
      const payload = await response.json().catch(() => ({})) as { error?: string; approvalStatus?: string };
      if (!response.ok) throw new Error(payload.error || 'Plan approval failed (' + response.status + ').');
      setNotice('Engineering plan approved against its persisted hashes. The separate coding-task enqueue step remains explicit.');
      await refresh();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not approve engineering plan.']);
    } finally {
      setBusyId('');
    }
  }

  async function submitLifecycleRequest() {
    if (!identity?.user.isOwner || busyId) return;
    if (!window.confirm('Create a pending ' + lifecycleAction + ' request for Auth user ' + lifecycleTarget + '? No account change will occur now.')) return;
    setBusyId('lifecycle-create');
    setErrors([]);
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/admin/account-lifecycle/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: lifecycleAction,
          targetUserId: lifecycleTarget.trim(),
          ...(lifecycleAction === 'role_change' ? { requestedRole: lifecycleRole } : {}),
          reason: lifecycleReason.trim(),
        }),
      }, userId);
      const payload = await response.json().catch(() => ({})) as { error?: string; requestId?: string; state?: string };
      if (!response.ok) throw new Error(payload.error || 'Lifecycle request failed (' + response.status + ').');
      setNotice('Pending lifecycle request recorded: ' + payload.requestId + ' · ' + payload.state + '. No account mutation was performed.');
      setLifecycleTarget('');
      setLifecycleReason('');
      await refresh();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not create lifecycle request.']);
    } finally {
      setBusyId('');
    }
  }

  async function confirmLifecycleRequest(item: LifecycleRequest) {
    if (!identity?.user.isOwner || !item.id || busyId) return;
    const expected = 'CONFIRM ' + item.id;
    const entered = window.prompt('To explicitly confirm this exact request, type:\n' + expected);
    if (entered !== expected) return;
    setBusyId(item.id);
    setErrors([]);
    setNotice('');
    try {
      const response = await authenticatedFetch('/api/admin/account-lifecycle/requests/' + encodeURIComponent(item.id) + '/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ confirmation: entered }),
      }, userId);
      const payload = await response.json().catch(() => ({})) as { error?: string; state?: string; capabilityNote?: string };
      if (!response.ok) throw new Error(payload.error || 'Lifecycle confirmation failed (' + response.status + ').');
      setNotice('Owner confirmation recorded: ' + payload.state + '. ' + (payload.capabilityNote || 'No account mutation was performed.'));
      await refresh();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not confirm lifecycle request.']);
    } finally {
      setBusyId('');
    }
  }

  async function initializeLangGraphCheckpointer() {
    if (!identity?.user.isOwner || busyId) return;
    const confirmation = window.prompt(
      'This runs the LangGraph package setup against the configured RyanAI database. It may apply the package migration ledger. No other database changes are authorized here. Type INITIALIZE LANGGRAPH to continue.',
    );
    if (confirmation !== 'INITIALIZE LANGGRAPH') return;
    setBusyId('langgraph-checkpointer-setup');
    setErrors([]);
    setNotice('');
    setLangGraphSetupStatus('Running owner-authorized initialization…');
    try {
      const response = await authenticatedFetch('/api/admin/operations/langgraph-checkpointer/setup', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as {
        status?: string; agentCheckpointer?: boolean; migrationVersion?: number; error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Checkpointer initialization failed (' + response.status + ').');
      const result = payload.status || 'unknown';
      setLangGraphSetupStatus(result + ' · schema ' + (payload.agentCheckpointer ? 'verified' : 'not verified') +
        ' · migration version ' + String(payload.migrationVersion ?? 'not reported'));
      setNotice('LangGraph checkpointer operation returned: ' + result + '. Verify the API readiness endpoint and worker state separately.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not initialize the LangGraph checkpointer.';
      setLangGraphSetupStatus('Failed · ' + message);
      setErrors([message]);
    } finally {
      setBusyId('');
    }
  }

  const pendingJobs = jobs.filter((job) => job.status === 'queued' && job.approvalStatus === 'pending');
  const approvalQueuesAvailable = !resourceErrors.actions && !resourceErrors.jobs;
  const pendingApprovalCount = actions.length + pendingJobs.length;
  const uptimeSnapshot = createTelemetryMetricSnapshot({
    metricId: 'api.process.uptime', label: 'API process uptime',
    value: metrics?.uptime ?? null, unit: 'seconds', source: '/api/admin/metrics',
    observedAt: metrics?.timestamp ?? null, status: metrics && !resourceErrors.metrics ? 'available' : 'unavailable',
  });
  const memorySnapshot = createTelemetryMetricSnapshot({
    metricId: 'api.process.rss_memory', label: 'Runtime memory RSS',
    value: metrics?.system.rssMemoryMB ?? null, unit: 'mebibytes', source: '/api/admin/metrics',
    observedAt: metrics?.timestamp ?? null, status: metrics ? 'available' : 'unavailable',
  });

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-10" aria-labelledby="admin-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Restricted control plane</p>
          <h1 id="admin-title" className="mt-2 text-3xl font-bold text-white">RyanAI Admin Console</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Runtime diagnostics, pending-action decisions and exact-plan engineering approvals.
            Every mutation is sent to an administrator-protected API and requires an explicit confirmation.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50">
          <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} /> Refresh control plane
        </button>
      </header>

      {errors.map((error, index) => <p key={index} role="alert" className="rounded-lg border border-rose-400/25 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>)}
      {notice && <p role="status" className="rounded-lg border border-cyan-300/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">{notice}</p>}

      <AdminSettingsHub />

      {identity?.user.isOwner && <SelfPatchPanel />}
      {identity?.user.isOwner && <ResiliencePanel userId={userId} />}

      {identity?.user.isOwner && <section id="admin-langgraph-setup" className="scroll-mt-6 rounded-2xl border border-amber-300/25 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="admin-langgraph-setup-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200">Owner-only · explicit execution</p>
            <h2 id="admin-langgraph-setup-title" className="mt-1 text-lg font-semibold text-white">LangGraph checkpointer initialization</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Runs the supported PostgresSaver setup against RyanAI's configured database. This is a one-time schema initialization action, not a general database migration or a readiness guarantee.</p>
          </div>
          <span className="rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-100">Server verifies owner identity</span>
        </div>
        <p className="mt-3 break-words rounded-lg border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300" role="status">Last result: {langGraphSetupStatus}</p>
        <button type="button" onClick={() => void initializeLangGraphCheckpointer()} disabled={busyId !== ''} className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-amber-300/35 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">
          {busyId === 'langgraph-checkpointer-setup' ? 'Initializing…' : 'Initialize LangGraph checkpointer'}
        </button>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">The button is rendered only after the API verifies this session as the configured owner. The endpoint independently enforces owner authorization. It does not change secrets, environment variables, hosting configuration or deployment state. After success, confirm /readyz, agentCheckpointer and agentWorker independently.</p>
      </section>}

      <section aria-label="Administrative workspaces" className="rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">U2EB · RyanAI-2</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Platform administration</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">Operational areas are shown with their actual implementation status. Unavailable modules are not presented as working controls.</p>
          </div>
          <span className="rounded-full border border-slate-400/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">Verified capabilities only · U2EB</span>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <a href="#admin-runtime" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 transition hover:border-cyan-200/50 hover:bg-cyan-300/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Available · Live endpoint</span>
            <span className="mt-1 block text-sm font-semibold text-white">Platform overview</span>
            <span className="mt-1 block text-xs text-slate-400">API runtime metrics and reported dependency state</span>
          </a>
          <a href="#admin-approvals" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 transition hover:border-cyan-200/50 hover:bg-cyan-300/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Available · Protected API</span>
            <span className="mt-1 block text-sm font-semibold text-white">Action approvals</span>
            <span className="mt-1 block text-xs text-slate-400">Review queued external actions and their scope</span>
          </a>
          <a href="#admin-engineering" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 transition hover:border-cyan-200/50 hover:bg-cyan-300/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Available · Protected API</span>
            <span className="mt-1 block text-sm font-semibold text-white">Engineering approvals</span>
            <span className="mt-1 block text-xs text-slate-400">Exact plan, base commit and diff-bound review</span>
          </a>
          <a href="#admin-identity" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 transition hover:border-cyan-200/50 hover:bg-cyan-300/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Available · Verified session</span>
            <span className="mt-1 block text-sm font-semibold text-white">Identity &amp; access</span>
            <span className="mt-1 block text-xs text-slate-400">Current principal and server-verified role</span>
          </a>
          <a href="#admin-audit" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 transition hover:border-cyan-200/50 hover:bg-cyan-300/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Available · Read only</span>
            <span className="mt-1 block text-sm font-semibold text-white">Security &amp; audit</span>
            <span className="mt-1 block text-xs text-slate-400">Recent event metadata, actor and resource references</span>
          </a>
          {[
            ['Infrastructure', 'Runtime CPU, memory and dependency observations', '#admin-runtime', 'Read-only diagnostics'],
            ['Integrations', 'Provider readiness and connection inventory', '#/cockpit', 'Open Cockpit'],
            ['AI workforce', 'Agent tasks, queues and execution progress', '#/operator', 'Open Operator'],
            ['Models & inference', 'Model routing and inference availability', '#/cockpit', 'Open Cockpit'],
            ['Database operations', 'Database readiness and runtime dependency signals', '#admin-runtime', 'Read-only diagnostics'],
            ['Communications', 'Owner-authorised channel status and conversations', identity?.user.isOwner ? '#/comms' : '#admin-identity', identity?.user.isOwner ? 'Open Comms' : 'Owner access required'],
            ['Observability', 'Platform health freshness and operational awareness', '#/dashboard', 'Open Dashboard'],
            ['Configuration', 'Account preferences and workspace settings', '#/settings', 'Open Settings'],
          ].map(([title, description, href, action]) => (
            <a key={title} href={href} className="rounded-xl border border-white/10 bg-slate-950/50 p-3 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200">{action}</span>
              <span className="mt-1 block text-sm font-semibold text-white">{title}</span>
              <span className="mt-1 block text-xs text-slate-400">{description}</span>
            </a>
          ))}
        </div>
        <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-500">Administrator access never overrides Gen-X policy. Production mutations, secrets, paid upgrades and deployments remain outside this U2EB console and require separate authorization.</p>
      </section>

      <section id="admin-user-directory" className="scroll-mt-6 rounded-2xl border border-cyan-300/15 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="admin-user-directory-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="admin-user-directory-title" className="text-lg font-semibold text-white">User directory</h2><p className="mt-1 text-sm text-slate-400">Read-only view of profile records currently stored in public.profiles.</p></div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300">{resourceErrors.directory ? 'Profile directory unavailable' : directoryProfiles.length + ' profiles returned · max 50'}</span>
        </div>
        {resourceErrors.directory
          ? <UnavailableState label="Profile directory unavailable" detail={resourceErrors.directory} />
          : directoryProfiles.length === 0
            ? <EmptyState text="No public profile records were returned. This does not prove that no Supabase Auth accounts exist." />
          : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs">
            <thead><tr className="border-b border-white/10 text-slate-500"><th className="py-2 pr-3 font-medium">Profile</th><th className="py-2 pr-3 font-medium">Email</th><th className="py-2 pr-3 font-medium">Created</th><th className="py-2 font-medium">Updated</th></tr></thead>
            <tbody>{directoryProfiles.map((profile) => <tr key={profile.id} className="border-b border-white/5 text-slate-300">
              <td className="py-3 pr-3">{profile.fullName || 'Name not set'}<span className="mt-1 block font-mono text-[10px] text-slate-600">{profile.id}</span></td>
              <td className="py-3 pr-3">{profile.email || 'Email not recorded'}</td>
              <td className="py-3 pr-3 whitespace-nowrap">{dateLabel(profile.createdAt)}</td>
              <td className="py-3 whitespace-nowrap">{dateLabel(profile.updatedAt)}</td>
            </tr>)}</tbody>
          </table></div>}
        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-white">Supabase Auth accounts</h3><p className="mt-1 text-xs text-slate-400">Server-side Auth Admin inventory · page {authInventory?.page ?? authPage} · {authInventory?.perPage ?? 50} per page</p></div>
            <span className={authInventory?.status === 'available' ? 'rounded-full border border-emerald-300/25 px-3 py-1 text-xs text-emerald-200' : 'rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200'}>
              {authInventory?.status === 'available' ? 'Auth inventory available' : authInventory?.status === 'unavailable' ? 'Auth provider unavailable' : 'Auth Admin not configured'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setAuthPage((page) => Math.max(1, page - 1))} disabled={authPage <= 1} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-300 disabled:opacity-40">Previous page</button>
            <button type="button" onClick={() => setAuthPage((page) => page + 1)} disabled={authInventory?.status !== 'available' || (authInventory.users.length < authInventory.perPage)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-300 disabled:opacity-40">Next page</button>
          </div>
          {authInventory?.status === 'available' && authInventory.users.length > 0
            ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs">
              <thead><tr className="border-b border-white/10 text-slate-500"><th className="py-2 pr-3 font-medium">Auth user ID</th><th className="py-2 pr-3 font-medium">Email</th><th className="py-2 pr-3 font-medium">App role</th><th className="py-2 pr-3 font-medium">Created</th><th className="py-2 font-medium">Last sign-in</th></tr></thead>
              <tbody>{authInventory.users.map((user) => <tr key={user.id} className="border-b border-white/5 text-slate-300">
                <td className="py-3 pr-3 font-mono">{user.id}</td><td className="py-3 pr-3">{user.email || 'No email'}</td><td className="py-3 pr-3">{user.role || 'user (default)'}</td><td className="py-3 pr-3 whitespace-nowrap">{dateLabel(user.createdAt)}</td><td className="py-3 whitespace-nowrap">{dateLabel(user.lastSignInAt)}</td>
              </tr>)}</tbody>
            </table></div>
            : <p className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-400">{authInventory?.status === 'not_configured' ? 'No server-side Supabase Auth Admin credential is configured. The profile list above remains available; no credential was created or changed.' : authInventory?.status === 'unavailable' ? 'Supabase Auth Admin did not return a usable response. No provider error details or credentials are exposed.' : 'No Auth users were returned on this page.'}</p>}
          <p className="mt-3 text-[11px] leading-5 text-slate-500">This is one read-only, paginated Auth Admin page, not a full export. No role changes, invitations, suspensions, deletions or session revocations are exposed here. Privileged lifecycle controls remain separate work requiring Gen-X authorization and immutable audit evidence.</p>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">The profile table above lists only rows in public.profiles. Auth accounts and profile records are separate sources and may not have a one-to-one match.</p>
      </section>

      {identity?.user.isOwner && <section id="admin-account-lifecycle" className="scroll-mt-6 rounded-2xl border border-amber-300/20 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="admin-account-lifecycle-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="admin-account-lifecycle-title" className="text-lg font-semibold text-white">Owner account lifecycle requests</h2><p className="mt-1 text-sm text-slate-400">Role changes, suspensions and session-revocation requests. Every request is Gen-X checked and recorded in the append-only audit ledger.</p></div>
          <span className="rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200">Owner only · no direct execution</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-300">Requested operation
            <select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value as LifecycleRequest['action'])} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="role_change">Change role</option><option value="suspend_account">Suspend account</option><option value="revoke_sessions">Revoke sessions</option>
            </select>
          </label>
          {lifecycleAction === 'role_change' && <label className="text-xs text-slate-300">New application role
            <select value={lifecycleRole} onChange={(event) => setLifecycleRole(event.target.value as 'user' | 'admin')} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="user">User</option><option value="admin">Administrator</option>
            </select>
          </label>}
          <label className="text-xs text-slate-300 sm:col-span-2">Target Supabase Auth user UUID
            <input value={lifecycleTarget} onChange={(event) => setLifecycleTarget(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white" autoComplete="off" />
          </label>
          <label className="text-xs text-slate-300 sm:col-span-2">Reason (10–500 characters)
            <textarea value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} rows={2} maxLength={500} placeholder="Explain the access change and its authorization basis." className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white" />
          </label>
          <button type="button" onClick={() => void submitLifecycleRequest()} disabled={busyId !== '' || !lifecycleTarget.trim() || lifecycleReason.trim().length < 10} className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-40 sm:col-span-2">Create pending request</button>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">Requests do not change Auth roles or bans. Confirmation requires typing the exact request ID. Session revocation remains capability-blocked because Supabase requires the target user’s JWT; RyanAI will not collect or store another user’s token. Role/suspension execution remains disabled pending separate staging validation and production authorization.</p>
        <div className="mt-5 border-t border-white/10 pt-4">
          <h3 className="text-sm font-semibold text-white">Recent lifecycle requests</h3>
          {lifecycleRequests.length === 0 ? <p className="mt-2 text-xs text-slate-500">No lifecycle requests recorded.</p> : <div className="mt-3 space-y-2">
            {lifecycleRequests.map((item) => <div key={item.id} className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-white">{item.action?.replaceAll('_', ' ') || 'Lifecycle request'} · {item.requestedRole || '—'}</span><span className={'text-xs ' + statusTone(item.state || '')}>{item.state || 'Unknown state'}</span></div>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{item.id}</p>
              <p className="mt-1 break-all text-xs text-slate-300">Target: {item.targetUserId || 'Not recorded'}</p>
              <p className="mt-1 text-xs text-slate-400">{item.reason || 'No reason recorded'}</p>
              {item.capabilityNote && <p className="mt-2 text-[11px] leading-5 text-amber-200/80">{item.capabilityNote}</p>}
              {item.state === 'PENDING_OWNER_CONFIRMATION' && <button type="button" onClick={() => void confirmLifecycleRequest(item)} disabled={busyId !== ''} className="mt-3 rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">Confirm this request</button>}
            </div>)}
          </div>}
        </div>
      </section>}

      <section id="admin-identity" className="scroll-mt-6 rounded-2xl border border-cyan-300/15 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="admin-identity-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="admin-identity-title" className="text-lg font-semibold text-white">Identity &amp; access</h2><p className="mt-1 text-sm text-slate-400">Current account details returned by the server after Supabase token verification.</p></div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300">{identity?.authenticated ? 'Session verified' : 'Verification unavailable'}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <InfoRow label="Signed-in identity" value={identity?.user.displayName || identity?.user.email || (identity ? 'Verified account' : 'Not verified')} />
          <InfoRow label="Effective role" value={identity?.user.role ?? 'Not reported'} />
          <InfoRow label="Owner authority" value={identity ? (identity.user.isOwner ? 'Owner identity confirmed by server configuration' : 'Not the configured owner') : 'Not verified'} />
          <InfoRow label="Identity source" value="Supabase Auth · server-verified access token" />
        </dl>
        <p className="mt-4 text-xs leading-5 text-slate-500">Read-only current-session view. The API verifies the bearer token with Supabase Auth, derives administrator role from trusted app metadata, and matches owner identity against server-side configuration. A tenant-wide user directory, role changes, session revocation and access-review history are not implemented. This console cannot grant administrator or owner authority.</p>
      </section>

      <section id="admin-audit" className="scroll-mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="admin-audit-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="admin-audit-title" className="text-lg font-semibold text-white">Security &amp; audit events</h2><p className="mt-1 text-sm text-slate-400">Latest persisted Jarvis audit metadata, newest first. This view does not expose free-form event details.</p></div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300">{resourceErrors.audit ? 'Audit feed unavailable' : auditEvents.length + ' events returned'}</span>
        </div>
        {resourceErrors.audit
          ? <UnavailableState label="Audit feed unavailable" detail={resourceErrors.audit} />
          : auditEvents.length === 0
            ? <EmptyState text="No audit events were returned by the API." />
            : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs">
            <thead><tr className="border-b border-white/10 text-slate-500"><th className="py-2 pr-3 font-medium">Time</th><th className="py-2 pr-3 font-medium">Event</th><th className="py-2 pr-3 font-medium">Actor ID</th><th className="py-2 font-medium">Resource ID</th></tr></thead>
            <tbody>{auditEvents.map((event) => <tr key={event.id} className="border-b border-white/5 text-slate-300">
              <td className="py-3 pr-3 whitespace-nowrap">{dateLabel(event.createdAt)}</td>
              <td className="py-3 pr-3">{event.eventType}</td>
              <td className="py-3 pr-3 font-mono">{event.actorId}</td>
              <td className="py-3 font-mono">{event.resourceId || '—'}</td>
            </tr>)}</tbody>
          </table></div>}
        <p className="mt-3 text-[11px] leading-5 text-slate-500">The API returns only event ID, actor ID, event type, resource ID and timestamp. It deliberately excludes the details JSON to avoid exposing user content or sensitive operational payloads. This is an event feed, not a complete security findings or session-review system.</p>
      </section>

      <div id="admin-runtime" className="grid scroll-mt-6 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {resourceErrors.metrics && <UnavailableState label="Runtime metrics unavailable" detail={resourceErrors.metrics} />}
        <TelemetryMetricCard label="Admin metrics endpoint" value={metrics && !resourceErrors.metrics ? metrics.status : 'Unavailable'} detail={resourceErrors.metrics ? 'Latest metrics request failed; retained values are last-known only.' : 'Protected process-metrics snapshot.'} source="/api/admin/metrics" observedAt={metrics?.timestamp ?? null} status={metrics && !resourceErrors.metrics ? 'available' : 'unavailable'} />
        <TelemetryMetricCard label="API process uptime" value={metrics ? durationLabel(metrics.uptime) : 'Not reported'} detail={resourceErrors.metrics ? 'Last-known value; latest metrics refresh failed.' : 'Process uptime only; not a deployment-health guarantee.'} source="/api/admin/metrics" observedAt={metrics?.timestamp ?? null} status={metrics && !resourceErrors.metrics ? 'available' : 'unavailable'} snapshot={uptimeSnapshot} />
        <TelemetryMetricCard label="Runtime memory" value={metrics ? metrics.system.rssMemoryMB + ' MB RSS' : 'Not reported'} detail={resourceErrors.metrics ? 'Last-known value; latest metrics refresh failed.' : metrics ? metrics.system.heapUsedMB + ' MB heap · ' + metrics.system.nodeVersion : 'Not reported'} source="/api/admin/metrics" observedAt={metrics?.timestamp ?? null} status={metrics && !resourceErrors.metrics ? 'available' : 'unavailable'} snapshot={memorySnapshot} />
        <TelemetryMetricCard label="Pending approvals" value={approvalQueuesAvailable ? String(pendingApprovalCount) : 'Unavailable'} detail={approvalQueuesAvailable ? actions.length + ' external actions · ' + pendingJobs.length + ' engineering plans' : 'One or more approval queues could not be verified.'} source="Actions and engineering queue" status={approvalQueuesAvailable ? 'available' : 'unavailable'} />
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-white">Dependency and runtime truth</h2><p className="mt-1 text-sm text-slate-400">Only values reported by the protected metrics endpoint are shown.</p></div>
          <span className="rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200">Database status: {metrics?.database.status ?? 'Not reported'}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <InfoRow label="Database driver" value={metrics?.database.driver ?? 'Not reported'} />
          <InfoRow label="Database connectivity" value={metrics?.database.status ?? 'Unknown'} />
          <InfoRow label="Node runtime" value={metrics?.system.nodeVersion ?? 'Not reported'} />
          <InfoRow label="Host platform / architecture" value={metrics?.system.platform && metrics.system.architecture ? metrics.system.platform + ' / ' + metrics.system.architecture : 'Not reported'} />
          <InfoRow label="Logical processors" value={metrics?.system.logicalProcessors === undefined ? 'Not reported' : String(metrics.system.logicalProcessors)} />
          <InfoRow label="Host memory" value={metrics?.system.totalMemoryMB === undefined ? 'Not reported' : String(metrics.system.freeMemoryMB) + ' MB free / ' + String(metrics.system.totalMemoryMB) + ' MB total'} />
          <InfoRow label="Heap allocation" value={metrics?.system.heapTotalMB === undefined ? 'Not reported' : metrics.system.heapUsedMB + ' MB used / ' + metrics.system.heapTotalMB + ' MB allocated'} />
          <InfoRow label="External / ArrayBuffer" value={metrics?.system.externalMemoryMB === undefined ? 'Not reported' : metrics.system.externalMemoryMB + ' MB external / ' + String(metrics.system.arrayBuffersMB) + ' MB buffers'} />
          <InfoRow label="Process CPU time" value={metrics?.system.processCpuUserMs === undefined ? 'Not reported' : metrics.system.processCpuUserMs + ' ms user / ' + String(metrics.system.processCpuSystemMs) + ' ms system'} />
          <InfoRow label="Load average (1 / 5 / 15 min)" value={metrics?.system.loadAverage?.map(value => value.toFixed(2)).join(' / ') ?? 'Not reported'} />
          <InfoRow label="Metrics timestamp" value={dateLabel(metrics?.timestamp)} />
        </dl>
        <p className="mt-4 text-xs leading-5 text-slate-500">{metrics?.database.note ?? 'Database state is unknown until independently verified.'} Host memory and load figures describe the runtime host view and may not equal the service container's configured resource limits. No database write or mutation is performed by this endpoint.</p>
      </section>

      <section id="admin-approvals" className="scroll-mt-6 space-y-4" aria-labelledby="pending-actions-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="pending-actions-title" className="text-xl font-semibold text-white">Pending external actions</h2><p className="mt-1 text-sm text-slate-400">Approving executes the queued action. Review its summary and arguments before deciding.</p></div>
          <span className="text-xs text-slate-500">{resourceErrors.actions ? 'Queue status unavailable' : actions.length + ' awaiting a decision'}</span>
        </div>
        {loading && <p className="text-sm text-slate-400">Loading administrator queue…</p>}
        {resourceErrors.actions && <UnavailableState label="External action queue unavailable" detail={resourceErrors.actions} />}
        {!loading && !resourceErrors.actions && actions.length === 0 && <EmptyState text="No unexpired actions are waiting for administrator approval." />}
        <div className="space-y-3">
          {actions.map((action) => (
            <article key={action.id} className="rounded-xl border border-amber-300/15 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{action.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">{action.tool} · submitted {dateLabel(action.createdAt)} · expires {dateLabel(action.expiresAt)}</p>
                  <p className="mt-1 break-all text-[10px] text-slate-600">Request {action.id} · User {action.userId}</p>
                </div>
                <span className="rounded-full border border-amber-300/25 px-2.5 py-1 text-[10px] uppercase tracking-wider text-amber-200">Pending</span>
              </div>
              <details className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                <summary className="cursor-pointer text-xs font-medium text-cyan-200">Inspect action scope and arguments</summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">{JSON.stringify(action.args, null, 2)}</pre>
              </details>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void decideAction(action, 'reject')} disabled={Boolean(busyId) || Boolean(resourceErrors.actions)} className="inline-flex items-center gap-2 rounded-lg border border-rose-300/25 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-300/10 disabled:opacity-50">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
                <button type="button" onClick={() => void decideAction(action, 'approve')} disabled={Boolean(busyId) || Boolean(resourceErrors.actions)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {busyId === action.id ? 'Processing…' : 'Approve and execute'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="admin-engineering" className="scroll-mt-6 space-y-4" aria-labelledby="engineering-approvals-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="engineering-approvals-title" className="text-xl font-semibold text-white">Engineering plan approvals</h2><p className="mt-1 text-sm text-slate-400">Approval binds the stored plan hash, base commit and proposed diff hash. Self-approval is blocked by the API.</p></div>
          <span className="text-xs text-slate-500">{resourceErrors.jobs ? 'Queue status unavailable' : pendingJobs.length + ' awaiting review'}</span>
        </div>
        {resourceErrors.jobs && <UnavailableState label="Engineering approval queue unavailable" detail={resourceErrors.jobs} />}
        {!loading && !resourceErrors.jobs && jobs.length === 0 && <EmptyState text="No engineering jobs are currently visible to this administrator." />}
        <div className="space-y-3">
          {jobs.map((job) => {
            const canApprove = job.status === 'queued' && job.approvalStatus === 'pending'
              && Boolean(job.planHash && job.baseCommitSha && job.proposedDiffHash) && job.userId !== userId;
            return (
              <article key={job.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{job.objective}</p>
                    <p className="mt-1 break-all text-[10px] text-slate-600">Job {job.id} · submitted {dateLabel(job.createdAt)}</p>
                  </div>
                  <div className="text-right text-xs"><p className={statusTone(job.status)}>{job.status}</p><p className={statusTone(job.approvalStatus)}>{job.approvalStatus}</p></div>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <InfoRow label="Evidence records" value={String(job._count?.evidence ?? 0)} />
                  <InfoRow label="Agent handoffs" value={String(job._count?.handoffs ?? 0)} />
                  <InfoRow label="Approved at" value={dateLabel(job.approvedAt)} />
                </div>
                <details className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-cyan-200">Inspect approval bindings</summary>
                  <dl className="mt-3 space-y-2 break-all text-[10px] text-slate-400">
                    <InfoRow label="Plan SHA-256" value={job.planHash ?? 'Missing'} />
                    <InfoRow label="Base commit" value={job.baseCommitSha ?? 'Missing'} />
                    <InfoRow label="Diff SHA-256" value={job.proposedDiffHash ?? 'Missing'} />
                    <InfoRow label="Approver ID" value={job.approvedBy ?? 'Not approved'} />
                  </dl>
                </details>
                {job.userId === userId && job.approvalStatus === 'pending' && <p className="mt-3 text-xs text-amber-200">You created this job. Ask a different administrator to review it.</p>}
                {job.approvalStatus === 'pending' && !job.planHash && <p className="mt-3 text-xs text-rose-200">Missing plan bindings; approval is unavailable.</p>}
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => void approveJob(job)} disabled={!canApprove || Boolean(busyId) || Boolean(resourceErrors.jobs)} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40">
                    <ClipboardCheck className="h-3.5 w-3.5" /> {busyId === job.id ? 'Approving…' : 'Approve exact plan'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="rounded-xl border border-white/10 bg-slate-950/50 p-4 text-xs leading-5 text-slate-500">
        <div className="flex items-center gap-2 text-slate-300"><AlertTriangle className="h-4 w-4 text-amber-300" /> Administrative scope is intentionally bounded</div>
        <p className="mt-2">This console does not change user roles, credentials, hosting plans, deployments or secrets. Provider probes can incur usage charges and remain in the Cockpit for a deliberate, separately confirmed action.</p>
        <a href="#/cockpit" className="mt-3 inline-flex text-cyan-200 hover:text-cyan-100">Open Cockpit for brain knowledge and controlled patch tools →</a>
      </footer>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 justify-between gap-3 border-b border-white/5 pb-2"><dt className="text-slate-500">{label}</dt><dd className="max-w-[70%] break-all text-right text-slate-200">{value}</dd></div>;
}
function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/15 bg-slate-950/30 p-5 text-sm text-slate-500">{text}</div>;
}
function UnavailableState({ label, detail }: { label: string; detail: string }) {
  return <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-950/20 p-4">
    <p className="text-sm font-semibold text-rose-200">{label}</p>
    <p className="mt-1 break-words text-xs text-rose-200/70">{detail}</p>
    <p className="mt-2 text-[11px] text-slate-400">The last successful snapshot is retained where available. This is not an empty queue.</p>
  </div>;
}
