import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { useAuth } from '@/hooks/useAuth';
import { canApproveJob, diffFiles, languageFromPath } from './codingStudioUtils';

import {
  Activity,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCode2,
  GitBranch,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
  Users,
  Plug,
  FolderKanban,
  Wrench,
  Download,
} from 'lucide-react';

type Job = {
  id: string;
  userId: string;
  objective: string;
  status: string;
  approvalStatus: string;
  planHash: string;
  baseCommitSha: string;
  proposedDiffHash: string;
  approvedBy?: string | null;
  createdAt: string;
  completedAt?: string | null;
  _count?: { evidence: number; handoffs: number };
};

type JobDetail = {
  job: Job & { planSnapshot?: unknown; handoffs?: Array<{ id: string; fromAgent: string; toAgent: string; status: string }>; evidence?: Array<{ id: string; eventType: string; sequence: number }> };
  evidenceIntegrity: { valid?: boolean; reason?: string };
  verificationChecks: Array<{ name: string; status: string; source: string; runUrl?: string }>;
  acceptance: { accepted?: boolean; status?: string };
};

const AGENTS = ['codex', 'claude', 'copilot', 'cursor', 'gemini', 'opencode', 'muse', 'vibe', 'antigravity'] as const;
type Agent = (typeof AGENTS)[number];


type StudioOverview = {
  generatedAt: string;
  execution?: { adapterId: string; adapterName: string; independentRuntime: boolean; lifecycleOwner: string; authorizationAuthority: string; state: string; note: string };
  nativeCore?: { projectLifecycle: string; scheduler: string; workerRuntime: string; registeredTaskTypes?: string[]; pluginGateway: string; authorizationAuthority: string; productionExecutionEnabled: boolean };
  runtime: {
    state: string;
    queueClaimState?: 'unknown' | 'ready' | 'blocked';
    lastClaimAttemptAt?: string | null;
    lastSuccessfulClaimAt?: string | null;
    lastClaimErrorCode?: string | null;
    lastClaimedTask?: { runId: string; trigger: string; claimedAt: string } | null;
    lastProcessedTask?: { runId: string; trigger: string; startedAt: string; completedAt: string; status: string } | null;
    listener: { state: string; connected: boolean; subscribed: boolean; lastConnectedAt?: string | null; lastErrorCode?: string | null } | null;
  };
  workforce: {
    moduleAgents: Array<{ id: string; moduleId: string; moduleName: string; name: string; responsibility: string; taskTypes: string[]; kpis: string[] }>;
    sharedWorkers: Array<{ id: string; name: string; responsibility: string; taskTypes: string[]; allowedActions: string[] }>;
    dispatchAuthority: string;
    authorizationAuthority: string;
    note: string;
  };
  integrations: {
    providers: Array<{ id: string; displayName: string; version: string; categories: string[]; description: string; capabilities: Array<{ id: string; risk: string; requiresHumanApproval: boolean; executionStatus: string }>; adapterStatus: string; connectionStatus: string; authenticationStatus: string; healthStatus: string; executionStatus: string; usable: boolean; grantedScopes: string[]; connectedAt: string | null; accessTokenExpiresAt: string | null; updatedAt: string | null }>;
    note: string;
  };
  projects: Array<{ id: string; objective: string; queueType?: string | null; status: string; approvalStatus: string; createdAt: string; completedAt?: string | null; error?: string | null; result?: unknown; handoffs: Array<{ id: string; fromAgent: string; toAgent: string; status: string; completedAt?: string | null; error?: string | null }> }>;
  codingTasks: Array<{ id: string; workbenchRunId: string; agent: string; workspaceKey: string; status: string; attempts: number; maxAttempts: number; workerId?: string | null; createdAt: string; updatedAt: string; completedAt?: string | null; error?: string | null; result?: unknown; leaseExpiresAt?: string | null }>;
};

const DEFAULT_PLAN = JSON.stringify({
  objective: 'Implement the approved RyanAI Studio change',
  steps: [
    'Inspect the scoped workspace and existing implementation',
    'Apply the smallest reviewable patch',
    'Run the relevant typecheck, lint and tests',
    'Report changed files and verification evidence',
  ],
  constraints: [
    'No production credentials',
    'No deployment',
    'No autonomous merge',
  ],
}, null, 2);

export default function CodingStudio() {
  const { session } = useAuth();
  const currentUserId = session?.user.id;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [objective, setObjective] = useState('');
  const [baseCommitSha, setBaseCommitSha] = useState('');
  const [workspaceKey, setWorkspaceKey] = useState('ryanai-studio');
  const [agent, setAgent] = useState<Agent>('codex');
  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [proposedDiff, setProposedDiff] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<StudioOverview | null>(null);
  const [projectObjective, setProjectObjective] = useState('');
  const [projectType, setProjectType] = useState<'engineering' | 'research' | 'design' | 'data' | 'automation'>('engineering');
  const [projectDeliverables, setProjectDeliverables] = useState('');
  const [projectAcceptanceCriteria, setProjectAcceptanceCriteria] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState('all');
  const [codingTaskSearch, setCodingTaskSearch] = useState('');
  const [codingTaskStatusFilter, setCodingTaskStatusFilter] = useState('all');
  const [pluginSearch, setPluginSearch] = useState('');
  const [pluginCategoryFilter, setPluginCategoryFilter] = useState('all');
  const [nativeProjects, setNativeProjects] = useState<Array<{ id: string; title: string; objective: string; projectType: string; status: string; createdAt: string; tasks: Array<{ id: string; title: string; taskType: string; status: string; approvalStatus?: string; assignedWorkerId?: string | null; dependsOnIds: string[] }> }>>([]);
  const [nativeProjectTitle, setNativeProjectTitle] = useState('');
  const [nativeProjectObjective, setNativeProjectObjective] = useState('');
  const [nativeProjectType, setNativeProjectType] = useState<'engineering' | 'research' | 'design' | 'data' | 'automation'>('engineering');

  const changedFiles = useMemo(() => diffFiles(proposedDiff), [proposedDiff]);
  const visibleProjects = useMemo(() => (overview?.projects ?? []).filter((project) => {
    const matchesSearch = (project.objective + ' ' + project.id + ' ' + (project.queueType ?? '')).toLowerCase().includes(projectSearch.trim().toLowerCase());
    return matchesSearch && (projectStatusFilter === 'all' || project.status === projectStatusFilter);
  }), [overview?.projects, projectSearch, projectStatusFilter]);
  const visibleCodingTasks = useMemo(() => (overview?.codingTasks ?? []).filter((task) => {
    const matchesSearch = (task.id + ' ' + task.agent + ' ' + task.workspaceKey).toLowerCase().includes(codingTaskSearch.trim().toLowerCase());
    return matchesSearch && (codingTaskStatusFilter === 'all' || task.status === codingTaskStatusFilter);
  }), [overview?.codingTasks, codingTaskSearch, codingTaskStatusFilter]);
  const visiblePlugins = useMemo(() => (overview?.integrations.providers ?? []).filter((provider) => {
    const matchesSearch = (provider.displayName + ' ' + provider.id + ' ' + provider.description + ' ' + provider.capabilities.map((item) => item.id).join(' ')).toLowerCase().includes(pluginSearch.trim().toLowerCase());
    const matchesCategory = pluginCategoryFilter === 'all' || provider.categories.includes(pluginCategoryFilter);
    return matchesSearch && matchesCategory;
  }), [overview?.integrations.providers, pluginSearch, pluginCategoryFilter]);

  const loadJobs = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/engineering/jobs');
      const payload = await response.json() as { jobs?: Job[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding jobs could not be loaded.');
      setJobs(payload.jobs ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding jobs could not be loaded.');
    }
  }, []);

  const loadNativeProjects = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/engineering/studio/native/projects');
      const payload = await response.json() as { projects?: typeof nativeProjects; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Native Studio projects could not be loaded.');
      setNativeProjects(payload.projects ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Native Studio projects could not be loaded.');
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const response = await authenticatedFetch('/api/engineering/studio/overview');
      const payload = await response.json() as StudioOverview & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Studio overview could not be loaded.');
      setOverview(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Studio overview could not be loaded.');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load owner-scoped Studio state on mount
  useEffect(() => { void loadJobs(); void loadOverview(); void loadNativeProjects(); }, [loadJobs, loadOverview, loadNativeProjects]);

  useEffect(() => {
    const hasActiveTasks = (overview?.codingTasks.some((task) => ['queued', 'running', 'cancel_requested'].includes(task.status)) ?? false)
      || (overview?.projects.some((project) => ['queued', 'running'].includes(project.status)) ?? false);
    if (!hasActiveTasks) return;
    const timer = window.setInterval(() => { void loadOverview(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [overview, loadOverview]);

  const createProject = async () => {
    if (!projectObjective.trim() || busy) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await authenticatedFetch('/api/engineering/studio/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objective: projectObjective.trim(),
          projectType,
          deliverables: projectDeliverables.split(/\r?\n/).map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, 20),
          acceptanceCriteria: projectAcceptanceCriteria.split(/\r?\n/).map((item) => item.trim().slice(0, 500)).filter(Boolean).slice(0, 20),
          constraints: ['No production deployment or production database migration', 'No secret changes or paid upgrades', 'No automatic merge; human review required'],
        }),
      });
      const payload = await response.json() as { projectId?: string; taskId?: string; status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Jarvis could not accept this project objective.');
      setStatus(`Studio project ${payload.projectId ?? payload.taskId ?? 'created'} was persisted in the Jarvis queue (${payload.status ?? 'queued'}).`);
      setProjectObjective('');
      setProjectDeliverables('');
      setProjectAcceptanceCriteria('');
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project could not be created.');
    } finally { setBusy(false); }
  };

  const createNativeProject = async () => {
    if (!nativeProjectObjective.trim() || !nativeProjectTitle.trim() || busy) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await authenticatedFetch('/api/engineering/studio/native/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: nativeProjectTitle.trim(), objective: nativeProjectObjective.trim(), projectType: nativeProjectType,
          initialTasks: [{
            title: 'Create project execution plan',
            objective: 'Decompose this project into reviewable specialist tasks, define dependencies and acceptance evidence. Do not execute external side effects.',
            taskType: 'studio.plan', priority: 10, requiredCapabilities: ['planning'],
          }],
        }),
      });
      const payload = await response.json() as { project?: { id: string }; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Native Studio project could not be created.');
      setStatus('Native Studio project ' + (payload.project?.id ?? 'created') + ' persisted. Its Studio planning task is queued. Gen-X requires owner approval before the independent worker can execute it.');
      setNativeProjectTitle('');
      setNativeProjectObjective('');
      await loadNativeProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Native Studio project could not be created.');
    } finally { setBusy(false); }
  };

  const approveNativeTask = async (taskId: string) => {
    if (busy) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      const response = await authenticatedFetch('/api/engineering/studio/native/tasks/' + encodeURIComponent(taskId) + '/approve', { method: 'POST' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Studio task approval was rejected.');
      setStatus('Owner approval recorded for task ' + taskId + '. Gen-X remains authoritative for the final execution decision.');
      await loadNativeProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Studio task approval failed.');
    } finally { setBusy(false); }
  };

  const connectPlugin = async (providerId: string) => {
    if (!['google-calendar', 'microsoft-365-calendar'].includes(providerId)) {
      setError('This provider does not yet have a supported OAuth connection flow in RyanAI.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/plugins/${encodeURIComponent(providerId)}/connect`, { method: 'POST' });
      const payload = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || 'Provider authorization could not be started.');
      const authorizationUrl = new URL(payload.authorizationUrl);
      const allowedHosts = providerId === 'google-calendar' ? ['accounts.google.com'] : ['login.microsoftonline.com'];
      if (authorizationUrl.protocol !== 'https:' || !allowedHosts.includes(authorizationUrl.hostname)) {
        throw new Error('The provider returned an unexpected authorization destination. Redirect was blocked.');
      }
      window.location.assign(authorizationUrl.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider connection could not be started.');
      setBusy(false);
    }
  };

  const refreshPlugin = async (providerId: string) => {
    if (!['google-calendar', 'microsoft-365-calendar'].includes(providerId)) {
      setError('This provider does not yet have a supported token refresh flow in RyanAI.');
      return;
    }
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/plugins/${encodeURIComponent(providerId)}/refresh`, { method: 'POST' });
      const payload = await response.json() as { refreshed?: boolean; error?: string };
      if (!response.ok || !payload.refreshed) throw new Error(payload.error || 'Provider token refresh could not be verified.');
      setStatus(`${providerId} connection refreshed.`);
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Provider token refresh failed.');
      await loadOverview();
    } finally { setBusy(false); }
  };

  const cancelProject = async (projectId: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(projectId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by the authenticated Studio project owner.' }),
      });
      const payload = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Studio project could not be cancelled.');
      setStatus(`Project cancellation: ${payload.status ?? 'requested'}.`);
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Studio project could not be cancelled.');
    } finally { setBusy(false); }
  };

  const prepareCodingWorkbench = (project: StudioOverview['projects'][number]) => {
    setObjective(project.objective);
    setPlan(JSON.stringify({
      objective: project.objective,
      sourceProjectId: project.id,
      steps: [
        'Review the completed Jarvis project analysis and persisted handoffs',
        'Inspect the target repository at the exact base commit',
        'Prepare the smallest reviewable implementation diff',
        'Run relevant typecheck, lint, tests and security checks',
        'Attach exact-head verification evidence and unresolved blockers',
      ],
      constraints: [
        'No production deployment or production database migration',
        'No secret changes or paid upgrades',
        'No automatic merge; human review required',
      ],
    }, null, 2));
    setProposedDiff('');
    setStatus('Project objective loaded into the coding workbench. Confirm the target repository, exact base commit SHA and proposed diff; approval remains a separate human-controlled step.');
    document.getElementById('studio-coding-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const downloadProjectEvidence = async (projectId: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(projectId)}/evidence-bundle`);
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || 'Project evidence bundle could not be downloaded.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `ryanai-studio-evidence-${projectId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus('Project evidence bundle downloaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project evidence bundle could not be downloaded.');
    } finally { setBusy(false); }
  };

  const cancelCodingTask = async (taskId: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/engineering/coding-tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
      const payload = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding task could not be cancelled.');
      setStatus(`Coding task cancellation: ${payload.status ?? 'requested'}.`);
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding task could not be cancelled.');
    } finally { setBusy(false); }
  };

  const loadJob = async (jobId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(jobId)}`);
      const payload = await response.json() as JobDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding job could not be loaded.');
      setSelectedJob(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding job could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  const submitJob = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (!objective.trim() || !baseCommitSha.trim() || !proposedDiff.trim()) {
        throw new Error('Objective, exact base commit SHA and proposed diff are required.');
      }
      const parsedPlan = JSON.parse(plan);
      const response = await authenticatedFetch('/api/engineering/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objective: objective.trim(),
          plan: parsedPlan,
          baseCommitSha: baseCommitSha.trim(),
          proposedDiff,
        }),
      });
      const payload = await response.json() as { jobId?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding plan could not be persisted.');
      setStatus(payload.message || 'Plan persisted. Review the exact snapshot and approve it from your workspace when ready.');
      setObjective('');
      setProposedDiff('');
      await loadJobs();
      await loadOverview();
      if (payload.jobId) await loadJob(payload.jobId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding plan could not be persisted.');
    } finally {
      setBusy(false);
    }
  };

  const approveJob = async () => {
    if (!selectedJob) return;
    setBusy(true);
    setError(null);
    try {
      const { job } = selectedJob;
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(job.id)}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planHash: job.planHash,
          baseCommitSha: job.baseCommitSha,
          proposedDiffHash: job.proposedDiffHash,
        }),
      });
      const payload = await response.json() as { error?: string; approvalStatus?: string };
      if (!response.ok) throw new Error(payload.error || 'Approval was not applied.');
      setStatus(`Plan approved: ${payload.approvalStatus || 'approved'}.`);
      await loadJob(job.id);
      await loadJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval was not applied.');
    } finally {
      setBusy(false);
    }
  };

  const enqueueTask = async () => {
    if (!selectedJob || !taskPrompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const job = selectedJob.job;
      const response = await authenticatedFetch(`/api/engineering/jobs/${encodeURIComponent(job.id)}/coding-tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent,
          prompt: taskPrompt.trim(),
          workspaceKey,
          maxAttempts: 3,
        }),
      });
      const payload = await response.json() as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Coding task could not be queued.');
      setStatus(`Coding task ${payload.taskId ?? 'queued'} is persisted in the coding queue.`);
      setTaskPrompt('');
      await loadJob(job.id);
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coding task could not be queued.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto flex h-full min-h-[720px] max-w-[1800px] flex-col bg-[#0D0E15] text-[#F8FAFC]">
      <header className="flex flex-wrap items-center gap-3 border-b border-cyan-300/10 bg-[#0a0d14] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Code2 className="h-5 w-5" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">RyanAI Studio</p>
            <h1 className="text-lg font-semibold text-white">Engineering Workbench</h1>
          </div>
        </div>
        <span className="ml-auto rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400">Evidence-first · no autonomous merge</span>
        <button type="button" onClick={() => void loadJobs()} disabled={busy} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5 disabled:opacity-50" aria-label="Refresh coding jobs"><RefreshCw className="h-4 w-4" /></button>
      </header>

      {(error || status) && (
        <div className="border-b border-white/10 px-5 py-3">
          {error ? <div role="alert" className="flex items-start gap-2 text-sm text-rose-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : <div role="status" className="flex items-start gap-2 text-sm text-emerald-200"><Check className="mt-0.5 h-4 w-4 shrink-0" />{status}</div>}
        </div>
      )}


      {overview?.nativeCore && (
        <section className="border-b border-white/10 bg-[#0d1420] px-5 py-3" aria-label="Studio native core status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">Studio Native Core</p>
              <p className="mt-1 text-[11px] text-slate-400">Project lifecycle: {overview.nativeCore.projectLifecycle} · Scheduler: {overview.nativeCore.scheduler}</p>
              <p className="mt-1 text-[11px] text-slate-500">Worker runtime: {overview.nativeCore.workerRuntime} · Plugin gateway: {overview.nativeCore.pluginGateway}</p>
              <p className="mt-1 text-[11px] text-slate-500">Authorization authority: {overview.nativeCore.authorizationAuthority}</p>
            </div>
            <span className="rounded-full border border-amber-300/30 px-2 py-1 text-[9px] uppercase tracking-wider text-amber-200">
              {overview.nativeCore.productionExecutionEnabled ? 'Execution enabled' : 'Execution not enabled'}
            </span>
          </div>
        </section>
      )}

      {overview?.execution && (
        <section className="border-b border-white/10 bg-[#101522] px-5 py-3" aria-label="Studio execution architecture">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Activity className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-white">Studio execution control plane</p>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${overview.execution.independentRuntime ? 'border-emerald-300/30 text-emerald-200' : 'border-amber-300/30 text-amber-200'}`}>
                  {overview.execution.independentRuntime ? 'Independent runtime' : 'Jarvis-backed adapter'}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{overview.execution.adapterName} · Lifecycle owner: {overview.execution.lifecycleOwner} · Authorization: {overview.execution.authorizationAuthority}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{overview.execution.note}</p>
            </div>
          </div>
        </section>
      )}

      <section className="border-b border-cyan-300/10 bg-[#0d111b] px-5 py-4" aria-label="Browser coding environment">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Browser IDE integration</p><h2 className="mt-1 text-sm font-semibold text-white">VS Code for the Web · RyanAI repository</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Open the official repository in vscode.dev to browse and edit from your phone. GitHub handles sign-in and repository permissions; return to RyanAI Studio for governed plans, approvals and verification.</p></div>
          <a href="https://vscode.dev/github/RyanAI-Automated/RYANAI-Automous-Reasioning-Plat" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300"><Code2 className="h-4 w-4" />Open in VS Code Web</a>
        </div>
        <p className="mt-2 text-[10px] leading-5 text-amber-200/80">Browser-editor boundary: vscode.dev does not provide a terminal or full build/debug runtime. Use RyanAI's separately approved coding-worker queue for execution; changes still require exact-head checks and human review. No auto-merge or deployment.</p>
      </section>

      <section className="border-b border-cyan-300/10 bg-[#0b101a] px-5 py-5" aria-label="Studio project, workforce and integrations">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Engineering command workspace</p><h2 className="mt-1 text-base font-semibold text-white">Projects · workforce · integrations</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Studio uses Jarvis for project orchestration, the registered RyanAI workforce for specialist ownership, Gen-X for authorization, and the canonical plugin registry for integration capability.</p></div>
          <button type="button" onClick={() => { void loadOverview(); void loadJobs(); }} disabled={busy || overviewLoading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Refresh overview</button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label="Studio native project foundry">
          <form className="rounded-xl border border-emerald-300/15 bg-slate-950/50 p-4" onSubmit={(event) => { event.preventDefault(); void createNativeProject(); }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><FolderKanban className="h-4 w-4 text-emerald-300" />Native Project Foundry</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">Create a Studio-owned project and durable task graph without sending the project through Jarvis. Worker execution remains disabled until a governed native worker is configured.</p>
            <label className="mt-3 block text-[10px] text-slate-500">Project name
              <input value={nativeProjectTitle} onChange={(event) => setNativeProjectTitle(event.target.value)} maxLength={200} placeholder="e.g. RyanAI Research Workspace" className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070a10] p-2.5 text-xs text-slate-200 outline-none focus:border-emerald-300/40" />
            </label>
            <label className="mt-2 block text-[10px] text-slate-500">Project type
              <select value={nativeProjectType} onChange={(event) => setNativeProjectType(event.target.value as typeof nativeProjectType)} className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070a10] p-2.5 text-xs text-slate-200">
                <option value="engineering">Software engineering</option><option value="research">Research</option><option value="design">Product and UX design</option><option value="data">Data and analytics</option><option value="automation">Automation</option>
              </select>
            </label>
            <label className="mt-2 block text-[10px] text-slate-500">Objective
              <textarea value={nativeProjectObjective} onChange={(event) => setNativeProjectObjective(event.target.value)} maxLength={12000} placeholder="Describe the project goal, context and intended outcome…" className="mt-1 block min-h-20 w-full rounded-lg border border-white/10 bg-[#070a10] p-2.5 text-xs text-slate-200 outline-none focus:border-emerald-300/40" />
            </label>
            <button type="submit" disabled={busy || nativeProjectTitle.trim().length < 2 || nativeProjectObjective.trim().length < 5} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-2.5 text-xs font-semibold text-emerald-100 disabled:opacity-50"><Play className="h-3.5 w-3.5" />Create native project</button>
          </form>
          <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-white">Studio-owned projects</p><button type="button" onClick={() => { void loadNativeProjects(); }} className="text-[10px] text-cyan-200">Refresh</button></div>
            <div className="mt-3 space-y-2">
              {nativeProjects.slice(0, 5).map((project) => <div key={project.id} className="rounded-lg border border-white/5 bg-[#080b12] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-slate-200">{project.title}</p><span className="text-[9px] uppercase text-emerald-200">{project.status}</span></div>
                <p className="mt-1 text-[10px] text-slate-500">{project.projectType} · {project.tasks.length} task(s)</p>
                <div className="mt-2 space-y-1">{project.tasks.slice(0, 3).map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-slate-400">{task.title} · {task.status} · {task.assignedWorkerId ?? 'unassigned'}</p>{task.status === 'blocked' && task.approvalStatus !== 'approved' && <button type="button" onClick={() => void approveNativeTask(task.id)} disabled={busy} className="rounded border border-amber-300/30 px-2 py-1 text-[9px] text-amber-200 disabled:opacity-50">Approve task</button>}</div>)}</div>
                <p className="mt-1 font-mono text-[9px] text-slate-600">{project.id}</p>
              </div>)}
              {nativeProjects.length === 0 && <p className="text-xs text-slate-500">No Studio-native projects yet.</p>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <form className="rounded-xl border border-cyan-300/15 bg-slate-950/50 p-4" onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><FolderKanban className="h-4 w-4 text-cyan-300" />Start an engineering or research project</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">Submit the objective to the existing Jarvis task orchestrator. It is a durable task request, not a claim that work has completed.</p>
            <label className="mt-3 block text-[10px] text-slate-500">Project type
              <select value={projectType} onChange={(event) => setProjectType(event.target.value as typeof projectType)} className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070a10] px-3 py-2.5 text-xs text-slate-200">
                <option value="engineering">Software engineering</option>
                <option value="research">Research and investigation</option>
                <option value="design">Product and UX design</option>
                <option value="data">Data and analytics</option>
                <option value="automation">Automation and workflows</option>
              </select>
            </label>
            <textarea value={projectObjective} onChange={(event) => setProjectObjective(event.target.value)} maxLength={12000} placeholder="Describe the project objective and context…" className="mt-3 min-h-24 w-full rounded-lg border border-white/10 bg-[#070a10] p-3 text-xs text-slate-200 outline-none focus:border-cyan-300/40" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block text-[10px] text-slate-500">Expected deliverables (one per line)
                <textarea value={projectDeliverables} onChange={(event) => setProjectDeliverables(event.target.value)} rows={3} maxLength={5000} placeholder="Implementation\nTechnical documentation\nTests and evidence" className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070a10] p-2.5 text-xs text-slate-200 outline-none focus:border-cyan-300/40" />
              </label>
              <label className="block text-[10px] text-slate-500">Acceptance criteria (one per line)
                <textarea value={projectAcceptanceCriteria} onChange={(event) => setProjectAcceptanceCriteria(event.target.value)} rows={3} maxLength={5000} placeholder="Build passes\nTests pass\nNo policy violations" className="mt-1 block w-full rounded-lg border border-white/10 bg-[#070a10] p-2.5 text-xs text-slate-200 outline-none focus:border-cyan-300/40" />
              </label>
            </div>
            <button type="submit" disabled={busy || projectObjective.trim().length < 5} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-50"><Play className="h-3.5 w-3.5" />Submit to Jarvis</button>
          </form>
          <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Users className="h-4 w-4 text-cyan-300" />RyanAI workforce</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Module agents" value={String(overview?.workforce.moduleAgents.length ?? 12)} />
              <Stat label="Shared specialists" value={String(overview?.workforce.sharedWorkers.length ?? 10)} />
              <Stat label="Orchestrator" value={overview?.workforce.dispatchAuthority ?? 'Jarvis'} />
              <Stat label="Policy authority" value={overview?.workforce.authorizationAuthority ?? 'Gen-X'} />
              <Stat label="Jarvis runtime" value={overview?.runtime.state ?? 'checking'} />
              <Stat label="Active projects" value={String(overview?.projects.filter((project) => ['queued', 'running'].includes(project.status)).length ?? 0)} />
              <Stat label="Active coding tasks" value={String(overview?.codingTasks.filter((task) => ['queued', 'running', 'cancel_requested'].includes(task.status)).length ?? 0)} />
              <Stat label="Executable plugins" value={String(overview?.integrations.providers.filter((provider) => provider.usable).length ?? 0)} />
            </div>
            <p className="mt-3 text-[10px] leading-5 text-amber-200/80">{overview?.workforce.note ?? 'Roster entries describe registered responsibilities, not live worker availability.'}</p>
            <p className="mt-1 text-[10px] text-slate-500">Queue listener: {overview?.runtime.listener?.connected && overview.runtime.listener.subscribed ? 'connected and subscribed' : overview?.runtime.listener?.state ?? 'unverified'}</p>
            <p className="mt-1 text-[10px] text-slate-500">Queue claim: {overview?.runtime.queueClaimState ?? 'unknown'}{overview?.runtime.lastClaimErrorCode ? ` · ${overview.runtime.lastClaimErrorCode}` : ''}</p>
            {overview?.runtime.lastSuccessfulClaimAt && <p className="mt-1 text-[9px] text-slate-600">Last successful DB claim: {new Date(overview.runtime.lastSuccessfulClaimAt).toLocaleString()}</p>}
            {overview?.runtime.lastClaimedTask && <p className="mt-1 break-all text-[9px] text-slate-500">Last claimed: {overview.runtime.lastClaimedTask.runId} · {overview.runtime.lastClaimedTask.trigger}</p>}
            {overview?.runtime.lastProcessedTask && <p className="mt-1 break-all text-[9px] text-slate-500">Last processed: {overview.runtime.lastProcessedTask.runId} · {overview.runtime.lastProcessedTask.status} · {new Date(overview.runtime.lastProcessedTask.completedAt).toLocaleString()}</p>}
            {overview?.runtime.listener?.lastErrorCode && <p className="mt-1 text-[9px] text-rose-300">Listener diagnostic: {overview.runtime.listener.lastErrorCode}</p>}
            {overview?.runtime.listener?.lastConnectedAt && <p className="mt-1 text-[9px] text-slate-600">Last connected: {new Date(overview.runtime.listener.lastConnectedAt).toLocaleString()}</p>}
            <details className="mt-3 rounded-lg border border-white/5 bg-[#080b12] p-2">
              <summary className="cursor-pointer text-[10px] font-semibold text-cyan-200">View 12 module agents</summary>
              <div className="mt-2 space-y-2">{(overview?.workforce.moduleAgents ?? []).map((item) => <div key={item.id} className="border-t border-white/5 pt-2"><p className="text-[10px] font-medium text-slate-200">{item.name} · {item.moduleName}</p><p className="mt-1 text-[9px] leading-4 text-slate-500">{item.responsibility}</p><p className="mt-1 text-[9px] text-slate-600">Tasks: {item.taskTypes.join(' · ')}</p></div>)}</div>
            </details>
            <details className="mt-2 rounded-lg border border-white/5 bg-[#080b12] p-2">
              <summary className="cursor-pointer text-[10px] font-semibold text-cyan-200">View shared specialist workforce</summary>
              <div className="mt-2 space-y-2">{(overview?.workforce.sharedWorkers ?? []).map((item) => <div key={item.id} className="border-t border-white/5 pt-2"><p className="text-[10px] font-medium text-slate-200">{item.name}</p><p className="mt-1 text-[9px] leading-4 text-slate-500">{item.responsibility}</p><p className="mt-1 text-[9px] text-slate-600">Tasks: {item.taskTypes.join(' · ')}</p></div>)}</div>
            </details>
          </div>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <section className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Plug className="h-4 w-4 text-cyan-300" />Plugin and tool compatibility</div>
            <p className="mt-1 text-[10px] leading-5 text-slate-500">{overview?.integrations.note ?? 'Loading canonical plugin registry and owner connection state…'}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <input value={pluginSearch} onChange={(event) => setPluginSearch(event.target.value)} placeholder="Search providers and capabilities…" className="min-w-0 rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-[10px] text-slate-200 outline-none focus:border-cyan-300/40" />
              <select value={pluginCategoryFilter} onChange={(event) => setPluginCategoryFilter(event.target.value)} className="rounded-lg border border-white/10 bg-[#080b12] px-2 py-2 text-[10px] text-slate-200"><option value="all">All categories</option><option value="engineering">Engineering</option><option value="research">Research</option><option value="workflows">Workflows</option><option value="pa_agent">Personal assistant</option><option value="communications">Communications</option><option value="knowledge">Knowledge</option></select>
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-auto">
              {visiblePlugins.map((provider) => <div key={provider.id} className="rounded-lg border border-white/5 bg-[#080b12] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-slate-200">{provider.displayName}</span><span title={`Authentication: ${provider.authenticationStatus} · Health: ${provider.healthStatus} · Execution: ${provider.executionStatus}`} className={`rounded-full border px-2 py-1 text-[9px] ${provider.usable ? 'border-emerald-300/20 text-emerald-200' : 'border-amber-300/20 text-amber-200'}`}>{provider.usable ? 'Verified · ready' : provider.connectionStatus === 'revoked' ? 'Revoked' : provider.connectionStatus === 'revocation_pending' ? 'Revocation pending' : provider.connectionStatus === 'pending' ? 'Authorization pending' : provider.connectionStatus === 'reauthorization_required' ? 'Reauthorization required' : provider.connectionStatus === 'refresh_required' ? 'Token expired · refresh required' : provider.connectionStatus === 'expiry_unknown' ? 'Token expiry unknown · reconnect' : provider.connectionStatus === 'connected' && provider.executionStatus === 'blocked_adapter_missing' ? 'OAuth grant · adapter missing' : provider.executionStatus === 'blocked_health_unverified' ? 'Connected · health unverified' : provider.connectionStatus === 'error' ? 'Connection error' : provider.adapterStatus === 'adapter_registered' ? 'Adapter ready · connect account' : 'Adapter required'}</span></div>
                <p className="mt-1 text-[10px] text-slate-500">{provider.description}</p>
                <p className="mt-1 text-[9px] text-slate-600">v{provider.version} · {provider.categories.join(' · ')}</p>
                <div className="mt-2 flex flex-wrap gap-1">{provider.capabilities.map((capability) => <span key={capability.id} title={capability.requiresHumanApproval ? 'Requires human approval before execution' : 'No additional human approval declared by this manifest'} className="rounded border border-white/5 bg-black/20 px-1.5 py-1 text-[9px] text-slate-500">{capability.id} · {capability.risk}{capability.requiresHumanApproval ? ' · approval' : ''} · {capability.executionStatus}</span>)}</div>
                {provider.grantedScopes.length > 0 && <p className="mt-1 text-[9px] text-slate-600">Granted scopes: {provider.grantedScopes.join(' · ')}</p>}
                {['google-calendar', 'microsoft-365-calendar'].includes(provider.id) && provider.connectionStatus === 'refresh_required' && <button type="button" onClick={() => void refreshPlugin(provider.id)} disabled={busy} className="mt-2 rounded-md border border-emerald-300/20 px-2 py-1 text-[10px] text-emerald-200 disabled:opacity-50">Refresh connection</button>}
                {['google-calendar', 'microsoft-365-calendar'].includes(provider.id) && ['not_connected', 'reauthorization_required', 'revoked', 'expiry_unknown'].includes(provider.connectionStatus) && <button type="button" onClick={() => void connectPlugin(provider.id)} disabled={busy} className="mt-2 rounded-md border border-cyan-300/20 px-2 py-1 text-[10px] text-cyan-200 disabled:opacity-50">Connect account</button>}
              </div>)}
              {overview && overview.integrations.providers.length === 0 && <p className="text-xs text-slate-500">No plugin manifests are registered.</p>}
              {overview && overview.integrations.providers.length > 0 && visiblePlugins.length === 0 && <p className="text-xs text-slate-500">No providers match these filters.</p>}
            </div>
          </section>
          <section className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Wrench className="h-4 w-4 text-cyan-300" />Coding worker queue</div>
            <p className="mt-1 text-[10px] text-slate-500">Live persisted task records for your account. A registered agent is not presented as a running worker.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <input value={codingTaskSearch} onChange={(event) => setCodingTaskSearch(event.target.value)} placeholder="Search task, agent or workspace…" className="min-w-0 rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-[10px] text-slate-200 outline-none focus:border-cyan-300/40" />
              <select value={codingTaskStatusFilter} onChange={(event) => setCodingTaskStatusFilter(event.target.value)} className="rounded-lg border border-white/10 bg-[#080b12] px-2 py-2 text-[10px] text-slate-200"><option value="all">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="cancel_requested">Cancel requested</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select>
            </div>
            <div className="mt-3 max-h-72 space-y-2 overflow-auto">
              {visibleCodingTasks.map((task) => <div key={task.id} className="rounded-lg border border-white/5 bg-[#080b12] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] text-slate-300">{task.id.slice(0, 12)}</span><span className="text-[9px] uppercase text-cyan-200">{task.status}</span></div>
                <p className="mt-1 text-[10px] text-slate-500">{task.agent} · {task.workspaceKey} · attempt {task.attempts}/{task.maxAttempts}</p>
                <p className="mt-1 text-[9px] text-slate-600">Updated {new Date(task.updatedAt).toLocaleString()}{task.leaseExpiresAt ? ' · lease expires ' + new Date(task.leaseExpiresAt).toLocaleString() : ''}</p>
                <p className="mt-1 text-[9px] text-slate-600">{task.workerId ? `Worker ${task.workerId}` : 'No worker currently assigned'}</p>
                {task.error && <p className="mt-1 text-[10px] text-rose-200">{task.error}</p>}
                {task.result !== null && task.result !== undefined && <details className="mt-2"><summary className="cursor-pointer text-[10px] text-cyan-200">View execution result</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[9px] text-slate-400">{JSON.stringify(task.result, null, 2)}</pre></details>}
                {['queued','running','cancel_requested'].includes(task.status) && <button type="button" onClick={() => void cancelCodingTask(task.id)} disabled={busy} className="mt-2 rounded-md border border-rose-300/20 px-2 py-1 text-[10px] text-rose-200 disabled:opacity-50">Cancel task</button>}
              </div>)}
              {overview && overview.codingTasks.length === 0 && <p className="text-xs text-slate-500">No coding tasks have been queued yet.</p>}
              {overview && overview.codingTasks.length > 0 && visibleCodingTasks.length === 0 && <p className="text-xs text-slate-500">No coding tasks match these filters.</p>}
            </div>
          </section>
        </div>
        <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><FolderKanban className="h-4 w-4 text-cyan-300" />Engineering plans and project runs</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
            <input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Search projects, objectives or IDs…" className="min-w-0 rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-[10px] text-slate-200 outline-none focus:border-cyan-300/40" />
            <select value={projectStatusFilter} onChange={(event) => setProjectStatusFilter(event.target.value)} className="rounded-lg border border-white/10 bg-[#080b12] px-2 py-2 text-[10px] text-slate-200"><option value="all">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {visibleProjects.map((project) => <div key={project.id} className="rounded-lg border border-white/5 bg-[#080b12] p-3">
              <p className="text-xs font-medium text-slate-200">{project.objective}</p>
              <p className="mt-1 text-[10px] text-slate-500">{project.queueType ?? 'Jarvis task'} · {project.status} · approval {project.approvalStatus}</p>
              <p className="mt-1 text-[9px] text-slate-600">Created {new Date(project.createdAt).toLocaleString()}{project.completedAt ? ' · completed ' + new Date(project.completedAt).toLocaleString() : ''}</p>
              <p className="mt-1 font-mono text-[9px] text-slate-600">{project.id}</p>
              <button type="button" onClick={() => void downloadProjectEvidence(project.id)} disabled={busy} className="mt-2 inline-flex items-center gap-1 rounded-md border border-cyan-300/20 px-2 py-1 text-[10px] text-cyan-200 disabled:opacity-50"><Download className="h-3 w-3" />Download evidence</button>
              <button type="button" onClick={() => prepareCodingWorkbench(project)} disabled={busy} className="ml-2 mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300 disabled:opacity-50"><Code2 className="h-3 w-3" />Prepare coding job</button>
              {['queued','running'].includes(project.status) && <button type="button" onClick={() => void cancelProject(project.id)} disabled={busy} className="mt-2 rounded-md border border-rose-300/20 px-2 py-1 text-[10px] text-rose-200 disabled:opacity-50">Cancel project</button>}
              {project.error && <p className="mt-1 text-[10px] text-rose-200">{project.error}</p>}
              {project.handoffs.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{project.handoffs.map((handoff) => <span key={handoff.id} className="rounded border border-white/5 px-1.5 py-1 text-[9px] text-slate-500">{handoff.fromAgent} → {handoff.toAgent}: {handoff.status}</span>)}</div>}
              {project.result !== null && project.result !== undefined && <details className="mt-2"><summary className="cursor-pointer text-[10px] text-cyan-200">View project result</summary><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[9px] text-slate-400">{JSON.stringify(project.result, null, 2)}</pre></details>}
            </div>)}
            {overview && overview.projects.length > 0 && visibleProjects.length === 0 && <p className="text-xs text-slate-500">No projects match these filters.</p>}
            {overview && overview.projects.length === 0 && <p className="text-xs text-slate-500">No engineering plans have been created yet.</p>}
          </div>
          <p className="mt-2 text-[9px] text-slate-600">Last refreshed: {overview?.generatedAt ? new Date(overview.generatedAt).toLocaleString() : 'not yet verified'}</p>
        </section>
      </section>

      <div id="studio-coding-workbench" className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside className="min-h-0 border-b border-white/10 bg-[#0a0d14] lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-300"><GitBranch className="h-3.5 w-3.5 text-cyan-300" />{workspaceKey}</div>
          </div>
          <div className="max-h-[420px] overflow-auto p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Patch files</p>
            {changedFiles.length ? changedFiles.map((file) => (
              <div key={file} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-300">
                <FileCode2 className="h-3.5 w-3.5 text-cyan-300" />
                <span className="min-w-0 flex-1 truncate">{file}</span>
                <span className="text-[9px] text-slate-600">{languageFromPath(file)}</span>
              </div>
            )) : <p className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-600">Add a unified diff to populate the scoped file tree. The Studio does not invent repository files.</p>}
          </div>
          <div className="border-t border-white/10 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Recent plans</p>
            <div className="space-y-1">
              {jobs.slice(0, 12).map((job) => (
                <button key={job.id} type="button" onClick={() => void loadJob(job.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs text-slate-300">{job.objective}</span><span className="mt-0.5 block text-[9px] uppercase tracking-wider text-slate-600">{job.status} · {job.approvalStatus}</span></span>
                  <ChevronRight className="mt-0.5 h-3 w-3 text-slate-700" />
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto">
          <div className="border-b border-white/10 bg-[#0d111b] px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">Patch Editor</span>
              <span className="text-[10px] text-slate-600">Unified diff · secret scanning · exact base commit binding</span>
            </div>
          </div>
          <div className="grid gap-4 p-5 xl:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Objective</span>
              <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="What should RyanAI change?" className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Exact base commit SHA</span>
              <input value={baseCommitSha} onChange={(event) => setBaseCommitSha(event.target.value)} placeholder="40-character Git commit SHA" spellCheck={false} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Workspace key</span>
              <input value={workspaceKey} onChange={(event) => setWorkspaceKey(event.target.value)} spellCheck={false} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300/40" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Coding agent</span>
              <select value={agent} onChange={(event) => setAgent(event.target.value as Agent)} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/40">
                {AGENTS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="px-5 pb-5">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Proposed unified diff</span>
              <textarea value={proposedDiff} onChange={(event) => setProposedDiff(event.target.value)} spellCheck={false} placeholder={'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@\n+...'} className="min-h-[360px] w-full resize-y rounded-xl border border-white/10 bg-[#070a10] p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus:border-cyan-300/40" />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void submitJob()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Save plan for your review and approval</button>
              <span className="text-[10px] text-slate-600">{changedFiles.length} changed file{changedFiles.length === 1 ? '' : 's'} detected from the diff</span>
            </div>
          </div>
          <div className="border-t border-white/10 p-5">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Plan JSON</span>
              <textarea value={plan} onChange={(event) => setPlan(event.target.value)} spellCheck={false} className="min-h-[220px] w-full resize-y rounded-xl border border-white/10 bg-[#070a10] p-4 font-mono text-xs leading-6 text-slate-300 outline-none focus:border-cyan-300/40" />
            </label>
          </div>
        </main>

        <aside className="min-h-0 overflow-auto border-t border-white/10 bg-[#0a0d14] lg:border-l lg:border-t-0">
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Evidence & execution</p>
            <p className="mt-1 text-xs text-slate-600">Every task stays bound to an approved plan, commit and diff.</p>
          </div>
          {!selectedJob ? (
            <div className="p-5">
              <div className="rounded-xl border border-dashed border-white/10 p-5 text-center">
                <Terminal className="mx-auto h-6 w-6 text-slate-600" />
                <p className="mt-3 text-sm text-slate-400">Select a plan to inspect evidence and execution controls.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-4">
              <section>
                <p className="text-[10px] uppercase tracking-wider text-slate-600">Selected plan</p>
                <h2 className="mt-1 text-sm font-semibold text-white">{selectedJob.job.objective}</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <Stat label="Status" value={selectedJob.job.status} />
                  <Stat label="Approval" value={selectedJob.job.approvalStatus} />
                  <Stat label="Evidence" value={String(selectedJob.job._count?.evidence ?? selectedJob.job.evidence?.length ?? 0)} />
                  <Stat label="Handoffs" value={String(selectedJob.job._count?.handoffs ?? selectedJob.job.handoffs?.length ?? 0)} />
                </div>
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Verification</p>
                <div className="space-y-2">
                  {selectedJob.verificationChecks.map((check) => <div key={check.name} className="rounded-lg border border-white/10 bg-slate-950/50 p-2.5"><div className="flex items-center gap-2 text-xs text-slate-300"><CheckState status={check.status} />{check.name}</div><p className="mt-1 text-[9px] text-slate-600">{check.source}</p></div>)}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">Evidence chain: {selectedJob.evidenceIntegrity?.valid === true ? 'valid' : 'unverified'}</p>
              </section>

              {selectedJob.job.approvalStatus === 'pending' && canApproveJob(selectedJob.job.userId, currentUserId) && <button type="button" onClick={() => void approveJob()} disabled={busy} className="w-full rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-3 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-50"><ShieldCheck className="mr-2 inline h-4 w-4" />Approve exact plan</button>}
              {selectedJob.job.approvalStatus === 'pending' && !canApproveJob(selectedJob.job.userId, currentUserId) && <p role="note" className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-3 text-[11px] leading-5 text-amber-100/80">Only the authenticated owner of this workspace can approve this exact plan.</p>}

              {selectedJob.job.approvalStatus === 'approved' && (
                <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-cyan-300">Queue coding execution</p>
                  <textarea value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="Instructions for the approved coding worker…" className="mt-2 min-h-28 w-full rounded-lg border border-white/10 bg-slate-950 p-3 text-xs text-slate-200 outline-none focus:border-cyan-300/40" />
                  <button type="button" onClick={() => void enqueueTask()} disabled={busy || !taskPrompt.trim()} className="mt-2 w-full rounded-lg bg-cyan-400 px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"><Play className="mr-2 inline h-4 w-4" />Queue approved task</button>
                </section>
              )}

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Bindings</p>
                <Binding label="Plan" value={selectedJob.job.planHash} />
                <Binding label="Base" value={selectedJob.job.baseCommitSha} />
                <Binding label="Diff" value={selectedJob.job.proposedDiffHash} />
              </section>

              <section>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-600">Handoffs</p>
                <div className="space-y-1.5">
                  {(selectedJob.job.handoffs ?? []).map((handoff) => <div key={handoff.id} className="flex items-center gap-2 rounded-lg bg-slate-950/50 px-2.5 py-2 text-[10px] text-slate-400"><span>{handoff.fromAgent}</span><ChevronRight className="h-3 w-3 text-slate-700" /><span>{handoff.toAgent}</span><span className="ml-auto uppercase text-slate-600">{handoff.status}</span></div>)}
                </div>
              </section>

              <button type="button" onClick={() => setSelectedJob(null)} className="w-full rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5"><X className="mr-2 inline h-3.5 w-3.5" />Close evidence</button>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-950/60 p-2"><div className="text-[9px] uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 truncate text-xs text-slate-300">{value}</div></div>;
}

function Binding({ label, value }: { label: string; value: string }) {
  return <div className="mb-1.5 rounded-lg border border-white/5 bg-slate-950/50 p-2"><div className="text-[9px] uppercase text-slate-600">{label}</div><code className="mt-1 block break-all text-[9px] text-slate-400">{value}</code></div>;
}

function CheckState({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === 'pass' || normalized === 'passed' || normalized === 'approved') return <Check className="h-3.5 w-3.5 text-emerald-300" />;
  if (normalized === 'fail' || normalized === 'failed') return <CircleAlert className="h-3.5 w-3.5 text-rose-300" />;
  return <Activity className="h-3.5 w-3.5 text-amber-300" />;
}
