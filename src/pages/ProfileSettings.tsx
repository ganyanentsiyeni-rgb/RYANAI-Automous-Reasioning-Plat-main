import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Globe2, Save, Volume2, LayoutDashboard, BookAudio, BrainCircuit, UserRound, LogOut, Code2, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react';
import { DEFAULT_LANGUAGE, isRyanLanguage, RYANAI_LANGUAGES } from '@/shared/languages';
import { supabase } from '@/lib/supabase';
import { DEFAULT_MODEL, getAvailableModels, MODELS } from '@/lib/models';
import { AUDIOBOOK_SPEEDS, AUDIOBOOK_VOICES, COPILOT_COLLABORATION_MODES, COPILOT_INITIATIVE_LEVELS, COPILOT_PERSONALITIES, COPILOT_RESPONSE_STYLES, DASHBOARD_UI_OPTIONS, RYANAI_REALTIME_VOICES, normalizeAudiobookSettings, normalizeCopilotSettings, normalizeDashboardUiPreferences, normalizeInferenceSettings, normalizeMusicSettings, normalizePhoneLinkSettings, normalizeRyanVoiceSettings, type CopilotSettings, type DashboardUiId, type MusicSettings, type PhoneLinkSettings, type RyanVoiceSettings } from '@/lib/settingsPreferences';
import { getRyanAIAnniversaryInfo, RYANAI_BIRTH_DATE, RYANAI_IDENTITY_NAME } from '@/shared/ryanVoiceIdentity';
import GithubModal from '@/components/GithubModal';
import PluginIntegrationsSettings from '@/components/PluginIntegrationsSettings';

interface Props {
  userId: string; email: string; initialDisplayName: string; initialLanguage: string;
  initialVoiceEnabled?: boolean; initialRyanVoiceSettings?: unknown; initialCopilotSettings?: unknown; initialDashboardUiIds?: string[]; initialDashboardUiPreferences?: unknown; initialAudiobookSettings?: unknown;
  initialInferenceSettings?: unknown; initialMusicSettings?: unknown; initialPhoneLinkSettings?: unknown; initialPluginPreferences?: unknown; isAdmin?: boolean; isOwner?: boolean; onSignOut?: () => void; signingOut?: boolean;
}
export default function ProfileSettings({
  userId,
  email,
  initialDisplayName,
  initialLanguage,
  initialVoiceEnabled,
  initialRyanVoiceSettings,
  initialCopilotSettings,
  initialDashboardUiIds,
  initialDashboardUiPreferences,
  initialAudiobookSettings,
  initialInferenceSettings,
  initialMusicSettings,
  initialPhoneLinkSettings,
  initialPluginPreferences,
  isOwner = false,
  isAdmin = false,
  onSignOut,
  signingOut = false,
}: Props) {
  useEffect(() => {
    const sectionId = new URLSearchParams(window.location.search).get('section');
    if (!sectionId || !/^[a-z][a-z0-9-]{0,80}$/.test(sectionId)) return;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [language, setLanguage] = useState(isRyanLanguage(initialLanguage) ? initialLanguage : DEFAULT_LANGUAGE);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    if (typeof initialVoiceEnabled === 'boolean') return initialVoiceEnabled;
    try { return window.localStorage.getItem(`ryanai:voice-enabled:${userId}`) !== 'false'; } catch { return true; }
  });
  const [ryanVoiceSettings, setRyanVoiceSettings] = useState<RyanVoiceSettings>(() => normalizeRyanVoiceSettings(initialRyanVoiceSettings));
  const [copilotSettings, setCopilotSettings] = useState<CopilotSettings>(() => normalizeCopilotSettings(initialCopilotSettings));
  const anniversaryInfo = getRyanAIAnniversaryInfo();
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [dashboardUi, setDashboardUi] = useState(() => {
    const preferences = normalizeDashboardUiPreferences(initialDashboardUiPreferences);
    if (Array.isArray(initialDashboardUiIds)) {
      const selected = new Set(initialDashboardUiIds);
      for (const option of DASHBOARD_UI_OPTIONS) preferences[option.id] = selected.has(option.id);
      preferences.dashboard = true;
    }
    return preferences;
  });
  const [audiobookSettings, setAudiobookSettings] = useState(() => normalizeAudiobookSettings(initialAudiobookSettings));
  const [inferenceSettings, setInferenceSettings] = useState(() => normalizeInferenceSettings(initialInferenceSettings, Object.keys(MODELS), DEFAULT_MODEL));
  const [musicSettings, setMusicSettings] = useState<MusicSettings>(() => normalizeMusicSettings(initialMusicSettings));
  const [phoneLinkSettings, setPhoneLinkSettings] = useState<PhoneLinkSettings>(() => normalizePhoneLinkSettings(initialPhoneLinkSettings));
  const [saving, setSaving] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const roleLabel = isOwner ? 'Owner' : isAdmin ? 'Administrator' : 'Standard user';
  const canManage = (id: DashboardUiId) => {
    const item = DASHBOARD_UI_OPTIONS.find(option => option.id === id);
    if (!item || !('access' in item)) return true;
    return item.access === 'admin' ? isAdmin : isOwner;
  };
  const changeModule = (id: DashboardUiId, enabled: boolean) => setDashboardUi(current => ({ ...current, [id]: enabled }));

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    if (!supabase) { setError('Settings cannot be saved because RyanAI authentication is not configured.'); return; }
    const name = displayName.trim();
    if (name.length > 100) { setError('Display name must be 100 characters or fewer.'); return; }
    if (!isRyanLanguage(language)) { setError('Choose a supported RyanAI language.'); return; }
    if (!Object.hasOwn(MODELS, inferenceSettings.preferredModel)) { setError('Choose a model from the supported RyanAI model catalogue.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || !identity.user || identity.user.id !== userId) throw new Error('Your RyanAI session could not be verified. Sign in again before saving Settings.');
      const currentPrefs = normalizeDashboardUiPreferences(identity.user.user_metadata?.ryanai_dashboard_ui_preferences);
      const nextPrefs = { ...dashboardUi };
      for (const item of DASHBOARD_UI_OPTIONS) if (!canManage(item.id)) nextPrefs[item.id] = currentPrefs[item.id];
      const enabledIds = DASHBOARD_UI_OPTIONS.filter((option) => nextPrefs[option.id]).map((option) => option.id);
      const { data, error: updateError } = await supabase.auth.updateUser({ data: {
        full_name: name || null, ryanai_language: language, ryanai_voice_enabled: voiceEnabled, ryanai_voice_settings: normalizeRyanVoiceSettings(ryanVoiceSettings), ryanai_copilot_settings: normalizeCopilotSettings(copilotSettings),
        ryanai_dashboard_ui_preferences: nextPrefs, ryanai_dashboard_ui: enabledIds,
        ryanai_audiobook_settings: audiobookSettings, ryanai_inference_settings: inferenceSettings, ryanai_music_settings: normalizeMusicSettings(musicSettings), ryanai_phonelink_settings: normalizePhoneLinkSettings(phoneLinkSettings),
      }});
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) throw new Error('The identity provider did not confirm this Settings update.');
      try {
        window.localStorage.setItem(`ryanai:language:${userId}`, language);
        window.localStorage.setItem(`ryanai:voice-enabled:${userId}`, String(voiceEnabled));
        window.localStorage.setItem(`ryanai:audiobook-settings:${userId}`, JSON.stringify(audiobookSettings));
      } catch { /* Account metadata remains authoritative. */ }
      window.dispatchEvent(new CustomEvent('ryanai:language-changed', { detail: { language } }));
      window.dispatchEvent(new CustomEvent('ryanai:voice-enabled-changed', { detail: { enabled: voiceEnabled } }));
      setNotice('RyanAI Settings were saved to your authenticated account.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save Settings. Please retry.'); }
    finally { setSaving(false); }
  }


  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingEmail) return;
    if (!supabase) {
      setError('Email updates are unavailable because Supabase authentication is not configured.');
      return;
    }

    const nextEmail = newEmail.trim().toLowerCase();
    if (!nextEmail || nextEmail === email.trim().toLowerCase()) {
      setError('Enter a different email address before requesting a change.');
      return;
    }

    setSavingEmail(true);
    setError('');
    setNotice('');
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ email: nextEmail });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) {
        throw new Error('The identity provider did not confirm this email-change request.');
      }
      setNewEmail('');
      setNotice('Email change request accepted. Complete the verification steps from your authentication provider before the new address becomes active.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request an email change. Please retry.');
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;
    if (!supabase) {
      setError('Password updates are unavailable because Supabase authentication is not configured.');
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password to confirm this change.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Use a password with at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }

    setSavingPassword(true);
    setError('');
    setNotice('');
    try {
      const { data: identity, error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) throw signInError;
      if (!identity.user || identity.user.id !== userId) throw new Error('The identity provider could not re-verify this account.');
      const { data, error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) {
        throw new Error('The identity provider did not confirm this password update.');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password update confirmed by Supabase Auth.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your password. Please retry.');
    } finally {
      setSavingPassword(false);
    }
  }

  async function signOutOtherDevices() {
    if (revokingSessions) return;
    if (!supabase) {
      setError('Session management is unavailable because Supabase authentication is not configured.');
      return;
    }

    setRevokingSessions(true);
    setError('');
    setNotice('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
      if (signOutError) throw signOutError;
      setNotice('Other refresh-token sessions have been invalidated. This device remains signed in.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out other devices. Please retry.');
    } finally {
      setRevokingSessions(false);
    }
  }

  const dashboardOptions = DASHBOARD_UI_OPTIONS.filter(({ id }) => !['audiobook', 'inferenceConsole'].includes(id));
  return <section className="mx-auto max-w-6xl space-y-6 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="profile-settings-title">
    <header><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Account</p><h1 id="profile-settings-title" className="mt-2 text-3xl font-bold text-white">Settings</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Manage dashboard visibility, your RyanAI profile, module preferences, GitHub authorization and inference defaults. Privileged access remains server-enforced.</p></header>
    {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}
    <PluginIntegrationsSettings userId={userId} initialPreferences={initialPluginPreferences} isAdmin={isAdmin} isOwner={isOwner} />
    <form onSubmit={saveSettings} className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="dashboard-ui-title">
        <div className="mb-5 flex items-center gap-3"><LayoutDashboard className="h-5 w-5 text-cyan-300" /><div><h2 id="dashboard-ui-title" className="font-semibold text-white">Dashboard UI options</h2><p className="mt-1 text-xs text-slate-400">Choose which workspaces appear in navigation and dashboard shortcuts. Settings always stays available.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2">{dashboardOptions.map(option => { const access = 'access' in option ? option.access : undefined; const permitted = canManage(option.id); return <label key={option.id} className={`flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 ${permitted ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <input type="checkbox" data-testid={`ui-toggle-${option.id}`} checked={dashboardUi[option.id]} disabled={!permitted || saving} onChange={event => changeModule(option.id, event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" />
          <span><span className="block text-sm font-medium text-slate-200">{option.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>{!permitted && <span className="mt-1 block text-[11px] text-amber-300">Requires {access} access; preferences cannot grant access.</span>}</span>
        </label>; })}</div>
      </section>
      <section className="rounded-2xl border border-violet-300/20 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="copilot-settings-title">
        <div className="mb-5 flex items-center gap-3"><BrainCircuit className="h-5 w-5 text-violet-300" /><div><h2 id="copilot-settings-title" className="font-semibold text-white">Copilot preferences</h2><p className="mt-1 text-xs text-slate-400">Control the Alex status panel, task delegation panel and status refresh cadence on the Copilot workspace.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200"><input data-testid="copilot-show-alex-status" type="checkbox" checked={copilotSettings.showAlexStatus} onChange={event => setCopilotSettings(current => ({ ...current, showAlexStatus: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-violet-400" /><span><span className="block font-medium">Show Alex operational status</span><span className="mt-1 block text-xs leading-5 text-slate-500">When enabled, Copilot reads the authenticated PA observer status. Hiding the panel also stops its periodic polling.</span></span></label>
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200"><input data-testid="copilot-show-delegation-panel" type="checkbox" checked={copilotSettings.showDelegationPanel} onChange={event => setCopilotSettings(current => ({ ...current, showDelegationPanel: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-violet-400" /><span><span className="block font-medium">Show task delegation panel</span><span className="mt-1 block text-xs leading-5 text-slate-500">Show the existing human-controlled Ryan–Alex delegation surface. This preference does not grant task or execution permissions.</span></span></label>
        </div>
        <label className="mt-4 block max-w-xl text-sm text-slate-300">Alex status refresh interval
          <select data-testid="copilot-refresh-interval" value={copilotSettings.refreshIntervalSeconds} disabled={!copilotSettings.showAlexStatus} onChange={event => setCopilotSettings(current => ({ ...current, refreshIntervalSeconds: Number(event.target.value) as CopilotSettings['refreshIntervalSeconds'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white disabled:opacity-50">
            <option value={15}>Every 15 seconds</option><option value={30}>Every 30 seconds</option><option value={60}>Every 60 seconds</option>
          </select>
        </label>
        <p className="mt-3 text-xs text-slate-500">Preferences are stored in authenticated account metadata. Gen-X remains the authority for all actions, and voice remains user-initiated.</p>
      </section>
      <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="phonelink-settings-title">
        <div className="mb-5 flex items-center gap-3"><Smartphone className="h-5 w-5 text-cyan-300" /><div><h2 id="phonelink-settings-title" className="font-semibold text-white">PhoneLink preferences</h2><p className="mt-1 text-xs text-slate-400">Account defaults for trusted phone connections. Native capabilities still require Android permission and companion support.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['autoReconnect','Reconnect trusted devices automatically'],
            ['wifiOnlyTransfers','Prefer Wi-Fi for file transfers'],
            ['notifyComms','Receive RyanAI Comms notifications'],
            ['notifyTasks','Receive Studio task updates'],
            ['allowShareIntake','Allow user-initiated Android share intake'],
            ['requireConfirmation','Require confirmation for sensitive actions'],
            ['quietHoursEnabled','Enable notification quiet hours'],
          ] as const).map(([key,label]) => <label key={key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200"><input type="checkbox" checked={phoneLinkSettings[key]} onChange={event => setPhoneLinkSettings(current => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />{label}</label>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-300">Quiet hours start<input type="time" value={phoneLinkSettings.quietHoursStart} disabled={!phoneLinkSettings.quietHoursEnabled} onChange={event => setPhoneLinkSettings(current => ({ ...current, quietHoursStart: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 p-2.5 disabled:opacity-50" /></label>
          <label className="text-sm text-slate-300">Quiet hours end<input type="time" value={phoneLinkSettings.quietHoursEnd} disabled={!phoneLinkSettings.quietHoursEnabled} onChange={event => setPhoneLinkSettings(current => ({ ...current, quietHoursEnd: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 p-2.5 disabled:opacity-50" /></label>
        </div>
        <p className="mt-3 text-xs text-slate-500">These preferences are saved to your authenticated RyanAI account. They do not grant access to SMS, calls, clipboard, location or other apps.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="profile-management-title">
        <div className="mb-5 flex items-center gap-3"><UserRound className="h-5 w-5 text-cyan-300" /><div><h2 id="profile-management-title" className="font-semibold text-white">Profile management & access control</h2><p className="mt-1 text-xs text-slate-400">Edit personal identity and preferences. Roles are assigned separately by authorised administrators.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-slate-300">Display name<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={100} autoComplete="name" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /><span className="mt-1 block text-[11px] text-slate-500">Used for your RyanAI workspace identity.</span></label><label className="block text-sm text-slate-300">Signed-in email<input value={email} readOnly aria-readonly="true" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-400" /><span className="mt-1 block text-[11px] text-slate-500">Email changes remain managed by the authentication provider.</span></label></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-[11px] uppercase tracking-wider text-slate-500">Assigned access role</p><p className="mt-1 text-sm font-semibold text-cyan-100">{roleLabel}</p><p className="mt-1 text-xs text-slate-500">Read-only. Role and owner claims cannot be edited here.</p></div><div className="rounded-xl border border-white/10 bg-slate-950/60 p-3"><p className="text-[11px] uppercase tracking-wider text-slate-500">Account reference</p><p className="mt-1 break-all text-sm text-slate-200">{userId}</p></div></div>
        <div className="mt-5 border-t border-white/10 pt-5"><div className="mb-4 flex items-center gap-3"><Globe2 className="h-5 w-5 text-cyan-300" /><div><h3 className="font-semibold text-white">Language preferences</h3><p className="mt-1 text-xs text-slate-400">Preferred language for voice input and responses where supported.</p></div></div><label className="block max-w-xl text-sm text-slate-300">Preferred language<select value={language} onChange={event => setLanguage(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white"><optgroup label="South African languages">{RYANAI_LANGUAGES.filter(item => item.region === 'South Africa').map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup><optgroup label="International languages">{RYANAI_LANGUAGES.filter(item => item.region === 'International').map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup></select></label></div>
        <div className="mt-5 border-t border-white/10 pt-5"><div className="mb-4 flex items-center gap-3"><Volume2 className="h-5 w-5 text-cyan-300" /><div><h3 className="font-semibold text-white">Voice preferences</h3><p className="mt-1 text-xs text-slate-400">Control automatic spoken greetings.</p></div></div><label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="voice-enabled-toggle" checked={voiceEnabled} onChange={event => setVoiceEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><span className="block text-sm font-medium text-slate-200">Speak my RyanAI welcome greeting</span><span className="mt-1 block text-xs leading-5 text-slate-500">Voice availability depends on device and language.</span></span></label></div>
        <div className="mt-5 border-t border-white/10 pt-5" aria-labelledby="copilot-behavior-settings-title"><div className="mb-4 flex items-center gap-3"><BrainCircuit className="h-5 w-5 text-cyan-300" /><div><h3 id="copilot-behavior-settings-title" className="font-semibold text-white">Copilot preferences</h3><p className="mt-1 text-xs text-slate-400">Set RyanAI's conversational style, response depth, initiative and collaboration defaults. These preferences never grant tool or action permissions.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-slate-300">Personality<select data-testid="copilot-personality" value={copilotSettings.personality} disabled={saving} onChange={event => setCopilotSettings(current => ({ ...current, personality: event.target.value as CopilotSettings['personality'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{COPILOT_PERSONALITIES.map(value => <option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label><label className="block text-sm text-slate-300">Response detail<select data-testid="copilot-response-style" value={copilotSettings.responseStyle} disabled={saving} onChange={event => setCopilotSettings(current => ({ ...current, responseStyle: event.target.value as CopilotSettings['responseStyle'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{COPILOT_RESPONSE_STYLES.map(value => <option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label><label className="block text-sm text-slate-300">Initiative level<select data-testid="copilot-initiative" value={copilotSettings.initiative} disabled={saving} onChange={event => setCopilotSettings(current => ({ ...current, initiative: event.target.value as CopilotSettings['initiative'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{COPILOT_INITIATIVE_LEVELS.map(value => <option key={value} value={value}>{value==='ask-first'?'Ask first':value[0].toUpperCase()+value.slice(1)}</option>)}</select></label><label className="block text-sm text-slate-300">Collaboration mode<select data-testid="copilot-collaboration" value={copilotSettings.collaboration} disabled={saving} onChange={event => setCopilotSettings(current => ({ ...current, collaboration: event.target.value as CopilotSettings['collaboration'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{COPILOT_COLLABORATION_MODES.map(value => <option key={value} value={value}>{value==='independent'?'Independent': 'Collaborative'}</option>)}</select></label></div><label className="mt-4 flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="copilot-account-memory" checked={copilotSettings.useAccountMemory} disabled={saving} onChange={event => setCopilotSettings(current => ({ ...current, useAccountMemory: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><span className="block text-sm font-medium text-slate-200">Use account memory as conversational context</span><span className="mt-1 block text-xs leading-5 text-slate-500">This preference controls Copilot context use only. It does not delete stored records or change account memory retention.</span></span></label></div><div className="mt-5 border-t border-white/10 pt-5" aria-labelledby="ryan-identity-title"><div className="mb-4 flex items-center gap-3"><BrainCircuit className="h-5 w-5 text-violet-300" /><div><h3 id="ryan-identity-title" className="font-semibold text-white">RyanAI anniversary voice identity</h3><p className="mt-1 text-xs text-slate-400">A persistent identity profile with annual delivery-style evolution.</p></div></div><div className="rounded-xl border border-violet-300/15 bg-violet-300/5 p-4"><p className="text-sm font-semibold text-violet-100">{RYANAI_IDENTITY_NAME}</p><p className="mt-1 text-xs text-slate-400">Born {RYANAI_BIRTH_DATE} · {anniversaryInfo.years} years, {anniversaryInfo.months} months old</p><p className="mt-1 text-xs text-slate-400">Next anniversary: {anniversaryInfo.nextAnniversary}</p></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block text-sm text-slate-300">Realtime voice preset<select data-testid="ryanai-realtime-voice" value={ryanVoiceSettings.realtimeVoice} disabled={saving} onChange={event => setRyanVoiceSettings(current => ({ ...current, realtimeVoice: event.target.value as RyanVoiceSettings['realtimeVoice'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{RYANAI_REALTIME_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}</select><span className="mt-1 block text-[11px] text-slate-500">Ash is the default. Voice timbre varies by provider preset; changes apply to the next voice session.</span></label><label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="ryanai-anniversary-evolution" checked={ryanVoiceSettings.anniversaryEvolution} disabled={saving} onChange={event => setRyanVoiceSettings(current => ({ ...current, anniversaryEvolution: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-violet-400" /><span><span className="block text-sm font-medium text-slate-200">Evolve Ryan's voice style every 24 May</span><span className="mt-1 block text-xs leading-5 text-slate-500">Annual changes affect adult vocal delivery and personality instructions. The voice remains synthetic and adult-presenting.</span></span></label></div><p className="mt-3 text-xs leading-5 text-slate-500">RyanAI uses an adult masculine-presenting voice, not a child voice. The anniversary date controls RyanAI's identity and annual delivery style; it does not change a real person's age or guarantee a new provider timbre.</p></div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="studio-profile-title"><div className="mb-4 flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-300" /><div><h2 id="studio-profile-title" className="font-semibold text-white">RyanAI Studio profile & session</h2><p className="mt-1 text-xs text-slate-400">Studio uses the same authenticated RyanAI account; it has no separate credential store.</p></div></div><div className="rounded-xl border border-white/10 bg-slate-950/60 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-white">Signed in as {displayName || email || 'RyanAI user'}</p><p className="mt-1 text-xs text-slate-500">{email} · {roleLabel} access</p></div><a href="#/studio" className="rounded-lg border border-cyan-300/20 px-3 py-2 text-xs font-semibold text-cyan-100">Open RyanAI Studio</a></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><p className="max-w-xl text-xs leading-5 text-slate-500">Sign in and sign up are shared with the RyanAI account gateway. Sign out to switch accounts or return to the sign-in/sign-up screen.</p><button type="button" onClick={onSignOut} disabled={!onSignOut || signingOut} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50"><LogOut className="h-4 w-4" />{signingOut ? 'Signing out…' : 'Sign out'}</button></div></div><p className="mt-3 text-xs leading-5 text-slate-500">Roles, account suspension and privileged permissions remain server-side. Preferences cannot grant Studio, Admin or Owner access.</p></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="programming-settings-title"><div className="mb-4 flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-300" /><div><h2 id="programming-settings-title" className="font-semibold text-white">Basic Programming Tools</h2><p className="mt-1 text-xs text-slate-400">Show or hide the coding, research, project and development toolbox.</p></div></div><label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="programming-enabled-toggle" checked={dashboardUi.programming} disabled={saving} onChange={event => changeModule('programming', event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span className="text-sm text-slate-200">Enable Basic Programming Tools</span></label></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="audiobook-settings-title"><div className="mb-4 flex items-center gap-3"><BookAudio className="h-5 w-5 text-cyan-300" /><div><h2 id="audiobook-settings-title" className="font-semibold text-white">Audiobooks</h2><p className="mt-1 text-xs text-slate-400">Manage Audiobook Studio visibility and default narration settings.</p></div></div><label className="mb-4 flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="audiobook-enabled-toggle" checked={dashboardUi.audiobook} disabled={saving} onChange={event => changeModule('audiobook', event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span className="text-sm text-slate-200">Enable Audiobook Studio</span></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-slate-300">Default narration voice<select data-testid="audiobook-default-voice" value={audiobookSettings.defaultVoice} disabled={saving} onChange={event => setAudiobookSettings(current => ({ ...current, defaultVoice: event.target.value as typeof current.defaultVoice }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{AUDIOBOOK_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}</select></label><label className="block text-sm text-slate-300">Default narration speed<select value={String(audiobookSettings.narrationSpeed)} disabled={saving} onChange={event => setAudiobookSettings(current => ({ ...current, narrationSpeed: Number(event.target.value) as typeof current.narrationSpeed }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{AUDIOBOOK_SPEEDS.map(speed => <option key={speed} value={speed}>{speed.toFixed(1)}×</option>)}</select></label></div></section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="music-settings-title">
        <div className="mb-4 flex items-center gap-3"><Volume2 className="h-5 w-5 text-cyan-300" /><div><h2 id="music-settings-title" className="font-semibold text-white">Music & VLC preferences</h2><p className="mt-1 text-xs text-slate-400">Choose VLC, control playback preferences, and decide how your local music library and playlists are saved.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-300">Default music provider<select data-testid="music-default-provider" value={musicSettings.defaultProvider} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, defaultProvider: event.target.value as MusicSettings['defaultProvider'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="vlc">VLC</option><option value="spotify">Spotify</option><option value="youtube-music">YouTube Music</option></select></label>
          <label className="block text-sm text-slate-300">VLC playback mode<select data-testid="vlc-playback-mode" value={musicSettings.vlcMode} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, vlcMode: event.target.value as MusicSettings['vlcMode'] }))} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="both">External VLC + RyanAI embedded player</option><option value="external">Control/open installed VLC app</option><option value="embedded">RyanAI embedded playback</option></select></label>
          <label className="block text-sm text-slate-300">Default playback volume<input data-testid="music-volume" type="range" min="0" max="100" value={musicSettings.volume} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, volume: Number(event.target.value) }))} className="mt-3 w-full accent-cyan-400" /><span className="text-xs text-slate-500">{musicSettings.volume}%</span></label>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-200"><input data-testid="music-remember-provider" type="checkbox" checked={musicSettings.rememberPreferredProvider} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, rememberPreferredProvider: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />Remember preferred provider</label>
            <label className="flex items-center gap-2 text-sm text-slate-200"><input data-testid="music-resume-playback" type="checkbox" checked={musicSettings.resumePlayback} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, resumePlayback: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />Resume playback preference</label>
            <label className="flex items-center gap-2 text-sm text-slate-200"><input data-testid="music-auto-save-library" type="checkbox" checked={musicSettings.autoSaveLibrary} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, autoSaveLibrary: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />Automatically save uploaded music on this device</label>
            <label className="flex items-center gap-2 text-sm text-slate-200"><input data-testid="music-auto-save-playlists" type="checkbox" checked={musicSettings.autoSavePlaylists} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, autoSavePlaylists: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />Automatically save playlist changes</label>
            <label className="flex items-center gap-2 text-sm text-slate-200"><input data-testid="music-restore-playlist" type="checkbox" checked={musicSettings.restoreLastPlaylist} disabled={saving} onChange={event => setMusicSettings(current => ({ ...current, restoreLastPlaylist: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />Restore last playlist on return</label>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-amber-200/80">VLC handoff is available through Android’s file share sheet. Saved audio and playlists remain in this browser profile (IndexedDB); they do not sync across devices. VLC remote control and external playback-state reporting are not connected.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="github-settings-title"><div className="mb-4 flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-300" /><div><h2 id="github-settings-title" className="font-semibold text-white">GitHub authorization & access</h2><p className="mt-1 text-xs text-slate-400">Authorize, connect, verify or disconnect your GitHub account.</p></div></div><p className="text-sm leading-6 text-slate-400">RyanAI verifies GitHub identity and repository access before reporting a connection as active. This integration provides status/read access only, not write, merge or deployment authority.</p><button type="button" onClick={() => setGithubOpen(true)} className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-4 py-2.5 text-sm font-semibold text-cyan-100">Open GitHub connection settings</button></section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="inference-settings-title"><div className="mb-4 flex items-center gap-3"><BrainCircuit className="h-5 w-5 text-cyan-300" /><div><h2 id="inference-settings-title" className="font-semibold text-white">Inference Console settings</h2><p className="mt-1 text-xs text-slate-400">Control Workspace console visibility and choose its default model.</p></div></div><label className="mb-4 flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3"><input type="checkbox" data-testid="inference-console-enabled-toggle" checked={dashboardUi.inferenceConsole} disabled={saving} onChange={event => changeModule('inferenceConsole', event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span className="text-sm text-slate-200">Enable Inference Console in Workspace</span></label><label className="block max-w-xl text-sm text-slate-300">Preferred default model<select data-testid="inference-default-model" value={inferenceSettings.preferredModel} disabled={saving} onChange={event => setInferenceSettings({ preferredModel: event.target.value })} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">{getAvailableModels().map(model => <option key={model.id} value={model.id}>{model.label} · {model.provider}</option>)}</select></label><p className="mt-3 text-xs leading-5 text-slate-500">The chosen model is the console's initial selection. Provider availability and authorization remain controlled by RyanAI API policy.</p></section>
      <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4"><h2 className="text-sm font-semibold text-cyan-100">Credential and permission safety</h2><p className="mt-1 text-xs leading-5 text-slate-400">Provider API keys, GitHub client secrets, access tokens and encryption keys are never displayed or edited here. Roles and privileged access cannot be changed through account preferences.</p></section>
      <div className="flex justify-end"><button type="submit" disabled={saving || !isRyanLanguage(language) || !Object.hasOwn(MODELS, inferenceSettings.preferredModel)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving Settings…' : 'Save all Settings'}</button></div>
    </form>
    <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="account-security-title">
      <div className="mb-4 flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-cyan-300" /><div><h2 id="account-security-title" className="font-semibold text-white">Account security</h2><p className="mt-1 text-xs text-slate-400">Email and password changes are verified by Supabase Auth.</p></div></div>
      <form onSubmit={requestEmailChange} className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block text-sm text-slate-300">New email address<input type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <button type="submit" disabled={savingEmail || !newEmail.trim()} className="self-end rounded-lg border border-cyan-300/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50">{savingEmail ? 'Requesting…' : 'Request email change'}</button>
      </form>
      <form onSubmit={changePassword} className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">Current password<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <label className="block text-sm text-slate-300">New password<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} autoComplete="new-password" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <label className="block text-sm text-slate-300 sm:col-span-2">Confirm new password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} autoComplete="new-password" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" /></label>
        <button type="submit" disabled={savingPassword || !currentPassword || newPassword.length < 12 || newPassword !== confirmPassword} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50 sm:col-span-2"><LockKeyhole className="h-4 w-4" />{savingPassword ? 'Updating…' : 'Update password'}</button>
      </form>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-5">
        <div><h3 className="text-sm font-medium text-slate-200">Other signed-in devices</h3><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">Invalidate other refresh-token sessions while keeping this device signed in. Previously issued access tokens may remain valid until they expire.</p></div>
        <button type="button" onClick={() => void signOutOtherDevices()} disabled={revokingSessions} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"><LogOut className="h-4 w-4" />{revokingSessions ? 'Signing out…' : 'Sign out other devices'}</button>
      </div>
    </section>
    <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4">
      <h2 className="text-sm font-semibold text-cyan-100">Provider and integration security</h2>
      <p className="mt-1 text-xs leading-5 text-slate-400">Provider credentials, billing settings, administrator roles, owner claims and external integration secrets are not editable here. Account deletion requires a verified server-side process and is not exposed as a client-side action.</p>
    </section>
    <GithubModal open={githubOpen} onClose={() => setGithubOpen(false)} />
  </section>;
}
