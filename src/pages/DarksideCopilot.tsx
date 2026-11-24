import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BrainCircuit, Mic2, RefreshCw, ShieldCheck, Sparkles, Users, Workflow } from 'lucide-react';
import type { ModelId } from '@/lib/types';
import type { CopilotSettings, RyanVoiceSettings } from '@/lib/settingsPreferences';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import CommandCenter from '@/pages/CommandCenter.tsx';
import PADelegationPanel from '@/components/PADelegationPanel';

interface DarksideCopilotProps {
  onSignOut: () => void;
  userId: string;
  userEmail?: string;
  userFullName?: string;
  showInferenceConsole?: boolean;
  defaultInferenceModel?: ModelId;
  voiceSettings: RyanVoiceSettings;
  copilotSettings: CopilotSettings;
}

type PAObserver = {
  active: boolean;
  workState: 'stopped' | 'monitoring' | 'degraded';
  lastHeartbeat?: string | null;
  health?: {
    api?: boolean;
    database?: boolean;
    redis?: boolean;
    agentCheckpointer?: boolean;
    agentWorker?: boolean;
  };
  genXPolicyEngineAvailable?: boolean;
};

type PAConnection = 'loading' | 'monitoring' | 'degraded' | 'unavailable';

function heartbeatLabel(value?: string | null): string {
  if (!value) return 'No heartbeat reported';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Heartbeat timestamp unavailable' : `Last heartbeat ${timestamp.toLocaleTimeString()}`;
}

export default function DarksideCopilot(props: DarksideCopilotProps) {
  const [paConnection, setPaConnection] = useState<PAConnection>('loading');
  const [paObserver, setPaObserver] = useState<PAObserver | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refreshPA = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await authenticatedFetch('/api/agent/ops/pa/status', {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json() as { pa?: PAObserver; error?: string };
      if (sequence !== refreshSequence.current) return;
      if (!response.ok || !payload.pa) throw new Error(payload.error || 'PA observer unavailable');
      setPaObserver(payload.pa);
      setPaConnection(payload.pa.active && payload.pa.workState === 'monitoring' ? 'monitoring' : 'degraded');
      setRefreshedAt(new Date().toISOString());
    } catch {
      if (sequence !== refreshSequence.current) return;
      setPaObserver(null);
      setPaConnection('unavailable');
      setRefreshedAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    if (!props.copilotSettings.showAlexStatus) return;
    let active = true;
    const run = async () => { if (active && document.visibilityState === 'visible') await refreshPA(); };
    void run();
    const interval = window.setInterval(() => { void run(); }, props.copilotSettings.refreshIntervalSeconds * 1000);
    const onFocus = () => { void run(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      refreshSequence.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshPA, props.copilotSettings.showAlexStatus, props.copilotSettings.refreshIntervalSeconds]);

  const paLabel = paConnection === 'monitoring' ? 'Alex · Monitoring' :
    paConnection === 'degraded' ? 'Alex · Degraded' :
    paConnection === 'unavailable' ? 'Alex · Unavailable' : 'Alex · Checking';

  return (
    <section className="min-h-full overflow-hidden bg-[#080912] text-slate-100">
      <div className="relative isolate overflow-hidden border-b border-violet-300/10 bg-[radial-gradient(ellipse_at_top,rgba(91,48,150,0.26),transparent_58%),linear-gradient(135deg,#090a14,#111022_55%,#090b13)] px-4 py-7 sm:px-6 lg:px-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full border border-violet-300/10 shadow-[0_0_100px_rgba(139,92,246,0.16)]" />
        <div className="relative mx-auto flex max-w-[1500px] flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-violet-300/30 bg-violet-400/10 text-violet-200 shadow-[0_0_35px_rgba(139,92,246,0.2)]">
                <BrainCircuit className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-300/70">RyanAI · Darkside initiative</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">The Living Intelligence Interface</h1>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> Authenticated workspace
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-2xl border border-violet-300/20 bg-black/25 p-4 backdrop-blur-xl sm:p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-200"><Sparkles className="h-4 w-4" /> Ryan · Copilot</div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Your conversational command surface, connected to RyanAI's existing reasoning workspace and authenticated realtime voice gateway.</p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-2 rounded-lg border border-violet-300/15 bg-violet-300/5 px-3 py-2 text-violet-100"><Mic2 className="h-3.5 w-3.5" /> Ryan voice · user-initiated</span>
                <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-slate-300"><ShieldCheck className="h-3.5 w-3.5" /> Authenticated session</span>
                <a href="#/workspace" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:border-violet-300/30 hover:text-white">Open full workspace <ArrowUpRight className="h-3.5 w-3.5" /></a>
              </div>
            </div>

            {props.copilotSettings.showAlexStatus && (
            <div className="rounded-2xl border border-cyan-300/15 bg-black/25 p-4 backdrop-blur-xl sm:p-5" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200"><Users className="h-4 w-4" /> Alex · PA Agent</div>
                <button type="button" onClick={() => void refreshPA()} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white" aria-label="Refresh PA Agent status"><RefreshCw className="h-3.5 w-3.5" /></button>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{paLabel}</p>
              <p className="mt-1 text-xs text-slate-400">{heartbeatLabel(paObserver?.lastHeartbeat)}</p>
              <div className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
                {(['api', 'database', 'redis'] as const).map((key) => (
                  <div key={key} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">{key}</p>
                    <p className={`mt-1 text-[10px] font-semibold ${paObserver?.health?.[key] === true ? 'text-emerald-200' : paObserver?.health?.[key] === false ? 'text-rose-200' : 'text-slate-500'}`}>{paObserver?.health?.[key] === true ? 'Healthy' : paObserver?.health?.[key] === false ? 'Unhealthy' : 'Unknown'}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">{refreshedAt ? `Updated ${new Date(refreshedAt).toLocaleTimeString()}` : 'Awaiting first status check'}</span>
                <a href="#/pa" className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-200 hover:text-white">Open PA workspace <ArrowUpRight className="h-3.5 w-3.5" /></a>
              </div>
            </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><Activity className="h-4 w-4 text-violet-300" /><div><p className="text-xs font-semibold text-white">One conversational identity</p><p className="text-[10px] text-slate-500">Ryan Copilot</p></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><Workflow className="h-4 w-4 text-cyan-300" /><div><p className="text-xs font-semibold text-white">Operational partner</p><p className="text-[10px] text-slate-500">Alex PA partner</p></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><ShieldCheck className="h-4 w-4 text-emerald-300" /><div><p className="text-xs font-semibold text-white">Human-controlled actions</p><p className="text-[10px] text-slate-500">Gen-X remains authoritative</p></div></div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-2 sm:p-4 lg:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <div><h2 className="text-sm font-semibold text-white">Copilot command workspace</h2><p className="mt-1 text-[11px] text-slate-500">Text conversation, reasoning selection, and authenticated live voice are provided by the existing Command Center.</p></div>
          <span className="rounded-full border border-violet-300/15 bg-violet-300/5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-violet-200">Voice: user initiated</span>
        </div>
        <CommandCenter
          onSignOut={props.onSignOut}
          userId={props.userId}
          userEmail={props.userEmail}
          userFullName={props.userFullName}
          showInferenceConsole={props.showInferenceConsole}
          defaultInferenceModel={props.defaultInferenceModel}
          voiceSettings={props.voiceSettings}
          copilotSettings={props.copilotSettings}
        />
        <div id="darkside-pa-control-plane" className="mt-5" aria-label="Shared PA Agent and Darkside Copilot control plane"><PADelegationPanel mode="shared" /></div>
      </div>
    </section>
  );
}
