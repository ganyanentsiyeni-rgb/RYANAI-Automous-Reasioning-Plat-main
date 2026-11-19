import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type PluginCategory = 'Workflows' | 'PA Agent' | 'Communications' | 'Knowledge & files' | 'Engineering' | 'Research' | 'Media & audio';
type PluginPreference = { enabled: boolean; scopes: string[] };
type Preferences = Record<string, PluginPreference>;
type RegistryProvider = { id: string; adapterStatus: 'adapter_required' | 'adapter_registered' };
type GitHubIntegrationStatus = { status: string; connected?: boolean; account?: { login?: string }; repository?: { fullName?: string } };
type CalendarEvent = { id: string | null; title: string; start: string | null; end: string | null; location: string | null; organizer: string | null };
type GmailMessage = { id: string; threadId: string | null; snippet: string; receivedAt: string | null; from: string | null; subject: string | null };
type ProviderConnection = {
  providerId: string;
  status: string;
  connectionState: string;
  credentialState: string;
  healthState: string;
  lastHealthCheckAt: string | null;
};
type PluginDefinition = {
  id: string; name: string; category: PluginCategory; description: string;
  scopes: string[]; access?: 'admin' | 'owner';
  availability: 'adapter-required' | 'native-planned' | 'oauth-supported';
};

const OAUTH_PROVIDER_IDS: Record<string, string> = {
  'google-calendar': 'google-calendar',
  'microsoft-calendar': 'microsoft-365-calendar',
  gmail: 'gmail',
};
const CATALOG: PluginDefinition[] = [
  { id: 'phonelink', name: 'RyanAI PhoneLink', category: 'Communications', description: 'Trusted mobile device pairing and permission-scoped event intake. Native device operations require the Android companion.', scopes: ['Mobile workspace', 'Approved event intake'], availability: 'adapter-required' },
  { id: 'github', name: 'GitHub', category: 'Engineering', description: 'Repository context, issues, pull requests and CI evidence.', scopes: ['PA Agent', 'Engineering workers'], availability: 'adapter-required' },
  { id: 'vscode-web', name: 'Visual Studio Code for the Web', category: 'Engineering', description: 'Open the RyanAI repository in the browser-based VS Code editor. GitHub sign-in and repository permissions are handled by GitHub.', scopes: ['RyanAI Studio', 'Engineering'], availability: 'native-planned' },
  { id: 'jetbrains', name: 'JetBrains IDEs', category: 'Engineering', description: 'IntelliJ IDEA, PyCharm and other desktop IDEs. External app handoff; no remote IDE control is enabled.', scopes: ['RyanAI Studio'], availability: 'native-planned' },
  { id: 'sublime-vim', name: 'Sublime Text / Vim', category: 'Engineering', description: 'Lightweight local editors. Open externally; RyanAI does not control local applications.', scopes: ['Developer workspace'], availability: 'native-planned' },
  { id: 'replit', name: 'Replit', category: 'Engineering', description: 'Browser-based coding workspace. Account connection and project execution are not provided by this catalogue entry.', scopes: ['Developer workspace'], availability: 'native-planned' },
  { id: 'gitlab', name: 'GitLab', category: 'Engineering', description: 'Repository hosting and collaboration. A reviewed OAuth/API adapter is required before account data can be accessed.', scopes: ['Engineering workers'], availability: 'adapter-required' },
  { id: 'bitbucket', name: 'Bitbucket', category: 'Engineering', description: 'Repository hosting and code review. A reviewed OAuth/API adapter is required before account data can be accessed.', scopes: ['Engineering workers'], availability: 'adapter-required' },
  { id: 'postman', name: 'Postman', category: 'Engineering', description: 'API request collections and testing. External handoff only; no collection sync adapter is registered.', scopes: ['API testing'], availability: 'native-planned' },
  { id: 'docker', name: 'Docker', category: 'Engineering', description: 'Container tooling and local environment workflows. Runtime control requires an explicitly reviewed adapter.', scopes: ['Development environments'], availability: 'adapter-required' },
  { id: 'jira', name: 'Jira', category: 'Workflows', description: 'Issues, backlogs and sprint planning. A provider adapter is required for issue synchronisation.', scopes: ['Engineering workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'drawio', name: 'draw.io', category: 'Engineering', description: 'Architecture diagrams and flowcharts. Opens the external diagram editor; no file sync is implied.', scopes: ['Technical documentation'], availability: 'native-planned' },
  { id: 'miro', name: 'Miro', category: 'Workflows', description: 'Collaborative visual whiteboards. Account data requires a reviewed provider adapter.', scopes: ['Workforce'], availability: 'adapter-required' },
  { id: 'obsidian', name: 'Obsidian', category: 'Knowledge & files', description: 'Local Markdown notes and project documentation. External app handoff only.', scopes: ['Technical documentation'], availability: 'native-planned' },
  { id: 'discord', name: 'Discord', category: 'Communications', description: 'Team and community communication. Message access requires a reviewed bot/API adapter.', scopes: ['Comms workers'], availability: 'adapter-required' },
  { id: 'vlc', name: 'VLC Media Player', category: 'Media & audio', description: 'Planned external VLC app handoff and embedded media playback through separately reviewed adapters.', scopes: ['Music UI', 'RyanAI Studio'], availability: 'adapter-required' },
  { id: 'spotify', name: 'Spotify', category: 'Media & audio', description: 'Optional music provider; playback requires provider authorization and a reviewed adapter.', scopes: ['Music UI'], availability: 'adapter-required' },
  { id: 'youtube-music', name: 'YouTube Music', category: 'Media & audio', description: 'Optional music provider; playback requires provider authorization and a reviewed adapter.', scopes: ['Music UI'], availability: 'adapter-required' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'PA Agent', description: 'Calendar context, availability and scheduling workflows.', scopes: ['PA Agent', 'Scheduling workers'], availability: 'oauth-supported' },
  { id: 'microsoft-calendar', name: 'Microsoft 365 Calendar', category: 'PA Agent', description: 'Outlook calendar context and scheduling workflows.', scopes: ['PA Agent', 'Scheduling workers'], availability: 'oauth-supported' },
  { id: 'gmail', name: 'Gmail', category: 'Communications', description: 'Read-only mailbox search and message metadata. Drafting and sending are not enabled.', scopes: ['Gmail read-only'], availability: 'oauth-supported' },
  { id: 'outlook-mail', name: 'Outlook Mail', category: 'Communications', description: 'Mailbox context, drafting and explicitly approved dispatch.', scopes: ['PA Agent', 'Comms workers'], availability: 'adapter-required' },
  { id: 'slack', name: 'Slack', category: 'Communications', description: 'Team messages, channels and human-reviewed workflows.', scopes: ['Comms workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', category: 'Communications', description: 'Team collaboration and approved message workflows.', scopes: ['Comms workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'whatsapp-business', name: 'WhatsApp Business', category: 'Communications', description: 'Business messaging through an approved provider adapter.', scopes: ['Comms workers'], access: 'owner', availability: 'adapter-required' },
  { id: 'twilio', name: 'Twilio', category: 'Communications', description: 'SMS and voice provider connectivity; outbound actions require human approval.', scopes: ['Comms workers'], access: 'owner', availability: 'adapter-required' },
  { id: 'notion', name: 'Notion', category: 'Knowledge & files', description: 'Workspace pages, knowledge retrieval and approved updates.', scopes: ['PA Agent', 'Knowledge workers'], availability: 'adapter-required' },
  { id: 'dropbox', name: 'Dropbox', category: 'Knowledge & files', description: 'Authorised file discovery and document retrieval.', scopes: ['PA Agent', 'Knowledge workers'], availability: 'adapter-required' },
  { id: 'sharepoint', name: 'SharePoint', category: 'Knowledge & files', description: 'Enterprise document and knowledge access.', scopes: ['Knowledge workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'asana', name: 'Asana', category: 'Workflows', description: 'Project tasks, assignments and status synchronisation.', scopes: ['Workforce', 'PA Agent'], availability: 'adapter-required' },
  { id: 'linear', name: 'Linear', category: 'Workflows', description: 'Engineering issue tracking and workflow handoffs.', scopes: ['Engineering workers', 'Workforce'], availability: 'adapter-required' },
  { id: 'trello', name: 'Trello', category: 'Workflows', description: 'Boards, cards and lightweight task automation.', scopes: ['Workforce', 'PA Agent'], availability: 'adapter-required' },
  { id: 'zapier', name: 'Zapier', category: 'Workflows', description: 'External workflow triggers and action orchestration.', scopes: ['Workflow engine'], availability: 'adapter-required' },
  { id: 'firecrawl', name: 'Firecrawl', category: 'Research', description: 'Structured web research and page extraction.', scopes: ['PA Agent', 'Research workers'], availability: 'adapter-required' },
  { id: 'browser-automation', name: 'Browser automation / MCP', category: 'Research', description: 'Controlled browser tools exposed through reviewed MCP adapters.', scopes: ['PA Agent', 'Research workers'], availability: 'adapter-required' },
];
const CATEGORIES: Array<'All' | PluginCategory> = ['All', 'Workflows', 'PA Agent', 'Communications', 'Knowledge & files', 'Engineering', 'Research', 'Media & audio'];
const REAUTHORIZATION_STATES = new Set(['reauthorization_required', 'access_expired_reauthorization_required']);

function normalizePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: Preferences = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as { enabled?: unknown; scopes?: unknown };
    normalized[id] = {
      enabled: item.enabled === true,
      scopes: Array.isArray(item.scopes)
        ? item.scopes.filter((scope): scope is string => typeof scope === 'string' && scope.length <= 80).slice(0, 12)
        : [],
    };
  }
  return normalized;
}

function connectionLabel(connection?: ProviderConnection): string {
  if (!connection) return 'Not connected';
  if (REAUTHORIZATION_STATES.has(connection.credentialState)) return 'Reauthorization required';
  if (connection.credentialState === 'access_expired_refresh_available') return 'Access expired · refresh available';
  if (connection.connectionState === 'revocation_pending' || connection.status === 'revocation_pending') return 'Remote revocation pending';
  if (connection.connectionState === 'revoked' || connection.status === 'revoked' || connection.credentialState === 'disconnected') return 'Disconnected';
  if (connection.connectionState === 'connected') return 'Connected · provider health not checked';
  return connection.connectionState.replaceAll('_', ' ');
}

interface Props {
  userId: string;
  initialPreferences?: unknown;
  isAdmin?: boolean;
  isOwner?: boolean;
}

export default function PluginIntegrationsSettings(props: Props) {
  const preferenceKey = JSON.stringify(normalizePreferences(props.initialPreferences));
  return <PluginIntegrationsSettingsContent key={`${props.userId}:${preferenceKey}`} {...props} />;
}

function PluginIntegrationsSettingsContent({
  userId, initialPreferences, isAdmin = false, isOwner = false,
}: Props) {
  const [preferences, setPreferences] = useState<Preferences>(() => normalizePreferences(initialPreferences));
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<Record<string, CalendarEvent[]>>({});
  const [calendarLoadingId, setCalendarLoadingId] = useState('');
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);
  const [gmailQuery, setGmailQuery] = useState('');
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const [gmailLoaded, setGmailLoaded] = useState(false);
  const [calendarErrors, setCalendarErrors] = useState<Record<string, string>>({});
  const [registryProviders, setRegistryProviders] = useState<RegistryProvider[]>([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState('');
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionBusyId, setConnectionBusyId] = useState('');
  const [githubStatus, setGithubStatus] = useState<GitHubIntegrationStatus>({ status: 'checking' });
  const [githubBusy, setGithubBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [connectionNotice, setConnectionNotice] = useState('');
  const connectionRequestId = useRef(0);
  const registryRequestId = useRef(0);
  const githubRequestId = useRef(0);

  const loadConnections = useCallback(async () => {
    const requestId = ++connectionRequestId.current;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    setConnectionsLoading(true);
    try {
      const response = await authenticatedFetch('/api/plugins/connections', { headers: { Accept: 'application/json' }, signal: controller.signal }, userId);
      const payload = await response.json().catch(() => ({})) as { connections?: ProviderConnection[]; error?: string };
      if (!response.ok || !Array.isArray(payload.connections)) throw new Error(payload.error || 'Provider connection status is unavailable.');
      if (requestId !== connectionRequestId.current) return;
      setConnections(payload.connections);
      setConnectionError('');
    } catch (cause) {
      if (requestId === connectionRequestId.current) {
        setConnections([]);
        setConnectionError(controller.signal.aborted ? 'Provider connection status request timed out.' : cause instanceof Error ? cause.message : 'Provider connection status is unavailable.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === connectionRequestId.current) setConnectionsLoading(false);
    }
  }, [userId]);

  const loadGitHubStatus = useCallback(async () => {
    const requestId = ++githubRequestId.current;
    try {
      const response = await authenticatedFetch('/api/github/status', { headers: { Accept: 'application/json' } }, userId);
      const payload = await response.json().catch(() => ({})) as GitHubIntegrationStatus;
      if (!response.ok || typeof payload.status !== 'string') throw new Error('GitHub status is unavailable.');
      if (requestId === githubRequestId.current) setGithubStatus(payload);
    } catch {
      if (requestId === githubRequestId.current) setGithubStatus({ status: 'unverified', connected: false });
    }
  }, [userId]);

  const loadRegistry = useCallback(async () => {
    const requestId = ++registryRequestId.current;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    setRegistryLoading(true);
    try {
      const response = await authenticatedFetch('/api/plugins/registry', { headers: { Accept: 'application/json' }, signal: controller.signal }, userId);
      const payload = await response.json().catch(() => ({})) as { providers?: RegistryProvider[]; error?: string };
      if (!response.ok || !Array.isArray(payload.providers)) throw new Error(payload.error || 'Backend plugin registry is unavailable.');
      if (requestId === registryRequestId.current) {
        setRegistryProviders(payload.providers.filter(provider => provider && typeof provider.id === 'string' &&
          (provider.adapterStatus === 'adapter_required' || provider.adapterStatus === 'adapter_registered')));
        setRegistryError('');
      }
    } catch (cause) {
      if (requestId === registryRequestId.current) {
        setRegistryProviders([]);
        setRegistryError(controller.signal.aborted ? 'Backend plugin registry request timed out.' : cause instanceof Error ? cause.message : 'Backend plugin registry is unavailable.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === registryRequestId.current) setRegistryLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadConnections();
      void loadRegistry();
      void loadGitHubStatus();
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      connectionRequestId.current += 1;
      registryRequestId.current += 1;
      githubRequestId.current += 1;
    };
  }, [loadConnections, loadRegistry, loadGitHubStatus]);

  const visible = useMemo(() => CATALOG.filter(plugin =>
    (category === 'All' || plugin.category === category) &&
    (plugin.name.toLowerCase().includes(query.toLowerCase()) ||
      plugin.description.toLowerCase().includes(query.toLowerCase())),
  ), [category, query]);

  function canRequest(plugin: PluginDefinition) {
    return !plugin.access || (plugin.access === 'admin' ? isAdmin : isOwner);
  }

  function toggle(pluginId: string, enabled: boolean) {
    setPreferences(current => ({
      ...current,
      [pluginId]: {
        enabled,
        scopes: enabled ? (current[pluginId]?.scopes ?? CATALOG.find(item => item.id === pluginId)?.scopes ?? []) : [],
      },
    }));
  }

  async function savePreferences() {
    if (saving) return;
    if (!supabase) {
      setError('Plugin preferences cannot be saved because RyanAI authentication is not configured.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || !identity.user || identity.user.id !== userId) {
        throw new Error('Your RyanAI session could not be verified. Sign in again before saving plugin preferences.');
      }
      const safePreferences: Preferences = {};
      for (const plugin of CATALOG) {
        if (!canRequest(plugin)) continue;
        if (preferences[plugin.id]?.enabled) safePreferences[plugin.id] = { enabled: true, scopes: [...plugin.scopes] };
      }
      const { data, error: updateError } = await supabase.auth.updateUser({
        data: { ryanai_plugin_preferences: safePreferences },
      });
      if (updateError) throw updateError;
      if (!data.user || data.user.id !== userId) throw new Error('The identity provider did not confirm these plugin preferences.');
      setPreferences(safePreferences);
      setNotice('Plugin preferences saved. No provider has been connected and no worker permissions or credentials were granted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save plugin preferences. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  async function connectGitHub() {
    if (githubBusy) return;
    setGithubBusy(true);
    setConnectionError('');
    try {
      const response = await authenticatedFetch('/api/github/connect', {
        method: 'POST', headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || 'GitHub authorization is not configured.');
      const authorizationUrl = new URL(payload.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'github.com' ||
          authorizationUrl.pathname !== '/login/oauth/authorize' || authorizationUrl.username || authorizationUrl.password) {
        throw new Error('The server returned an untrusted GitHub authorization URL.');
      }
      window.location.assign(authorizationUrl.toString());
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : 'Could not start GitHub authorization.');
      setGithubBusy(false);
    }
  }

  async function disconnectGitHub() {
    if (githubBusy) return;
    setGithubBusy(true);
    setConnectionError('');
    setConnectionNotice('');
    try {
      const response = await authenticatedFetch('/api/github/disconnect', {
        method: 'POST', headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as { disconnected?: boolean; error?: string };
      if (!response.ok || payload.disconnected !== true) throw new Error(payload.error || 'GitHub disconnect was not confirmed.');
      setConnectionNotice('GitHub credentials were removed from this RyanAI account. Remote revocation may remain unconfirmed.');
      await loadGitHubStatus();
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : 'Could not disconnect GitHub.');
    } finally {
      setGithubBusy(false);
    }
  }

  async function connectProvider(pluginId: string) {
    const providerId = OAUTH_PROVIDER_IDS[pluginId];
    if (!providerId || connectionBusyId) return;
    setConnectionBusyId(pluginId);
    setConnectionError('');
    setConnectionNotice('');
    try {
      const response = await authenticatedFetch('/api/plugins/' + encodeURIComponent(providerId) + '/connect', {
        method: 'POST', headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || 'Provider authorization is not configured.');
      const authorizationUrl = new URL(payload.authorizationUrl);
      const allowedHost = pluginId === 'google-calendar' || pluginId === 'gmail'
        ? authorizationUrl.hostname === 'accounts.google.com'
        : authorizationUrl.hostname === 'login.microsoftonline.com';
      if (authorizationUrl.protocol !== 'https:' || !allowedHost || authorizationUrl.username || authorizationUrl.password) {
        throw new Error('The server returned an untrusted provider authorization URL.');
      }
      window.location.assign(authorizationUrl.toString());
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : 'Could not start provider authorization.');
      setConnectionBusyId('');
    }
  }

  async function refreshProvider(pluginId: string) {
    const providerId = OAUTH_PROVIDER_IDS[pluginId];
    if (!providerId || connectionBusyId) return;
    setConnectionBusyId(pluginId);
    setConnectionError('');
    setConnectionNotice('');
    try {
      const response = await authenticatedFetch('/api/plugins/' + encodeURIComponent(providerId) + '/refresh', {
        method: 'POST', headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as { refreshed?: boolean; error?: string };
      if (!response.ok || payload.refreshed !== true) throw new Error(payload.error || 'Provider token refresh was not confirmed.');
      setConnectionNotice('Provider access token refreshed. Provider health remains unprobed.');
      await loadConnections();
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : 'Could not refresh provider access.');
      await loadConnections();
    } finally {
      setConnectionBusyId('');
    }
  }

  async function loadCalendarEvents(pluginId: string) {
    const providerId = OAUTH_PROVIDER_IDS[pluginId];
    if (!providerId || calendarLoadingId) return;
    setCalendarLoadingId(pluginId);
    setCalendarErrors(current => ({ ...current, [pluginId]: '' }));
    try {
      const start = new Date();
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '50' });
      const response = await authenticatedFetch('/api/plugins/' + encodeURIComponent(providerId) + '/events?' + params.toString(), { headers: { Accept: 'application/json' } }, userId);
      const payload = await response.json().catch(() => ({})) as { events?: CalendarEvent[]; error?: string };
      if (!response.ok || !Array.isArray(payload.events)) throw new Error(payload.error || 'Calendar events could not be loaded.');
      setCalendarEvents(current => ({ ...current, [pluginId]: payload.events! }));
    } catch (cause) {
      setCalendarErrors(current => ({ ...current, [pluginId]: cause instanceof Error ? cause.message : 'Calendar events could not be loaded.' }));
    } finally {
      setCalendarLoadingId('');
    }
  }
  async function loadGmailMessages() {
    if (gmailLoading) return;
    setGmailLoading(true);
    setGmailError('');
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (gmailQuery.trim()) params.set('q', gmailQuery.trim());
      const response = await authenticatedFetch('/api/plugins/gmail/messages?' + params.toString(), {
        headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as { messages?: GmailMessage[]; error?: string };
      if (!response.ok || !Array.isArray(payload.messages)) throw new Error(payload.error || 'Gmail messages could not be loaded.');
      setGmailMessages(payload.messages);
      setGmailLoaded(true);
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Gmail messages could not be loaded.');
    } finally {
      setGmailLoading(false);
    }
  }

  async function disconnectProvider(pluginId: string) {
    const providerId = OAUTH_PROVIDER_IDS[pluginId];
    if (!providerId || connectionBusyId) return;
    setConnectionBusyId(pluginId);
    setConnectionError('');
    setConnectionNotice('');
    try {
      const response = await authenticatedFetch('/api/plugins/' + encodeURIComponent(providerId) + '/disconnect', {
        method: 'POST', headers: { Accept: 'application/json' },
      }, userId);
      const payload = await response.json().catch(() => ({})) as { disconnected?: boolean; remoteRevocation?: string; error?: string };
      if (!response.ok || payload.disconnected !== true) throw new Error(payload.error || 'Could not disconnect this provider.');
      setConnectionNotice(payload.remoteRevocation === 'confirmed'
        ? 'Provider disconnected and remote revocation confirmed.'
        : 'Local credentials removed. Remote provider revocation remains unconfirmed.');
      await loadConnections();
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : 'Could not disconnect this provider.');
    } finally {
      setConnectionBusyId('');
    }
  }

  return <section id="plugin-integrations" className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-6" aria-labelledby="plugin-integrations-title">
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">RyanAI ecosystem</p>
      <h2 id="plugin-integrations-title" className="mt-1 text-xl font-semibold text-white">Plugin & integrations centre</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Discover the integrations RyanAI workers may need. Preferences, provider authorization and adapter execution are separate capabilities; each provider requires a reviewed adapter, scoped authorization and independent runtime tests.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="text-xs text-slate-400">Search integrations
        <input aria-label="Search integrations" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools, providers or capabilities" className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white" />
      </label>
      <label className="text-xs text-slate-400">Category
        <select aria-label="Plugin category" value={category} onChange={event => setCategory(event.target.value as typeof category)} className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white">
          {CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {visible.map(plugin => {
        const allowed = canRequest(plugin);
        const enabled = canRequest(plugin) && preferences[plugin.id]?.enabled === true;
        const providerId = OAUTH_PROVIDER_IDS[plugin.id];
        const connection = providerId ? connections.find(item => item.providerId === providerId) : undefined;
        const reauthorizationRequired = Boolean(connection && REAUTHORIZATION_STATES.has(connection.credentialState));
        const registry = registryProviders.find(item => item.id === (OAUTH_PROVIDER_IDS[plugin.id] ?? plugin.id));
        const adapterLabel = plugin.id === 'gmail'
          ? 'Read-only mailbox API'
          : registryLoading
            ? 'Checking backend registry…'
            : registryError
              ? 'Registry unavailable'
              : registry?.adapterStatus === 'adapter_registered'
                ? 'Adapter registered'
                : registry
                  ? 'Adapter required'
                  : 'Not in backend registry';
        const connected = connection?.connectionState === 'connected';
        return <article key={plugin.id} data-plugin-id={plugin.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-white">{plugin.name}</h3><p className="mt-1 text-xs text-cyan-200">{plugin.category}</p></div>
            <span className="rounded-full border border-amber-300/20 px-2 py-1 text-[10px] text-amber-200">
              {plugin.availability === 'native-planned' ? 'Browser handoff' : plugin.availability === 'oauth-supported' ? 'OAuth supported' : 'Adapter required'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-500/30 px-2 py-1 text-[10px] text-slate-300">{adapterLabel}</span>
            {plugin.availability === 'oauth-supported' && <span className="rounded-full border border-cyan-300/20 px-2 py-1 text-[10px] text-cyan-100">OAuth supported</span>}
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">{plugin.description}</p>
          {plugin.id === 'github' && <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-300">
                {githubStatus.status === 'connected'
                  ? 'Connected · repository access verified'
                  : githubStatus.status === 'checking' ? 'Checking GitHub connection…'
                    : githubStatus.status.replaceAll('_', ' ')}
                {githubStatus.account?.login ? ' · @' + githubStatus.account.login : ''}
              </span>
              <div className="flex flex-wrap gap-2">
                {githubStatus.status !== 'connected' && <button type="button" onClick={() => void connectGitHub()} disabled={githubBusy} className="rounded-md border border-cyan-300/20 px-2.5 py-1.5 text-xs text-cyan-100 disabled:opacity-50">{githubBusy ? 'Connecting…' : 'Connect GitHub'}</button>}
                {githubStatus.status === 'connected' && <button type="button" onClick={() => void disconnectGitHub()} disabled={githubBusy} className="rounded-md border border-rose-300/20 px-2.5 py-1.5 text-xs text-rose-200 disabled:opacity-50">{githubBusy ? 'Disconnecting…' : 'Disconnect'}</button>}
                <button type="button" onClick={() => void loadGitHubStatus()} disabled={githubBusy} className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-50">Refresh</button>
              </div>
            </div>
            {githubStatus.repository?.fullName && <p className="mt-2 text-[10px] text-slate-500">Verified repository: {githubStatus.repository.fullName}</p>}
            <p className="mt-2 text-[10px] leading-4 text-slate-500">Connection is shown as verified only after the API confirms the signed-in GitHub identity and repository access. OAuth credentials remain server-side.</p>
          </div>}
          {providerId && <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-300">{connectionsLoading ? 'Checking connection…' : connectionLabel(connection)}</span>
              <div className="flex flex-wrap gap-2">
                {(!connected || reauthorizationRequired) && <button type="button" onClick={() => void connectProvider(plugin.id)} disabled={connectionBusyId === plugin.id || connectionsLoading} className="rounded-md border border-cyan-300/20 px-2.5 py-1.5 text-xs text-cyan-100 disabled:opacity-50">{connectionBusyId === plugin.id ? 'Connecting…' : reauthorizationRequired ? 'Reconnect account' : 'Connect account'}</button>}
                {connected && connection?.credentialState === 'access_expired_refresh_available' && <button type="button" onClick={() => void refreshProvider(plugin.id)} disabled={connectionBusyId === plugin.id || connectionsLoading} className="rounded-md border border-cyan-300/20 px-2.5 py-1.5 text-xs text-cyan-100 disabled:opacity-50">{connectionBusyId === plugin.id ? 'Refreshing…' : 'Refresh access'}</button>}
                {connected && !reauthorizationRequired && <button type="button" onClick={() => void disconnectProvider(plugin.id)} disabled={connectionBusyId === plugin.id || connectionsLoading} className="rounded-md border border-rose-300/20 px-2.5 py-1.5 text-xs text-rose-200 disabled:opacity-50">{connectionBusyId === plugin.id ? 'Working…' : 'Disconnect'}</button>}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">OAuth authorization is stored encrypted server-side. A connected record is not a live provider health check.</p>
          </div>}
          <p className="mt-2 text-[11px] text-slate-500">Intended scopes: {plugin.scopes.join(' · ')}</p>
          {plugin.id === 'gmail' && connected && <div className="mt-3 border-t border-white/5 pt-3">
            <form onSubmit={event => { event.preventDefault(); void loadGmailMessages(); }} className="flex flex-col gap-2 sm:flex-row">
              <label className="min-w-0 flex-1 text-[11px] text-slate-400">Gmail search
                <input aria-label="Gmail search query" value={gmailQuery} onChange={event => setGmailQuery(event.target.value)} maxLength={200} placeholder="from:example@email.com or subject:invoice" className="mt-1 block w-full rounded-md border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-white" />
              </label>
              <button type="submit" disabled={gmailLoading || connectionsLoading} className="self-end rounded-md border border-cyan-300/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-50">
                {gmailLoading ? 'Searching…' : 'Search mailbox'}
              </button>
            </form>
            {gmailError && <p role="alert" className="mt-2 text-xs text-rose-200">{gmailError}</p>}
            {gmailLoaded && <ul className="mt-3 space-y-2" aria-label="Gmail search results">
              {gmailMessages.length === 0
                ? <li className="text-xs text-slate-400">No messages matched this search.</li>
                : gmailMessages.map(message => <li key={message.id} className="rounded-md bg-slate-950/70 p-2 text-xs">
                  <p className="font-medium text-slate-200">{message.subject || '(No subject)'}</p>
                  <p className="mt-1 text-slate-400">{message.from || 'Sender unavailable'}{message.receivedAt ? ' · ' + new Date(message.receivedAt).toLocaleString() : ''}</p>
                  {message.snippet && <p className="mt-1 text-slate-500">{message.snippet}</p>}
                </li>)}
            </ul>}
            <p className="mt-2 text-[10px] leading-4 text-slate-500">Read-only access: RyanAI retrieves message metadata and short snippets only. It cannot read full message bodies, create drafts or send email from this integration.</p>
          </div>}
          {providerId && providerId !== 'gmail' && connected && <div className="mt-3 border-t border-white/5 pt-3">
            <button type="button" onClick={() => void loadCalendarEvents(plugin.id)} disabled={calendarLoadingId === plugin.id || connectionsLoading} className="rounded-md border border-cyan-300/20 px-2.5 py-1.5 text-xs text-cyan-100 disabled:opacity-50">
              {calendarLoadingId === plugin.id ? 'Loading events…' : 'Load next 7 days'}
            </button>
            {calendarErrors[plugin.id] && <p role="alert" className="mt-2 text-xs text-rose-200">{calendarErrors[plugin.id]}</p>}
            {calendarEvents[plugin.id] && <ul className="mt-2 space-y-2" aria-label={plugin.name + ' events'}>
              {calendarEvents[plugin.id].length === 0
                ? <li className="text-xs text-slate-400">No events returned for the next seven days.</li>
                : calendarEvents[plugin.id].map((event, index) => <li key={event.id ?? index} className="rounded-md bg-slate-950/70 p-2 text-xs">
                  <p className="font-medium text-slate-200">{event.title}</p>
                  <p className="mt-1 text-slate-400">{event.start ? new Date(event.start).toLocaleString() : 'Time unavailable'}{event.end ? ' – ' + new Date(event.end).toLocaleString() : ''}</p>
                  {event.location && <p className="mt-1 text-slate-500">{event.location}</p>}
                </li>)}
            </ul>}
            <p className="mt-2 text-[10px] text-slate-500">Read-only calendar access. RyanAI does not create, edit or delete events here.</p>
          </div>}
          <label className={`mt-3 flex items-center gap-2 text-xs ${allowed ? 'text-slate-200' : 'text-slate-500'}`}>
            <input type="checkbox" aria-label={`Request ${plugin.name} for eligible workers`} checked={enabled} disabled={!allowed || saving} onChange={event => toggle(plugin.id, event.target.checked)} className="h-4 w-4 accent-cyan-400" />
            Request availability for eligible workers{!allowed && <span className="text-amber-300">(Owner/admin controlled)</span>}
          </label>
        </article>;
      })}
    </div>
    {visible.length === 0 && <p className="mt-4 rounded-xl border border-white/10 p-4 text-sm text-slate-400">No integrations match this search.</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
      <p className="max-w-2xl text-xs leading-5 text-slate-500">Saving records user preferences only. It does not install plugins, connect accounts, expose secrets, authorize outbound communications or grant model/worker execution rights. Adapter registration is a separate server-side capability; OAuth authorization alone does not make a provider executable.</p>
      <button type="button" onClick={() => void savePreferences()} disabled={saving} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save plugin preferences'}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-200">{notice}</p>}
    {connectionError && <p role="alert" className="mt-3 text-sm text-rose-200">{connectionError}</p>}
    {connectionNotice && <p role="status" className="mt-3 text-sm text-cyan-100">{connectionNotice}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => void loadConnections()} disabled={connectionsLoading} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">{connectionsLoading ? 'Refreshing connections…' : 'Refresh connection status'}</button>
      <button type="button" onClick={() => { void loadConnections(); void loadRegistry(); }} disabled={connectionsLoading || registryLoading} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">{connectionsLoading || registryLoading ? 'Refreshing status…' : 'Refresh integration status'}</button>
    </div>
    {registryError && <p role="status" className="mt-3 text-sm text-amber-200">Backend registry could not be verified: {registryError}</p>}
  </section>
}
