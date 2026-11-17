import { useMemo, useState } from 'react';
import {
  Activity, ArrowRight, AudioLines, BookOpen, BrainCircuit, CheckCircle2,
  ChevronRight, CircleDot, Code2, Database, GitBranch, Layers3, LockKeyhole,
  Network, Orbit, Radio, ShieldCheck, Smartphone, Workflow, Zap,
} from 'lucide-react';

type Plane = 'Control' | 'Intelligence' | 'Execution' | 'Evidence';
type Domain = { id: number; name: string; plane: Plane; summary: string; modules: string[] };

const domains: Domain[] = [
  { id: 1, name: 'Mission & Experience', plane: 'Execution', summary: 'Mission intake, objectives, acceptance criteria and operator experiences.', modules: ['Command Center', 'Operator Console', 'Admin Console', 'Cockpit'] },
  { id: 2, name: 'Identity & Governance', plane: 'Control', summary: 'Authenticated principals, owner scope, Gen-X policy, human approval and revocation.', modules: ['Identity', 'Gen-X policy', 'Approval ledger', 'Capability grants'] },
  { id: 3, name: 'Ontology & Context', plane: 'Intelligence', summary: 'Typed operational objects, relationships, lifecycle, context and lineage.', modules: ['Object registry', 'Relationship graph', 'Context resolver', 'Lineage'] },
  { id: 4, name: 'Intelligence Fabric', plane: 'Intelligence', summary: 'Model registry, provider adapters, routing, structured output and evaluation.', modules: ['Model gateway', 'Provider routing', 'Context assembly', 'Evaluation'] },
  { id: 5, name: 'Agent Orchestration', plane: 'Intelligence', summary: 'Jarvis planning, task dependencies, delegation, scheduling, retries and recovery.', modules: ['Jarvis', 'Agent registry', 'Task scheduler', 'Handoffs'] },
  { id: 6, name: 'Execution Fabric', plane: 'Execution', summary: 'Server-side capability registry, adapters, workers, idempotency and receipts.', modules: ['Capability gateway', 'Tool adapters', 'Workers', 'Execution receipts'] },
  { id: 7, name: 'Memory & Knowledge', plane: 'Intelligence', summary: 'Episodic, semantic, procedural and operational memory with provenance.', modules: ['Memory Vault', 'Retrieval', 'Admission policy', 'Retention'] },
  { id: 8, name: 'Data Foundation', plane: 'Execution', summary: 'Authoritative relational data, vector retrieval, queues and scoped artifacts.', modules: ['PostgreSQL', 'Prisma', 'pgvector', 'Redis / object storage'] },
  { id: 9, name: 'Evidence & Observability', plane: 'Evidence', summary: 'Audit, traces, tests, CI/security results, verification and provenance.', modules: ['Evidence ledger', 'Telemetry', 'Verification', 'Release receipts'] },
  { id: 10, name: 'Application Workspaces', plane: 'Execution', summary: 'Domain applications composed over shared identity, mission and evidence contracts.', modules: ['Studio', 'Quant Lab', 'Audiobook Studio', 'Comms / PhoneLink'] },
  { id: 11, name: 'Infrastructure & Delivery', plane: 'Execution', summary: 'Render and Railway runtime boundaries, CI commit delivery and recovery.', modules: ['Render', 'Railway', 'CI workflows', 'Health and rollback'] },
  { id: 12, name: 'Learning & Optimization', plane: 'Evidence', summary: 'Offline evaluations, benchmarks, feedback, reliability and cost measurement.', modules: ['Benchmark harness', 'Feedback', 'Reliability', 'Cost analysis'] },
];

const planes: { name: Plane; question: string; description: string }[] = [
  { name: 'Control', question: 'Who may do what?', description: 'Identity, Gen-X policy decisions, exact-action approvals, revocation and scoped capability grants.' },
  { name: 'Intelligence', question: 'What should happen?', description: 'Ontology, context, model reasoning, specialist agents, Jarvis coordination and governed memory retrieval.' },
  { name: 'Execution', question: 'What performs the work?', description: 'Mission workspaces, APIs, workers and capability adapters that independently enforce authorization.' },
  { name: 'Evidence', question: 'What proves the outcome?', description: 'Audit records, traces, test results, CI/security evidence, postcondition verification and provenance.' },
];

const workspaces = [
  { name: 'Command Center', detail: 'Mission intake, priorities, objectives and acceptance criteria.', icon: Orbit },
  { name: 'Operator Console', detail: 'Task queue, attempts, handoffs, blocked reasons and receipts.', icon: Workflow },
  { name: 'Admin Console', detail: 'Governed identity, policy, configuration review and audit.', icon: ShieldCheck },
  { name: 'Cockpit', detail: 'Cross-domain situational awareness and verified system signals.', icon: Activity },
  { name: 'RyanAI Studio', detail: 'Engineering missions, project work and reviewed delivery.', icon: Code2 },
  { name: 'Quant Lab', detail: 'Historical research and isolated paper simulation only.', icon: Activity },
  { name: 'Audiobook Studio', detail: 'Media workflow with separately scoped persistence.', icon: AudioLines },
  { name: 'Comms', detail: 'Drafting and gated provider workflows; live delivery stays disabled until verified.', icon: Radio },
  { name: 'PhoneLink', detail: 'Paired device identity and narrowly scoped capabilities.', icon: Smartphone },
  { name: 'Memory Vault', detail: 'Authorized retrieval, provenance, correction and retention.', icon: BookOpen },
  { name: 'GitHub Integration', detail: 'Exact-head changes, CI evidence and human-reviewed pull requests.', icon: GitBranch },
  { name: 'Inference Console', detail: 'Model registry, routing, evaluation and provider status.', icon: BrainCircuit },
];

const gates = [
  'Authenticated principal and session',
  'Owner / tenant / resource scope',
  'Registered capability and allowed action',
  'Current Gen-X policy decision (fail closed)',
  'Exact-action human approval when required',
  'Adapter validation, idempotency and safeguards',
  'Evidence receipt and independent verification',
];

const statusLabel = 'Preview only · live service status not connected';

export default function MissionOperatingSystem() {
  const [tab, setTab] = useState<'Overview' | 'Architecture' | 'Workspaces' | 'Governance'>('Overview');
  const [plane, setPlane] = useState<Plane>('Control');
  const [selectedDomain, setSelectedDomain] = useState(1);
  const [selectedWorkspace, setSelectedWorkspace] = useState('Command Center');
  const currentDomain = useMemo(() => domains.find((item) => item.id === selectedDomain) ?? domains[0], [selectedDomain]);
  const currentPlane = planes.find((item) => item.name === plane) ?? planes[0];
  const selectedWorkspaceInfo = workspaces.find((item) => item.name === selectedWorkspace) ?? workspaces[0];

  return (
    <div className="min-h-full bg-[#0b1220] px-3 py-5 text-slate-100 sm:px-6 lg:px-9">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-[radial-gradient(ellipse_at_top_right,_rgba(14,116,144,0.22),_transparent_48%),linear-gradient(135deg,#111d2d,#0b1220_65%)] p-5 shadow-2xl shadow-black/20 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/10 text-cyan-200"><Orbit size={23} /></span>
              <div><p className="text-xs font-black tracking-[0.24em] text-cyan-100">RYANAI</p><p className="text-[10px] uppercase tracking-[0.17em] text-slate-500">Mission operating system</p></div>
            </div>
            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">Architecture preview</span>
          </div>
          <div className="mt-7 grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-end">
            <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70">Mission-first · Authority-first · Evidence-first</p><h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">One operating picture. Twelve connected domains.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">RyanAI connects mission experience, governance, ontology, intelligence, orchestration, execution, evidence and institutional memory—without allowing agents to authorize themselves.</p></div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-cyan-200/10 bg-slate-950/40 p-3"><LockKeyhole className="mb-2 text-cyan-200" size={18} /><p className="text-xs font-semibold">Gen-X</p><p className="mt-1 text-[10px] text-slate-400">Authority</p></div>
              <div className="rounded-2xl border border-cyan-200/10 bg-slate-950/40 p-3"><Workflow className="mb-2 text-sky-200" size={18} /><p className="text-xs font-semibold">Jarvis</p><p className="mt-1 text-[10px] text-slate-400">Coordination</p></div>
              <div className="rounded-2xl border border-cyan-200/10 bg-slate-950/40 p-3"><CheckCircle2 className="mb-2 text-emerald-200" size={18} /><p className="text-xs font-semibold">Evidence</p><p className="mt-1 text-[10px] text-slate-400">Verification</p></div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/35 p-3 text-xs">
            <span className="font-semibold text-cyan-100">AI proposes</span><ArrowRight size={13} className="text-slate-500" /><span className="text-slate-200">Gen-X authorizes</span><ArrowRight size={13} className="text-slate-500" /><span className="text-slate-200">Jarvis coordinates</span><ArrowRight size={13} className="text-slate-500" /><span className="text-slate-200">Tools execute</span><ArrowRight size={13} className="text-slate-500" /><span className="text-slate-200">Evidence proves</span><ArrowRight size={13} className="text-slate-500" /><span className="text-slate-200">Memory preserves</span>
          </div>
        </section>

        <nav aria-label="RyanAI architecture sections" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-700/70 bg-slate-900/80 p-2">
          {(['Overview', 'Architecture', 'Workspaces', 'Governance'] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} aria-current={tab === item ? 'page' : undefined} className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${tab === item ? 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/30' : 'text-slate-300 hover:bg-white/5'}`}>{item}</button>)}
        </nav>

        {tab === 'Overview' && <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-900 shadow-xl shadow-black/10">
            <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Operating model</p><h2 className="mt-1 text-xl font-semibold">Mission to verified outcome</h2></div><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Illustrative flow</span></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {['Mission submitted & validated', 'Gen-X evaluates scope and policy', 'Human approval for gated actions', 'Jarvis schedules approved tasks', 'Adapters execute scoped capabilities', 'Evidence verifies acceptance criteria'].map((step, index) => <div key={step} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-cyan-200">{index + 1}</span><p className="pt-1 text-xs font-medium leading-5">{step}</p></div>)}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Task execution, authorization and verification are separate states. A successful tool response does not itself establish a verified mission outcome.</p>
          </section>
          <section className="rounded-2xl border border-slate-700/70 bg-slate-900 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">Four planes</p><h2 className="mt-1 text-xl font-semibold text-white">Separate responsibility boundaries</h2>
            <div className="mt-4 space-y-2">{planes.map((item) => <button key={item.name} type="button" onClick={() => { setPlane(item.name); setTab('Architecture'); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-left hover:border-cyan-300/40"><div><p className="text-sm font-semibold text-slate-100">{item.name}</p><p className="mt-1 text-xs text-slate-400">{item.question}</p></div><ChevronRight className="shrink-0 text-cyan-200" size={17} /></button>)}</div>
          </section>
        </div>}

        {tab === 'Architecture' && <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-2xl border border-slate-700 bg-slate-900 p-4"><h2 className="px-1 text-lg font-semibold">Four architecture planes</h2><div className="mt-3 space-y-2">{planes.map((item) => <button key={item.name} type="button" onClick={() => setPlane(item.name)} className={`w-full rounded-xl border p-3 text-left transition ${plane === item.name ? 'border-cyan-300/50 bg-cyan-300/10' : 'border-slate-700 bg-slate-950/40 hover:bg-slate-800'}`}><p className="text-sm font-semibold text-white">{item.name}</p><p className="mt-1 text-xs text-slate-400">{item.question}</p></button>)}</div><div className="mt-3 rounded-xl bg-slate-800/80 p-3"><p className="text-xs font-semibold text-cyan-100">{currentPlane.name} responsibilities</p><p className="mt-2 text-xs leading-5 text-slate-300">{currentPlane.description}</p></div></section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Twelve domains</p><h2 className="text-lg font-semibold">Domain map</h2></div><Layers3 className="text-slate-500" size={20} /></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{domains.map((domain) => <button key={domain.id} type="button" onClick={() => setSelectedDomain(domain.id)} className={`rounded-xl border p-3 text-left transition ${selectedDomain === domain.id ? 'border-cyan-600 bg-cyan-50 ring-1 ring-cyan-600/20' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-cyan-800">{String(domain.id).padStart(2, '0')}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">{domain.plane}</span></div><p className="mt-2 text-xs font-semibold">{domain.name}</p></button>)}</div><div className="mt-3 rounded-xl bg-slate-100 p-4"><p className="text-sm font-semibold">{currentDomain.name}</p><p className="mt-1 text-xs leading-5 text-slate-600">{currentDomain.summary}</p><div className="mt-3 flex flex-wrap gap-1.5">{currentDomain.modules.map((module) => <span key={module} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-700">{module}</span>)}</div></div></section>
        </div>}

        {tab === 'Workspaces' && <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-900"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Application experience</p><h2 className="mt-1 text-xl font-semibold">Twelve connected workspace surfaces</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{workspaces.map((workspace) => { const Icon = workspace.icon; return <button key={workspace.name} type="button" onClick={() => setSelectedWorkspace(workspace.name)} className={`rounded-xl border p-4 text-left transition ${selectedWorkspace === workspace.name ? 'border-cyan-700 bg-cyan-50 ring-1 ring-cyan-700/20' : 'border-slate-200 bg-white hover:border-slate-300'}`}><Icon className="text-cyan-800" size={20} /><p className="mt-3 text-sm font-semibold">{workspace.name}</p><p className="mt-1 text-xs leading-5 text-slate-600">{workspace.detail}</p></button>; })}</div><div className="mt-4 rounded-xl bg-slate-900 p-4 text-white"><p className="text-xs font-semibold text-cyan-100">Selected: {selectedWorkspaceInfo.name}</p><p className="mt-1 text-xs text-slate-300">{selectedWorkspaceInfo.detail}</p></div></section>}

        {tab === 'Governance' && <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900"><div className="flex items-center gap-2"><ShieldCheck className="text-emerald-700" size={20} /><h2 className="text-lg font-semibold">Gen-X execution gates</h2></div><p className="mt-1 text-xs leading-5 text-slate-500">Every consequential adapter re-checks authorization immediately before execution.</p><ol className="mt-4 space-y-2">{gates.map((gate, index) => <li key={gate} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-cyan-100">{index + 1}</span><span className="pt-1 text-xs font-medium leading-5">{gate}</span></li>)}</ol></section>
          <section className="space-y-3"><div className="rounded-2xl border border-slate-700 bg-slate-900 p-5"><LockKeyhole className="text-cyan-200" size={22} /><h2 className="mt-3 text-lg font-semibold">Authority is not orchestration</h2><p className="mt-2 text-xs leading-5 text-slate-300">Gen-X decides. Jarvis plans and coordinates only within granted scope. Models reason; they never grant permissions. Adapters enforce policy server-side.</p></div><div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-amber-50"><p className="text-sm font-semibold">Protected operations remain gated</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-100/90"><li>No production deployment without separate approval.</li><li>No production database migration without separate approval.</li><li>No secret changes, paid upgrades or infrastructure changes.</li><li>No live communications or live trading without their separate gates.</li><li>No agent self-approval and no automatic merge.</li></ul></div></section>
        </div>}

        <footer className="flex flex-col gap-2 border-t border-slate-800 pt-4 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>RyanAI · Hybrid command centre and workspace design</span><span className="inline-flex items-center gap-1.5"><CircleDot size={11} /> {statusLabel}</span></footer>
      </div>
    </div>
  );
}
