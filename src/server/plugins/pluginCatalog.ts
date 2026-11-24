import {
  createPluginRegistry,
  type PluginManifest,
} from './pluginRegistry.js';

/**
 * Provider catalogue metadata only. No provider in this list is connected or
 * executable until a separately reviewed adapter and authorization flow exist.
 */
export const DEFAULT_PLUGIN_MANIFESTS: readonly PluginManifest[] = Object.freeze([
  {
    id: 'phonelink', displayName: 'RyanAI PhoneLink', version: '1.0.0',
    categories: ['communications', 'mobile', 'workflows'],
    description: 'Permission-scoped trusted mobile device pairing and event inbox. Native device operations require the Android companion.',
    capabilities: [
      { id: 'devices.pair', risk: 'write', requiresHumanApproval: true },
      { id: 'devices.read', risk: 'read', requiresHumanApproval: false },
      { id: 'notifications.queue', risk: 'write', requiresHumanApproval: true },
      { id: 'files.transfer', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content', 'user_content'],
  },
  {
    id: 'github', displayName: 'GitHub', version: '1.0.0',
    categories: ['engineering', 'workflows'],
    description: 'Repository, issue and pull-request engineering workflows.',
    capabilities: [
      { id: 'repositories.read', risk: 'read', requiresHumanApproval: false },
      { id: 'pull_requests.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['repository_metadata', 'user_content'],
  },
  {
    id: 'vscode-web', displayName: 'Visual Studio Code for the Web', version: '1.0.0',
    categories: ['engineering'], description: 'Browser-based GitHub repository editing handoff for RyanAI Studio.',
    capabilities: [{ id: 'repositories.open', risk: 'read', requiresHumanApproval: false }],
    dataClassifications: ['repository_metadata'],
  },
  {
    id: 'vlc', displayName: 'VLC Media Player', version: '1.0.0',
    categories: ['workflows'], description: 'External player handoff and embedded media playback; adapters are not yet registered.',
    capabilities: [{ id: 'media.playback', risk: 'read', requiresHumanApproval: false }, { id: 'media.library.read', risk: 'read', requiresHumanApproval: false }],
    dataClassifications: ['user_content'],
  },
  {
    id: 'spotify', displayName: 'Spotify', version: '1.0.0', description: 'Optional music provider; authorization and playback adapter required.',
    categories: ['workflows'], capabilities: [{ id: 'playback.control', risk: 'write', requiresHumanApproval: true }], dataClassifications: ['personal_data'],
  },
  {
    id: 'youtube-music', displayName: 'YouTube Music', version: '1.0.0', description: 'Optional music provider; authorization and playback adapter required.',
    categories: ['workflows'], capabilities: [{ id: 'playback.control', risk: 'write', requiresHumanApproval: true }], dataClassifications: ['personal_data'],
  },
  {
    id: 'google-calendar', displayName: 'Google Calendar', version: '1.0.0',
    categories: ['pa_agent', 'workflows'],
    description: 'Calendar availability, events and scheduling.',
    capabilities: [
      { id: 'events.read', risk: 'read', requiresHumanApproval: false },
      { id: 'events.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data'],
  },
  {
    id: 'microsoft-365-calendar', displayName: 'Microsoft 365 Calendar', version: '1.0.0',
    categories: ['pa_agent', 'workflows'],
    description: 'Microsoft 365 calendar availability and scheduling.',
    capabilities: [
      { id: 'events.read', risk: 'read', requiresHumanApproval: false },
      { id: 'events.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data'],
  },
  {
    id: 'gmail', displayName: 'Gmail', version: '1.0.0',
    categories: ['communications', 'pa_agent', 'workflows'],
    description: 'Read-only Gmail message metadata and short previews. Drafting and sending are not enabled.',
    capabilities: [
      { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'outlook-mail', displayName: 'Outlook Mail', version: '1.0.0',
    categories: ['communications', 'pa_agent', 'workflows'],
    description: 'Read-only Outlook message metadata and short previews. Drafting and sending are not enabled.',
    capabilities: [
      { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'slack', displayName: 'Slack', version: '1.0.0',
    categories: ['communications', 'workflows'],
    description: 'Workspace conversations, notifications and governed posting.',
    capabilities: [
      { id: 'conversations.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.post', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'communication_content'],
  },
  {
    id: 'microsoft-teams', displayName: 'Microsoft Teams', version: '1.0.0',
    categories: ['communications', 'workflows'],
    description: 'Teams conversations, meetings and governed posting.',
    capabilities: [
      { id: 'conversations.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.post', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'communication_content'],
  },
  {
    id: 'whatsapp-business', displayName: 'WhatsApp Business', version: '1.0.0',
    categories: ['communications'],
    description: 'WhatsApp Business messaging with owner approval.',
    capabilities: [
      { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
      { id: 'messages.send', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'twilio', displayName: 'Twilio', version: '1.0.0',
    categories: ['communications'],
    description: 'SMS and voice channel operations with explicit dispatch approval.',
    capabilities: [
      { id: 'messages.send', risk: 'outbound', requiresHumanApproval: true },
      { id: 'calls.initiate', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'communication_content'],
  },
  {
    id: 'notion', displayName: 'Notion', version: '1.0.0',
    categories: ['knowledge', 'pa_agent', 'workflows'],
    description: 'Knowledge pages, notes and workspace documentation.',
    capabilities: [
      { id: 'pages.read', risk: 'read', requiresHumanApproval: false },
      { id: 'pages.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'user_content'],
  },
  {
    id: 'dropbox', displayName: 'Dropbox', version: '1.0.0',
    categories: ['knowledge', 'workflows'],
    description: 'User-authorized file discovery and document storage.',
    capabilities: [
      { id: 'files.read', risk: 'read', requiresHumanApproval: false },
      { id: 'files.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['user_content', 'personal_data'],
  },
  {
    id: 'sharepoint', displayName: 'SharePoint', version: '1.0.0',
    categories: ['knowledge', 'workflows'],
    description: 'Organization-authorized SharePoint documents and sites.',
    capabilities: [
      { id: 'files.read', risk: 'read', requiresHumanApproval: false },
      { id: 'files.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'personal_data'],
  },
  {
    id: 'asana', displayName: 'Asana', version: '1.0.0',
    categories: ['workflows', 'pa_agent'],
    description: 'Project tasks, assignments and team workflows.',
    capabilities: [
      { id: 'tasks.read', risk: 'read', requiresHumanApproval: false },
      { id: 'tasks.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content'],
  },
  {
    id: 'linear', displayName: 'Linear', version: '1.0.0',
    categories: ['engineering', 'workflows', 'pa_agent'],
    description: 'Engineering issues, projects and workflow automation.',
    capabilities: [
      { id: 'issues.read', risk: 'read', requiresHumanApproval: false },
      { id: 'issues.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'repository_metadata'],
  },
  {
    id: 'trello', displayName: 'Trello', version: '1.0.0',
    categories: ['workflows', 'pa_agent'],
    description: 'Boards, cards and task coordination.',
    capabilities: [
      { id: 'boards.read', risk: 'read', requiresHumanApproval: false },
      { id: 'cards.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content'],
  },
  {
    id: 'zapier', displayName: 'Zapier', version: '1.0.0',
    categories: ['workflows'],
    description: 'External workflow triggers and automation handoffs.',
    capabilities: [
      { id: 'triggers.read', risk: 'read', requiresHumanApproval: false },
      { id: 'actions.execute', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['user_content', 'workspace_content'],
  },
  {
    id: 'firecrawl', displayName: 'Firecrawl', version: '1.0.0',
    categories: ['research', 'knowledge'],
    description: 'User-authorized web research and content extraction.',
    capabilities: [
      { id: 'pages.fetch', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['public_metadata', 'user_content'],
  },
  {
    id: 'grafana-cloud', displayName: 'Grafana Cloud', version: '1.0.0',
    categories: ['engineering', 'research'],
    description: 'Read-only observability discovery for metrics, logs, traces, profiles and dashboards.',
    capabilities: [
      { id: 'observability.read', risk: 'read', requiresHumanApproval: false },
      { id: 'dashboards.read', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['workspace_content', 'personal_data'],
  },
  {
    id: 'better-stack', displayName: 'Better Stack', version: '1.0.0',
    categories: ['engineering', 'workflows'],
    description: 'Observability and incident investigation across logs, metrics, traces, uptime and on-call schedules.',
    capabilities: [
      { id: 'observability.read', risk: 'read', requiresHumanApproval: false },
      { id: 'incidents.read', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['workspace_content', 'personal_data'],
  },
  {
    id: 'arize-ax', displayName: 'Arize AX', version: '1.0.0',
    categories: ['engineering', 'research'],
    description: 'LLM observability, trace inspection, datasets and evaluation workflows.',
    capabilities: [
      { id: 'traces.read', risk: 'read', requiresHumanApproval: false },
      { id: 'evaluations.read', risk: 'read', requiresHumanApproval: false },
      { id: 'experiments.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'user_content'],
  },
  {
    id: 'incident-io', displayName: 'incident.io', version: '1.0.0',
    categories: ['engineering', 'workflows'],
    description: 'Incident investigation, on-call schedules, escalations and runbook coordination.',
    capabilities: [
      { id: 'incidents.read', risk: 'read', requiresHumanApproval: false },
      { id: 'incidents.update', risk: 'write', requiresHumanApproval: true },
      { id: 'escalations.trigger', risk: 'outbound', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'personal_data'],
  },
  {
    id: 'cloudflare', displayName: 'Cloudflare', version: '1.0.0',
    categories: ['engineering', 'workflows'],
    description: 'Read-only visibility into edge applications, Workers and platform resources; changes remain separately approved.',
    capabilities: [
      { id: 'resources.read', risk: 'read', requiresHumanApproval: false },
      { id: 'deployments.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content', 'repository_metadata'],
  },
  {
    id: 'sonarqube', displayName: 'SonarQube', version: '1.0.0',
    categories: ['engineering'],
    description: 'Static analysis findings, quality gates, coverage and security issue review.',
    capabilities: [
      { id: 'analyses.read', risk: 'read', requiresHumanApproval: false },
      { id: 'quality_gates.read', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['repository_metadata', 'user_content'],
  },
  {
    id: 'tavily', displayName: 'Tavily', version: '1.0.0',
    categories: ['research', 'knowledge'],
    description: 'User-requested web search, URL discovery, crawling and content extraction.',
    capabilities: [
      { id: 'search.execute', risk: 'read', requiresHumanApproval: false },
      { id: 'pages.fetch', risk: 'read', requiresHumanApproval: false },
    ],
    dataClassifications: ['public_metadata', 'user_content'],
  },
  {
    id: 'clickup', displayName: 'ClickUp', version: '1.0.0',
    categories: ['workflows', 'pa_agent'],
    description: 'Project task discovery, time tracking and team coordination.',
    capabilities: [
      { id: 'tasks.read', risk: 'read', requiresHumanApproval: false },
      { id: 'tasks.write', risk: 'write', requiresHumanApproval: true },
    ],
    dataClassifications: ['workspace_content'],
  },
  {
    id: 'docusign', displayName: 'DocuSign', version: '1.0.0',
    categories: ['workflows', 'knowledge'],
    description: 'Document template and envelope status discovery; sending and signing require explicit human approval.',
    capabilities: [
      { id: 'envelopes.read', risk: 'read', requiresHumanApproval: false },
      { id: 'envelopes.send', risk: 'outbound', requiresHumanApproval: true },
      { id: 'envelopes.sign', risk: 'destructive', requiresHumanApproval: true },
    ],
    dataClassifications: ['personal_data', 'user_content'],
  },
]);\n\nexport function createDefaultPluginRegistry() {
  return createPluginRegistry(DEFAULT_PLUGIN_MANIFESTS);
}

/** Shared process-local registry; adapters are added by server bootstrap only. */
export const pluginRegistry = createDefaultPluginRegistry();
