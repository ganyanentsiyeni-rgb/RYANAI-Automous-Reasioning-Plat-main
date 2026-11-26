import { ArrowUpRight, Blocks, BrainCircuit, GitBranch, LayoutDashboard, LockKeyhole, Plug, ShieldCheck, Smartphone, UserRound, Workflow } from 'lucide-react';

type SettingsArea = {
  id: string;
  title: string;
  description: string;
  icon: typeof Plug;
  capability: string;
};

const settingsAreas: SettingsArea[] = [
  { id: 'plugin-integrations-title', title: 'Plugin & integrations centre', description: 'Provider connections, plugin preferences and integration diagnostics.', icon: Plug, capability: 'Existing account-scoped integration controls' },
  { id: 'dashboard-ui-title', title: 'Dashboard UI options', description: 'Choose which workspaces appear in navigation and dashboard shortcuts.', icon: LayoutDashboard, capability: 'Existing account-scoped preferences' },
  { id: 'copilot-settings-title', title: 'Copilot preferences', description: 'Conversation style, response detail, initiative and collaboration defaults.', icon: BrainCircuit, capability: 'Existing account-scoped preferences' },
  { id: 'phonelink-settings-title', title: 'PhoneLink preferences', description: 'Trusted-device defaults, notifications, transfer and confirmation preferences.', icon: Smartphone, capability: 'Existing account-scoped preferences' },
  { id: 'profile-management-title', title: 'Profile management & access control', description: 'Profile details and current role visibility. Role assignment remains server-authorized.', icon: UserRound, capability: 'Profile editing; role changes not exposed' },
  { id: 'studio-profile-title', title: 'RyanAI Studio profile & session', description: 'Shared RyanAI identity, Studio entry and session sign-out.', icon: Workflow, capability: 'Existing shared-session controls' },
  { id: 'github-settings-title', title: 'GitHub authorization & access', description: 'Open the GitHub connection flow and inspect its granted scope.', icon: GitBranch, capability: 'Existing provider authorization flow' },
  { id: 'account-security-title', title: 'Account security', description: 'Email/password changes and sign-out of other refresh-token sessions.', icon: LockKeyhole, capability: 'Existing Supabase Auth controls' },
];

const workspaceAreas = [
  { title: 'Admin Console', route: 'admin', detail: 'Administrator-only control plane' },
  { title: 'PA Agent', route: 'pa', detail: 'Shared task delegation, Comms and release coordination' },
  { title: 'Darkside Copilot', route: 'copilot', detail: 'Shared PA capabilities and command surface' },
  { title: 'Operator Console', route: 'operator', detail: 'Task execution and progress' },
  { title: 'Cockpit', route: 'cockpit', detail: 'Command and operational awareness' },
  { title: 'Quant Lab', route: 'quant', detail: 'Isolated research and paper trading' },
  { title: 'Audiobook Studio', route: 'audiobook', detail: 'Audiobook production workspace' },
  { title: 'Agentic Comms', route: 'comms', detail: 'Owner-authorized communications' },
  { title: 'GitHub Integration', route: 'settings', detail: 'GitHub authorization in Settings' },
  { title: 'Inference Console', route: 'workspace', detail: 'Inference controls within Workspace' },
  { title: 'Memory Vault', route: 'workspace', detail: 'Memory surfaces within Workspace' },
  { title: 'Voice Controls', route: 'settings', detail: 'Voice preferences in Settings' },
];

export default function AdminSettingsHub() {
  return (
    <section id="admin-settings-hub" className="scroll-mt-6 space-y-5 rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="admin-settings-hub-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Administrator settings index</p>
          <h2 id="admin-settings-hub-title" className="mt-1 text-xl font-semibold text-white">Settings & workspace control</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">A single entry point to the eight existing Settings areas and the twelve primary RyanAI UI areas. Preference controls remain account-scoped; privileged access is still enforced by the API and Gen-X.</p>
        </div>
        <a href="#/settings" className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10">Open Settings <ArrowUpRight className="h-3.5 w-3.5" /></a>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {settingsAreas.map(({ id, title, description, icon: Icon, capability }) => (
          <a key={id} href={`?section=${encodeURIComponent(id)}#/settings`} className="group rounded-xl border border-white/10 bg-slate-950/60 p-4 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.04]" aria-label={`${title}: open Settings`}>
            <div className="flex items-center justify-between gap-2">
              <Icon className="h-5 w-5 text-cyan-300" aria-hidden="true" />
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-600 transition group-hover:text-cyan-200" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 min-h-10 text-xs leading-5 text-slate-400">{description}</p>
            <p className="mt-3 border-t border-white/5 pt-2 text-[10px] leading-4 text-slate-500">{capability}</p>
          </a>
        ))}
      </div>

      <div className="border-t border-white/10 pt-4">
        <div className="mb-3 flex items-center gap-2"><Blocks className="h-4 w-4 text-cyan-300" /><h3 className="text-sm font-semibold text-white">RyanAI UI access directory</h3><span className="ml-auto text-[10px] text-slate-500">12 product areas</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {workspaceAreas.map((area) => (
            <a key={area.title} href={`#/${area.route}`} data-testid="workspace-area-link" className="rounded-lg border border-white/10 bg-slate-950/50 p-3 hover:border-cyan-300/30">
              <span className="block text-xs font-semibold text-slate-200">{area.title}</span>
              <span className="mt-1 block text-[10px] leading-4 text-slate-500">{area.detail}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-4">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-200" /><h3 className="text-sm font-semibold text-amber-100">Privileged controls still require server-side implementation</h3></div>
        <p className="mt-2 text-xs leading-5 text-slate-400">This index does not fabricate tenant-wide user management, role assignment, account suspension, global module overrides, integration-secret editing or session revocation APIs. Comms remains owner-authorized; administrator visibility does not grant owner authority. These controls must be added behind dedicated administrator-protected endpoints with audit events and Gen-X policy checks before they can be enabled.</p>
      </div>
    </section>
  );
}
