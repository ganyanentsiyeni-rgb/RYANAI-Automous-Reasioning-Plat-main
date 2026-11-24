import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRightLeft, CheckCircle2, Clock3, LoaderCircle, RefreshCw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type Capability = 'repository.inspect' | 'diagnostics.run' | 'patch.propose' | 'evidence.record' | 'comms.task.create';
type Handoff = { fromAgent: string; toAgent: string; status: string; output?: string | null; error?: string | null };
type Delegation = {
  id: string;
  objective: string;
  status: string;
  requestedCapabilities: string[];
  createdAt: string;
  receipt?: { status: string; result?: unknown; error?: string | null } | null;
  agentRun?: {
    id: string;
    status: string;
    approvalStatus: string;
    attempts: number;
    result?: unknown;
    error?: string | null;
    completedAt?: string | null;
    handoffs?: Handoff[];
  } | null;
};

const CAPABILITIES: Array<{ id: Capability; label: string }> = [
  { id: 'repository.inspect', label: 'Analyze repository context you supply' },
  { id: 'diagnostics.run', label: 'Analyze diagnostics you supply' },
  { id: 'patch.propose', label: 'Draft a reviewable patch recommendation' },
  { id: 'evidence.record', label: 'Include evidence in the result' },
  { id: 'comms.task.create', label: 'Create an internal Comms task' },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `PA handoff failed (HTTP ${response.status}).`);
  return payload as T;
}

function resultText(delegation: Delegation): string | null {
  const result = delegation.agentRun?.result as { synthesis?: string; verification?: { verified?: boolean; reason?: string | null } } | null | undefined;
  if (result && typeof result.synthesis === 'string') return result.synthesis;
  const receipt = delegation.receipt?.result as { synthesis?: string; verification?: { verified?: boolean; reason?: string | null } } | null | undefined;
  return receipt && typeof receipt.synthesis === 'string' ? receipt.synthesis : null;
}

function displayStatus(delegation: Delegation): string {
  const runStatus = delegation.agentRun?.status;
  if (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled') return runStatus;
  if (delegation.agentRun?.approvalStatus === 'pending') return 'pending approval';
  return delegation.status.replaceAll('_', ' ');
}

export default function PADelegationPanel({ mode = 'copilot' }: { mode?: 'copilot' | 'pa' | 'shared' }) {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [objective, setObjective] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>(['repository.inspect', 'diagnostics.run']);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const createRequestRef = useRef<{ fingerprint: string; delegationId: string } | null>(null);
  const canCreate = mode === 'copilot' || mode === 'shared';
  const canApprove = mode === 'pa' || mode === 'shared';

  const refresh = useCallback(async () => {
    try {
      const payload = await api<{ delegations?: Delegation[] }>('/api/agent/ops/pa/delegations');
      setDelegations(Array.isArray(payload.delegations) ? payload.delegations : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Alex handoff history is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => { if (active && document.visibilityState === 'visible') await refresh(); };
    void load();
    const timer = window.setInterval(() => { void load(); }, 15000);
    const onFocus = () => { void load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const submit = async () => {
    setBusy('create');
    setNotice('');
    setError('');
    try {
      const fingerprint = JSON.stringify({ objective: objective.trim(), capabilities: [...capabilities].sort() });
      if (!createRequestRef.current || createRequestRef.current.fingerprint !== fingerprint) {
        createRequestRef.current = { fingerprint, delegationId: crypto.randomUUID() };
      }
      await api('/api/agent/ops/pa/delegations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: objective.trim(), capabilities, delegationId: createRequestRef.current.delegationId }),
      });
      createRequestRef.current = null;
      setObjective('');
      setNotice('Alex received the handoff. It is waiting for your approval before any reasoning work is queued.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Alex could not accept this handoff.');
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    setNotice('');
    setError('');
    try {
      await api(`/api/agent/ops/pa/delegations/${encodeURIComponent(id)}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setNotice(decision === 'approve'
        ? 'Approved by you. Gen-X policy evidence is recorded and the three-brain reasoning task has been queued.'
        : 'Delegation rejected. No reasoning work was queued.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The delegation decision could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-300/15 bg-[#0b1020] p-4 text-slate-100 sm:p-5" aria-labelledby={`pa-handoff-${mode}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><ArrowRightLeft className="h-4 w-4" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Ryan ↔ Alex</p>
            <h2 id={`pa-handoff-${mode}-title`} className="text-base font-semibold text-white">{mode === 'shared' ? 'Shared PA & Copilot delegation desk' : canCreate ? 'Hand work to Alex' : 'Alex delegation desk'}</h2>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white" aria-label="Refresh Alex handoffs"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        {canCreate
          ? 'PA Agent and Darkside Copilot share this same owner-scoped capability surface. They can create and review delegations; Gen-X and the server enforce each capability at execution time.'
          : 'Review incoming reasoning handoffs and approve or reject each proposal. The same capability set is available in PA Agent, Darkside Copilot and the Admin Console; privileged deployment and outbound communication remain separately gated.'}
      </p>

      {canCreate && (
        <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <label className="block text-xs font-medium text-slate-300" htmlFor="alex-handoff-objective">What should Alex coordinate?</label>
          <textarea id="alex-handoff-objective" value={objective} onChange={event => setObjective(event.target.value)} rows={3} maxLength={12000} placeholder="Example: Inspect the RyanAI API health, compare the current engineering blockers, and prepare a reviewable recommendation." className="w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/40" />
          <div className="grid gap-2 sm:grid-cols-2">
            {CAPABILITIES.map(item => (
              <label key={item.id} className="flex items-center gap-2 text-[11px] text-slate-300">
                <input type="checkbox" checked={capabilities.includes(item.id)} onChange={event => setCapabilities(current => event.target.checked ? [...current, item.id] : current.filter(value => value !== item.id))} className="accent-cyan-400" />
                {item.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-slate-500">Internal Comms tasks are durable, owner-scoped work items. Creating one does not start a conversation or send WhatsApp, SMS, voice, or email.</p>
            <button type="button" onClick={() => void submit()} disabled={busy !== null || objective.trim().length < 5 || capabilities.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-40">
              {busy === 'create' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send to Alex
            </button>
          </div>
        </div>
      )}

      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-300/15 bg-emerald-300/5 p-3 text-xs text-emerald-100">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-300/15 bg-rose-300/5 p-3 text-xs text-rose-100">{error}</p>}

      <div className="mt-4 space-y-3">
        {loading ? <p className="text-xs text-slate-500">Loading delegation history…</p> :
          delegations.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-slate-500">No Ryan ↔ Alex handoffs yet.</p> :
          delegations.map(delegation => {
            const synthesis = resultText(delegation);
            const status = displayStatus(delegation);
            const pending = delegation.agentRun?.approvalStatus === 'pending' && delegation.agentRun.status === 'queued';
            return (
              <article key={delegation.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{delegation.objective}</p>
                    <p className="mt-1 text-[10px] text-slate-500">Created {new Date(delegation.createdAt).toLocaleString()} · {delegation.id.slice(0, 8)}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] uppercase ${status === 'completed' ? 'border-emerald-300/20 bg-emerald-300/5 text-emerald-200' : status === 'failed' || status === 'rejected' ? 'border-rose-300/20 bg-rose-300/5 text-rose-200' : 'border-amber-300/20 bg-amber-300/5 text-amber-100'}`}>{status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">{delegation.requestedCapabilities.map(cap => <span key={cap} className="rounded-md border border-white/10 px-2 py-1 text-[9px] text-slate-400">{cap}</span>)}</div>
                {delegation.agentRun?.handoffs && delegation.agentRun.handoffs.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400" aria-label="Agent handoff path">
                    {delegation.agentRun.handoffs.map((handoff, index) => (
                      <span key={index} className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1">
                        {handoff.fromAgent} → {handoff.toAgent} · {handoff.status}
                      </span>
                    ))}
                  </div>
                )}
                {pending && canApprove && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void decide(delegation.id, 'approve')} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" /> Approve & queue</button>
                    <button type="button" onClick={() => void decide(delegation.id, 'reject')} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300/20 bg-rose-300/5 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-40"><XCircle className="h-3.5 w-3.5" /> Reject</button>
                  </div>
                )}
                {synthesis && <div className="mt-3 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.04] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" /> Workforce response · {((delegation.agentRun?.result as { verification?: { verified?: boolean } } | null)?.verification?.verified === true) ? 'three-brain complete' : 'verification not complete'}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">{synthesis}</p></div>}
                {delegation.agentRun?.error && <p className="mt-2 text-xs text-rose-200">{delegation.agentRun.error}</p>}
                {delegation.receipt?.error && <p className="mt-2 text-xs text-rose-200">{delegation.receipt.error}</p>}
                <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><Clock3 className="h-3 w-3" /> Attempts: {delegation.agentRun?.attempts ?? 0} · Receipt: {delegation.receipt?.status ?? 'not yet issued'}</p>
              </article>
            );
          })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500"><Activity className="h-3 w-3" /> Refreshes every 15 seconds while visible. Approval is always a separate human action.</div>
    </section>
  );
}
