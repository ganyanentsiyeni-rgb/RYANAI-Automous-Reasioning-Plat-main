import Modal from './Modal';
import { BookOpen, Cpu, Database, GitBranch, Network, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
import packageMetadata from '../../package.json';
import { usePlatformHealth } from '@/hooks/usePlatformHealth';
import { getSnapshotFreshness } from '@/lib/healthFreshness';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

const architecture = [
  { icon: Cpu, title: 'High-performance acceleration', detail: 'A custom C++ and CUDA acceleration engine designed for efficient bare-metal inference.' },
  { icon: Network, title: 'Reasoning and orchestration', detail: 'A multi-tier inference stack using LangGraph ReAct agents, MCP servers, and configurable local or cloud model orchestration.' },
  { icon: Workflow, title: 'Gateway and interfaces', detail: 'A Fastify streaming gateway with a native desktop HUD interface built with Tauri, alongside the web and mobile workspaces.' },
  { icon: ShieldCheck, title: 'Zero-trust security', detail: 'Kernel-level eBPF security guardrails, least-privilege access, explicit authorization gates, and owner-controlled data.' },
  { icon: Database, title: 'Sovereign data', detail: 'Persistent account-scoped data services and a local-first operating model. External services are optional integration boundaries, not assumed dependencies.' },
  { icon: GitBranch, title: 'Governed engineering', detail: 'Version-controlled development, evidence-based CI, reviewed pull requests, and human approval for sensitive actions.' },
];

const serviceLabels: Record<string, string> = {
  api: 'API process',
  database: 'PostgreSQL',
  redis: 'Redis',
  agentCheckpointer: 'Agent checkpointer',
};

function readinessLabel(
  checking: boolean,
  error: string | null,
  health: ReturnType<typeof usePlatformHealth>['health'],
  service?: string,
): string {
  if (checking && !health) return 'Checking';
  if (error || !health) return 'Unreachable';
  const freshness = getSnapshotFreshness(health.timestamp);
  if (freshness !== 'fresh') return freshness === 'stale' ? 'Stale' : 'Unknown';
  if (service) {
    if (typeof health.services?.[service] !== 'boolean') return 'Not reported';
    return health.services[service] ? 'Ready' : 'Unavailable';
  }
  return health.status === 'online' ? 'Ready' : 'Degraded';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-ink-800/30 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-200">{title}</h3>
      <div className="mt-2 space-y-2 text-xs leading-5 text-ink-300">{children}</div>
    </section>
  );
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const buildId = import.meta.env.VITE_BUILD_ID;
  const { health, error, checking, refresh } = usePlatformHealth(30_000);

  const overallStatus = readinessLabel(checking, error, health);
  const serviceStatus = (key: string) => readinessLabel(checking, error, health, key);

  return (
    <Modal open={open} onClose={onClose} title="About RyanAI" icon={<BookOpen size={20} />}>
      <div className="space-y-4 text-sm text-ink-300">
        <header>
          <p className="font-semibold text-white">RyanAI Sovereign Autonomous Reasoning Platform</p>
          <p className="mt-1 text-xs leading-5 text-ink-400">
            Also known as Project Ryan, RyanAI is a standalone, multi-platform autonomous AI assistant
            ecosystem architected and owned by Ntsiyeni Ganyane. Its guiding principles are self-sovereign
            infrastructure, hardware-level data privacy, zero-trust security, and human-in-the-loop governance.
            Local-first operation is a design objective; configured cloud providers and external integrations
            remain optional and are never represented as offline capabilities.
          </p>
        </header>

        <Section title="The inspiration — Mukhethwa Ryan Ganyane">
          <p>
            Mukhethwa Ryan Ganyane, born on 24 May, is the son of software engineer and entrepreneur
            Ntsiyeni Ganyane and the namesake behind RyanAI.
          </p>
          <p>
            Every 24 May is celebrated as a special milestone honouring Mukhethwa's birthday and the
            continuing journey of the platform named in his honour.
          </p>
        </Section>

        <section aria-label="Core technical architecture">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-200">Core technical architecture</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {architecture.map(({ icon: Icon, title, detail }) => (
              <article key={title} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-cyan-200"><Icon size={14} />{title}</div>
                <p className="text-[11px] leading-5 text-ink-400">{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <Section title="Founder biography — Ntsiyeni Ganyane">
          <p>
            Ntsiyeni Ganyane, also known as Ganyane or Sir G, is a South African systems engineer,
            entrepreneur, and agriculturalist based in Johannesburg, Gauteng. He is the son of
            Mahlodi Refilwe Ganyane and retired Lieutenant Colonel Maitakhole George Ganyane,
            grew up alongside his sister Masala, and is the father of Mukhethwa Ryan Ganyane.
          </p>
        </Section>

        <Section title="Education and technical qualifications">
          <ul className="list-disc space-y-1 pl-4">
            <li><strong>2016:</strong> Completed matriculation.</li>
            <li><strong>2017:</strong> Earned a Technical Support Certificate.</li>
            <li><strong>2018–2022:</strong> Earned industry-recognised certifications including CompTIA A+, CompTIA N+, and End-User Computing.</li>
          </ul>
        </Section>

        <Section title="Career and enterprise">
          <p>
            <strong>Institutional IT — University of Johannesburg and public healthcare:</strong>{' '}
            Began institutional IT work at the University of Johannesburg in 2019 as a Technical Assistant
            intern, gained public healthcare IT experience at Tambo Memorial Hospital through 2022, and
            returned to UJ's Auckland Park Kingsway campus as an IT Technical Assistant I within
            Information &amp; Communication Systems, supporting university computing environments.
          </p>
          <p>
            <strong>RMN Ganyane (Pty) Ltd t/a Uncle Security Service:</strong>{' '}
            Founder and Director of an enterprise delivering IT engineering, physical and digital security
            solutions, and specialised hardware procurement and distribution.
          </p>
          <p>
            <strong>AI and software engineering:</strong>{' '}
            Creator and owner of RyanAI, working across full-stack distributed systems, native mobile
            applications, and low-level GPU/CUDA software with a focus on data sovereignty and resilient engineering.
          </p>
          <p>
            <strong>Commercial agriculture:</strong>{' '}
            Operates an agricultural enterprise producing and supplying fresh cabbages to regional produce
            distributors across Limpopo and Gauteng, including Freshlinq in Polokwane and Farmlovers.
          </p>
        </Section>

        <Section title="RyanAI at a glance">
          <dl className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-[10px] text-ink-500">Founder and owner</dt><dd>Ntsiyeni Ganyane (Ganyane / Sir G)</dd></div>
            <div><dt className="text-[10px] text-ink-500">Location</dt><dd>Johannesburg, South Africa</dd></div>
            <div><dt className="text-[10px] text-ink-500">Namesake</dt><dd>Mukhethwa Ryan Ganyane (son; birthday 24 May)</dd></div>
            <div><dt className="text-[10px] text-ink-500">Flagship platform</dt><dd>RyanAI Sovereign Autonomous Reasoning Platform</dd></div>
            <div><dt className="text-[10px] text-ink-500">Registered business</dt><dd>RMN Ganyane (Pty) Ltd t/a Uncle Security Service</dd></div>
            <div><dt className="text-[10px] text-ink-500">Core disciplines</dt><dd>Autonomous AI, C++/CUDA, full-stack and systems engineering, IT infrastructure, commercial agriculture</dd></div>
          </dl>
        </Section>

        <section aria-label="Live platform readiness" className="rounded-lg border border-white/10 bg-ink-800/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Live platform readiness</p>
              <p className="mt-1 text-[11px] text-ink-400" role="status" aria-live="polite">Overall: {overallStatus}</p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={checking}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-ink-300 hover:bg-white/5 disabled:opacity-50"
              aria-label="Refresh platform readiness"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {Object.entries(serviceLabels).map(([key, label]) => (
              <div key={key} className="rounded-md bg-black/20 px-2 py-2">
                <dt className="text-[10px] text-ink-500">{label}</dt>
                <dd className="mt-1 text-xs font-medium text-ink-200">{serviceStatus(key)}</dd>
              </div>
            ))}
            <div className="rounded-md bg-black/20 px-2 py-2">
              <dt className="text-[10px] text-ink-500">Model providers</dt>
              <dd className="mt-1 text-xs font-medium text-ink-200">Not probed</dd>
            </div>
            <div className="rounded-md bg-black/20 px-2 py-2">
              <dt className="text-[10px] text-ink-500">GitHub authorization</dt>
              <dd className="mt-1 text-xs font-medium text-ink-200">Not probed</dd>
            </div>
          </dl>
          {health?.timestamp && <p className="mt-2 text-[10px] text-ink-500">Probe timestamp: {new Date(health.timestamp).toLocaleString()}</p>}
          {error && (
            <p className="mt-2 text-[11px] text-amber-300">
              Live readiness could not be retrieved. Check API reachability; provider and infrastructure health remain unverified.
            </p>
          )}
        </section>

        <div className="rounded-lg border border-white/10 bg-ink-800/30 p-3 text-xs font-mono">
          <div>Version: {packageMetadata.version}</div>
          <div>Build: {buildId || 'Not supplied by the build pipeline'}</div>
        </div>
        <p className="flex items-start gap-2 text-[11px] leading-5 text-ink-500">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          Readiness is a point-in-time probe of the API, PostgreSQL, Redis and agent checkpointer. It does
          not test model-provider inference, GitHub authorization, frontend delivery or deployment health.
          A capability listing is not proof of an external integration.
        </p>
        <p className="text-[11px] text-ink-600">© 2026 RyanAI. All rights reserved.</p>
      </div>
    </Modal>
  );
}
