import { lazy, Suspense, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Activity,
  BrainCircuit,
  Cpu,
  Code2,
  LayoutDashboard,
  TrendingUp,
  Wallet,
  MessageSquareText,
  BookAudio,
  Calculator as CalculatorIcon,
  Mail,
  Music2,
  Smartphone,
  Orbit,
  ShieldCheck,
  Settings,
  ListChecks,
  Menu,
  X,
  ClipboardList,
  LogIn,
  LogOut,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import appManifest from '../app/routes.json';
import { UI_CONFIG } from '@/config/core';
const RyanAICockpit = lazy(() => import('@/components/dashboard/RyanAICockpit'));
const AgentControlPanel = lazy(() => import('@/components/AgentControlPanel').then((module) => ({ default: module.AgentControlPanel })));
const BrainKnowledgePanel = lazy(() => import('@/components/BrainKnowledgePanel'));
const SelfPatchPanel = lazy(() => import('@/components/SelfPatchPanel'));
const CommandCenter = lazy(() => import('@/pages/CommandCenter.tsx'));
const RyanVoiceStream = lazy(() => import('@/components/RyanVoiceStream').then((module) => ({ default: module.RyanVoiceStream })));
const DarksideCopilot = lazy(() => import('@/pages/DarksideCopilot'));
const CommunicationsCenter = lazy(() => import('@/components/CommunicationsCenter'));
const AudiobookStudio = lazy(() => import('@/pages/AudiobookStudio'));
const MusicWorkspace = lazy(() => import('@/pages/MusicWorkspace'));
const PhoneLinkWorkspace = lazy(() => import('@/pages/PhoneLinkWorkspace'));
const CalculatorPage = lazy(() => import('@/pages/Calculator'));
const DashboardPage = lazy(() => import('@/pages/Dashboard'));
const PAAgentPage = lazy(() => import('@/pages/PAAgent'));
const CodingStudio = lazy(() => import('@/pages/CodingStudio'));
const OperatorConsole = lazy(() => import('@/pages/OperatorConsole'));
const OperationsCenter = lazy(() => import('@/pages/OperationsCenter'));
const AdminConsole = lazy(() => import('@/pages/AdminConsole'));
const ProfileSettings = lazy(() => import('@/pages/ProfileSettings'));
const QuantLabPage = lazy(() => import('@/pages/QuantLab'));
const TradingTerminalPage = lazy(() => import('@/pages/TradingTerminal'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const AuthPage = lazy(() => import('@/pages/AuthPage'));
const OAuthConsentPage = lazy(() => import('@/pages/OAuthConsentPage'));
const CommunitySurveyPage = lazy(() => import('@/pages/CommunitySurvey'));
import { useAuth } from '@/hooks/useAuth';
import Greeting from '@/components/Greeting';
import NeuralIcon from '@/components/brand/NeuralIcon';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { DEFAULT_LANGUAGE, OWNER_DEFAULT_LANGUAGE, isRyanLanguage } from '@/shared/languages';
import { getEnabledDashboardUiIds } from '@/shared/dashboardUis';
import { DEFAULT_MODEL, MODEL_LIST } from '@/lib/models';
import type { ModelId } from '@/lib/types';
import { normalizeAudiobookSettings, normalizeCopilotSettings, normalizeDashboardUiPreferences, normalizeInferenceSettings, normalizeMusicSettings, normalizePhoneLinkSettings, normalizeRyanVoiceSettings, type DashboardUiId } from '@/lib/settingsPreferences';

type Route = (typeof appManifest.routes)[number]['id'];

/**
 * Resolve the first hash path segment, mapping login/register to signin/signup.
 * Unknown segments use the configured default route.
 */
const routeFromHash = (): Route => {
  const segment = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  const route =
    segment === 'login'
      ? 'signin'
      : segment === 'register'
        ? 'signup'
        : segment;
  return (
    appManifest.routes.find((candidate) => candidate.id === route)?.id ??
    UI_CONFIG.defaultRoute
  );
};

const routeIcons: Record<Route, LucideIcon> = {
  landing: Orbit,
  copilot: BrainCircuit,
  signin: LogIn,
  signup: UserPlus,
  dashboard: LayoutDashboard,
  pa: BrainCircuit,
  calculator: CalculatorIcon,
  operator: Activity,
  operations: ListChecks,
  admin: ShieldCheck,
  settings: Settings,
  quant: TrendingUp,
  trading: Wallet,
  cockpit: Cpu,
  workspace: MessageSquareText,
  comms: Mail,
  audiobook: BookAudio,
  music: Music2,
  phonelink: Smartphone,
  studio: Code2,
  survey: ClipboardList,
};

const destinations = appManifest.routes.map((route) => ({
  ...route,
  icon: routeIcons[route.id],
}));
const routeUiOptions: Partial<Record<Route, DashboardUiId>> = {
  dashboard: 'dashboard', pa: 'pa', calculator: 'calculator', operator: 'operator',
  operations: 'operations', admin: 'admin', quant: 'quant', trading: 'trading',
  cockpit: 'cockpit', studio: 'studio', comms: 'comms', audiobook: 'audiobook', music: 'music', phonelink: 'phonelink', workspace: 'workspace',
};

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [verifiedIdentity, setVerifiedIdentity] = useState<{ userId: string; isOwner: boolean; displayName?: string; serverVerified: boolean } | null>(null);
  const { session, loading, error, signingOut, signOut } = useAuth();
  const isAuthRoute = route === 'signin' || route === 'signup';
  // Supabase redirects OAuth authorization requests to this real path (not a hash route).
  const isOAuthConsentRoute = window.location.pathname.replace(/\/+$/, '') === '/oauth/consent';
  const user = session?.user;
  const isAdmin = user?.app_metadata?.role === 'admin';
  const isOwner = user?.app_metadata?.owner === true || Boolean(user && verifiedIdentity?.userId === user.id && verifiedIdentity.isOwner);
  const storedUiPreferences = user?.user_metadata?.ryanai_dashboard_ui_preferences;
  // Existing accounts predate the Music and PhoneLink workspaces; preserve their
  // compatibility defaults without mutating the shared enabled-workspace result.
  const legacyCompatibilityIds = new Set<DashboardUiId>();
  if (Array.isArray(user?.user_metadata?.ryanai_dashboard_ui) && (!storedUiPreferences || typeof storedUiPreferences !== 'object' || !('music' in storedUiPreferences))) {
    legacyCompatibilityIds.add('music');
  }
  if (Array.isArray(user?.user_metadata?.ryanai_dashboard_ui) && (!storedUiPreferences || typeof storedUiPreferences !== 'object' || !('phonelink' in storedUiPreferences))) {
    legacyCompatibilityIds.add('phonelink');
  }
  const enabledUiIds = Array.from(new Set([
    ...getEnabledDashboardUiIds(user?.user_metadata?.ryanai_dashboard_ui, isOwner, isAdmin),
    ...legacyCompatibilityIds,
  ]));
  const roleAccessDenied = Boolean(user && (
    (route === 'admin' && !isAdmin)
    || (route === 'comms' && !isOwner)
  ));
  const routeRequiresToggle = !['landing', 'dashboard', 'settings', 'signin', 'signup', 'copilot', 'survey'].includes(route);
  const routeDisabled = Boolean(user && routeRequiresToggle && !enabledUiIds.some((id) => id === route));
  const displayName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : user?.email?.split('@')[0];
  const dashboardUiPreferences = normalizeDashboardUiPreferences(user?.user_metadata?.ryanai_dashboard_ui_preferences);
  // Keep dashboard cards aligned with the effective workspace list used by navigation.
  // This also preserves legacy accounts that have the array preference but no object preference yet.
  const effectiveDashboardUiPreferences = { ...dashboardUiPreferences };
  for (const preferenceId of Object.values(routeUiOptions)) {
    if (preferenceId) {
      effectiveDashboardUiPreferences[preferenceId] = enabledUiIds.some((enabledId) => enabledId === preferenceId);
    }
  }
  const audiobookSettings = normalizeAudiobookSettings(user?.user_metadata?.ryanai_audiobook_settings);
  const inferenceSettings = normalizeInferenceSettings(user?.user_metadata?.ryanai_inference_settings, MODEL_LIST, DEFAULT_MODEL);
  const musicSettings = normalizeMusicSettings(user?.user_metadata?.ryanai_music_settings);
  const phoneLinkSettings = normalizePhoneLinkSettings(user?.user_metadata?.ryanai_phonelink_settings);
  const ryanVoiceSettings = normalizeRyanVoiceSettings(user?.user_metadata?.ryanai_voice_settings);
  const copilotSettings = normalizeCopilotSettings(user?.user_metadata?.ryanai_copilot_settings);
  const activeUiOption = routeUiOptions[route];
  const isDisabledUiRoute = Boolean(user && activeUiOption && !effectiveDashboardUiPreferences[activeUiOption]);

  const handleSignOut = async () => {
    if (await signOut()) window.location.hash = '/signin';
  };

  const authenticatedUserId = user?.id;
  const authenticatedUserEmail = user?.email;
  const authenticatedOwnerClaim = user?.app_metadata?.owner === true;

  useEffect(() => {
    if (!authenticatedUserId) return;
    let active = true;
    void authenticatedFetch('/api/auth/verify')
      .then(async (response) => {
        if (!response.ok) throw new Error('Identity verification unavailable');
        return response.json() as Promise<{ user?: { isOwner?: boolean; displayName?: string } }>;
      })
      .then((result) => {
        if (active) setVerifiedIdentity({
          userId: authenticatedUserId,
          isOwner: result.user?.isOwner === true,
          displayName: result.user?.displayName,
          serverVerified: Boolean(result.user),
        });
      })
      .catch(() => {
        if (active) setVerifiedIdentity({
          userId: authenticatedUserId,
          isOwner: authenticatedOwnerClaim,
          displayName,
          serverVerified: false,
        });
      });
    return () => { active = false; };
  }, [authenticatedUserId, authenticatedUserEmail, authenticatedOwnerClaim, displayName]);

  useEffect(() => {
    // Supabase OAuth returns to the origin (no hash) so its URL fragment can
    // be consumed safely. The initial hash route is therefore "landing";
    // move a newly restored OAuth session into the authenticated workspace.
    if (session && (isAuthRoute || route === 'landing')) {
      window.location.hash = '/dashboard';
    }
  }, [session, isAuthRoute, route]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [route]);

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  const visibleDestinations = destinations.filter(({ id }) =>
    user
      ? id !== 'signin' && id !== 'signup' && id !== 'survey'
        && (id !== 'comms' || isOwner)
        && (id !== 'admin' || isAdmin)
        && (id === 'landing' || id === 'dashboard' || id === 'settings' || id === 'copilot' || id === 'survey' || enabledUiIds.some((enabledId) => enabledId === id))
        && (!routeUiOptions[id] || effectiveDashboardUiPreferences[routeUiOptions[id] as DashboardUiId])
      : id === 'landing' || id === 'signin' || id === 'signup' || id === 'survey',
  );
  const currentTitle = destinations.find(({ id }) => id === route)?.label ?? 'Workspace';

  return (
    <div className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-[#0D0E15] text-[#F8FAFC] md:flex-row">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="relative z-30 hidden w-[252px] shrink-0 flex-col border-r border-cyan-300/10 bg-[#0a0d14] md:flex">
        <a href="#/" className="flex min-h-[76px] items-center gap-3 border-b border-white/5 px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200"><NeuralIcon icon={BrainCircuit} active size="brand" /></span>
          <span><span className="block font-display text-sm font-black tracking-[0.2em] text-cyan-100">RYANAI</span><span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Autonomous platform</span></span>
        </a>
        <p className="px-5 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">Platform</p>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {visibleDestinations.map(({ id, path, label, icon: Icon }) => (
            <a key={id} href={id === 'landing' ? '#/' : `#${path}`} aria-current={route === id ? 'page' : undefined}
              className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${route === id ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100' : 'border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'}`}>
              <NeuralIcon icon={Icon} active={route === id} size="desktop" /><span>{label}</span>
              {route === id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300" />}
            </a>
          ))}
        </nav>
        <div className="border-t border-white/5 p-4">
          {user ? <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-300/10 text-xs font-bold text-cyan-100">{(displayName || 'R').slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-200">{displayName || 'Signed-in operator'}</span><span className="mt-1 block text-[9px] uppercase tracking-wider text-slate-500">{isOwner ? 'Owner session' : isAdmin ? 'Admin session' : 'Authenticated session'}</span><a href="#/survey" aria-label="Open RyanAI Community Survey" className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-cyan-200 transition hover:text-cyan-100"><ClipboardList className="h-3 w-3" /> Community Survey</a></span>
            <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-50"><LogOut className="h-4 w-4" /></button>
          </div> : <p className="px-2 py-2 text-[11px] text-slate-600">Secure sign-in required for operator tools.</p>}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 shrink-0 border-b border-cyan-300/10 bg-[#0d111b]/95 shadow-lg shadow-black/10 backdrop-blur-xl">
          <div className="hidden min-h-[64px] items-center justify-between gap-4 px-6 md:flex xl:px-9">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">RyanAI / Platform</p><p className="mt-1 text-sm font-semibold text-slate-200">{currentTitle}</p></div>
            <div className="flex items-center gap-3"><span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-200/80">Operator console</span>{user && <span className="max-w-[220px] truncate text-xs text-slate-500">{displayName}</span>}{user && <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button>}</div>
          </div>
          <div className="flex min-h-[58px] items-center justify-between gap-3 px-4 md:hidden">
            <a href="#/" className="flex items-center gap-2 font-display text-sm font-black tracking-[0.18em] text-cyan-100"><NeuralIcon icon={BrainCircuit} active size="mobile-brand" />RYANAI</a>
            <button type="button" aria-controls="mobile-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(open => !open)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs font-semibold text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
              {mobileNavOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
              <span>{mobileNavOpen ? 'Close' : 'Menu'}</span>
            </button>
            <div className="flex min-w-0 items-center gap-2">{user && <div className="flex min-w-0 flex-col items-end"><span className="max-w-[140px] truncate text-[11px] text-slate-500">{displayName}</span><a href="#/survey" aria-label="Open RyanAI Community Survey" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-200"><ClipboardList className="h-3 w-3" /> Survey</a></div>}{user && <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="Sign out" className="rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-300 disabled:opacity-50">{signingOut ? '…' : 'Sign out'}</button>}</div>
          </div>
          <nav id="mobile-navigation" hidden={!mobileNavOpen} aria-label="Mobile navigation" className="absolute inset-x-0 top-full z-40 grid max-h-[70dvh] grid-cols-1 gap-1 overflow-y-auto border-b border-cyan-300/15 bg-[#0a0d14] p-3 shadow-2xl shadow-black/40 sm:grid-cols-2 md:hidden">
            {visibleDestinations.map(({ id, path, label, icon: Icon }) => <a key={id} href={id === 'landing' ? '#/' : `#${path}`} aria-current={route === id ? 'page' : undefined} onClick={() => setMobileNavOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${route === id ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100' : 'border-white/5 text-slate-300 hover:bg-white/5'}`}><NeuralIcon icon={Icon} active={route === id} size="mobile" /><span>{label}</span>{route === id && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-cyan-200">Current</span>}</a>)}
          </nav>
        </header>
        <Suspense fallback={<p role="status" className="p-8 text-slate-300">Loading RyanAI workspace…</p>}>
          <main id="main-content" key={user?.id ?? 'signed-out'} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
            {user && verifiedIdentity?.userId === user.id && <Greeting userId={user.id} displayName={verifiedIdentity.displayName || displayName} isOwner={isOwner} preferredLanguage={typeof user.user_metadata?.ryanai_language === 'string' ? user.user_metadata.ryanai_language : undefined} preferredVoiceEnabled={typeof user.user_metadata?.ryanai_voice_enabled === 'boolean' ? user.user_metadata.ryanai_voice_enabled : undefined} />}
            {error && <p role="alert" className="p-4 text-rose-300">{error}</p>}
            {isOAuthConsentRoute ? loading ? <p role="status" className="p-8 text-slate-300">Restoring your session before authorization…</p> : user ? <OAuthConsentPage key={user.id} userId={user.id} /> : <AuthPage key="oauth-signin" mode="signin" />
              : route === 'landing' ? <LandingPage />
              : route === 'survey' ? <CommunitySurveyPage />
              : loading ? <p role="status" className="p-8 text-slate-300">Restoring your session…</p>
              : !user ? <AuthPage key={route} mode={route === 'signup' ? 'signup' : 'signin'} />
              : roleAccessDenied ? <p role="alert" className="p-8 text-sm text-rose-200">Your account does not have permission to open this RyanAI workspace.</p>
              : (routeDisabled || isDisabledUiRoute) ? (
                <section className="mx-auto max-w-3xl p-8" aria-labelledby="disabled-workspace-title">
                  <h1 id="disabled-workspace-title" className="text-xl font-semibold text-white">Workspace disabled</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-400">This workspace is turned off in your dashboard preferences. Enable it in Settings to restore its dashboard card, navigation link and direct access.</p>
                  <a href="#/settings" className="mt-4 inline-flex rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Open Settings</a>
                </section>
              ) : <>
                {route === 'dashboard' && <DashboardPage isOwner={isOwner} isAdmin={isAdmin} enabledModules={effectiveDashboardUiPreferences} musicSettings={musicSettings} />}
                {route === 'copilot' && <DarksideCopilot onSignOut={() => void handleSignOut()} userId={user.id} userEmail={user.email ?? ''} userFullName={displayName} showInferenceConsole={dashboardUiPreferences.inferenceConsole} defaultInferenceModel={inferenceSettings.preferredModel as ModelId} voiceSettings={ryanVoiceSettings} copilotSettings={copilotSettings} />}
                {route === 'pa' && <PAAgentPage />}
                {route === 'settings' && <ProfileSettings key={user.id} userId={user.id} email={user.email ?? ''} initialDisplayName={displayName || ''} initialLanguage={typeof user.user_metadata?.ryanai_language === 'string' ? user.user_metadata.ryanai_language : isOwner ? OWNER_DEFAULT_LANGUAGE : DEFAULT_LANGUAGE} initialVoiceEnabled={typeof user.user_metadata?.ryanai_voice_enabled === 'boolean' ? user.user_metadata.ryanai_voice_enabled : undefined} initialRyanVoiceSettings={ryanVoiceSettings} initialCopilotSettings={copilotSettings} initialDashboardUiIds={enabledUiIds} initialDashboardUiPreferences={dashboardUiPreferences} initialAudiobookSettings={audiobookSettings} initialInferenceSettings={inferenceSettings} initialMusicSettings={user.user_metadata?.ryanai_music_settings} initialPhoneLinkSettings={phoneLinkSettings} initialPluginPreferences={user.user_metadata?.ryanai_plugin_preferences} isAdmin={isAdmin} isOwner={isOwner} onSignOut={() => void handleSignOut()} signingOut={signingOut} />}
                {route === 'operator' && <OperatorConsole userId={user.id} />}
                {route === 'operations' && <OperationsCenter userId={user.id} isAdmin={isAdmin} />}
                {route === 'admin' && (isAdmin ? <AdminConsole key={user.id} userId={user.id} /> : <p role="alert" className="p-8 text-sm text-rose-200">Administrator access is required to open the RyanAI Admin Console.</p>)}
                {route === 'quant' && <QuantLabPage userId={user.id} />}
                {route === 'trading' && <TradingTerminalPage />}
                {route === 'calculator' && <CalculatorPage />}
                {route === 'comms' && (isOwner ? <CommunicationsCenter userId={user.id} phoneLinkSettings={phoneLinkSettings} /> : <p role="alert" className="p-8 text-sm text-rose-200">Owner access is required to open RyanAI Comms.</p>)}
                {route === 'music' && <MusicWorkspace settings={musicSettings} />}
                {route === 'phonelink' && <PhoneLinkWorkspace userId={user.id} settings={phoneLinkSettings} />}
                {route === 'audiobook' && <AudiobookStudio key={user.id} userId={user.id} defaultVoice={audiobookSettings.defaultVoice} defaultSpeed={audiobookSettings.narrationSpeed} />}
                {route === 'studio' && <CodingStudio />}
                {route === 'cockpit' && <><RyanAICockpit userId={user.id} />{isAdmin && <><BrainKnowledgePanel /><SelfPatchPanel /></>}{isTauri() && <AgentControlPanel />}</>}
                {(route === 'workspace' || isAuthRoute) && <div className="min-h-0"><CommandCenter onSignOut={() => void handleSignOut()} userId={user.id} userEmail={user.email ?? ''} userFullName={displayName} showInferenceConsole={dashboardUiPreferences.inferenceConsole} defaultInferenceModel={inferenceSettings.preferredModel as ModelId} voiceSettings={ryanVoiceSettings} preferredLanguage={typeof user.user_metadata?.ryanai_language === 'string' ? user.user_metadata.ryanai_language : undefined} /></div>}
              </>}
          </main>
        </Suspense>
        {user && verifiedIdentity?.userId === user.id && verifiedIdentity.serverVerified && !isOAuthConsentRoute &&
          user.user_metadata?.ryanai_voice_enabled !== false && (
            <Suspense fallback={null}>
              <RyanVoiceStream
                key={user.id}
                language={
                  typeof user.user_metadata?.ryanai_language === 'string' &&
                  isRyanLanguage(user.user_metadata.ryanai_language)
                    ? user.user_metadata.ryanai_language
                    : DEFAULT_LANGUAGE
                }
                voice={ryanVoiceSettings.realtimeVoice}
                anniversaryEvolution={ryanVoiceSettings.anniversaryEvolution}
              />
            </Suspense>
          )}
      </div>
    </div>
  );
}