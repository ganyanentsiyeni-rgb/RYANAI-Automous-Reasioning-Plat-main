import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import { routeReasoning, SUPPORTED_REASONING_PROVIDERS } from './provider-router.js';
import { isDegradedHealthResponse, resolveHealthUrl } from './health-url.js';
import { resolveToolRegistry } from './tool-registry.js';
import { getCanonicalTool } from './tool-registry.js';
import { authorizeDelegatedTool, MCP_TOOL_SCOPES, verifyMcpDelegationToken } from './delegation.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.env.RYANAI_PROJECT_ROOT || path.join(import.meta.dirname, '..'));
const isWindows = process.platform === 'win32';
const hasProjectManifest = existsSync(path.join(projectRoot, 'package.json'));
const hasGitMetadata = existsSync(path.join(projectRoot, '.git'));
const stackManifestPath = path.join(projectRoot, 'stacks', 'ryanai.stack.json');
const hasStackManifest = existsSync(stackManifestPath);
const channels = ['whatsapp', 'sms', 'voice', 'email'];

export function createMcpServer({ delegatedToken, requireDelegation = false } = {}) {
  const server = new Server(
    { name: 'ryanai-mcp-manager', version: '1.2.0' },
    { capabilities: { tools: {} } },
  );

  const runtimeToolNames = [
    'tool_registry',
    ...(hasProjectManifest ? ['run_project_checks'] : []),
    ...(hasGitMetadata ? ['repository_status'] : []),
    ...(hasStackManifest ? ['ryanai_stack_manifest'] : []),
    'platform_health',
    'reasoning_route',
    'comms_policy_read',
    'comms_draft_prepare',
  ];

  const tools = runtimeToolNames.map((name) => {
    const canonical = getCanonicalTool(name);
    if (!canonical) throw new Error(`Missing canonical MCP tool definition: ${name}`);
    return {
      name: canonical.name,
      description: canonical.description,
      inputSchema: canonical.inputSchema,
    };
  });
  const requestedTools = String(process.env.RYANAI_MCP_ENABLED_TOOLS || '')
    .split(',').map((name) => name.trim()).filter(Boolean);
  if (requestedTools.some((name) => name.startsWith('comms_'))) {
    const token = process.env.MCP_AUTH_TOKEN || '';
    if (token.length < 32) {
      throw new Error('MCP_AUTH_TOKEN must contain at least 32 characters before enabling communications MCP tools.');
    }
  }

  const { tools: allowlistedTools, registry } = resolveToolRegistry(tools);
  const delegatedClaims = delegatedToken
    ? verifyMcpDelegationToken(delegatedToken, process.env.RYANAI_MCP_DELEGATION_SECRET || '')
    : null;
  const delegatedToolNames = delegatedClaims
    ? new Set(delegatedClaims.scope.map((scope) => Object.keys(MCP_TOOL_SCOPES).find((name) => MCP_TOOL_SCOPES[name] === scope)).filter(Boolean))
    : null;
  const exposedTools = delegatedToolNames
    ? allowlistedTools.filter((tool) => delegatedToolNames.has(tool.name))
    : requireDelegation ? [] : allowlistedTools;
  const exposedToolNames = new Set(exposedTools.map((tool) => tool.name));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    if (!exposedToolNames.has(request.params.name)) {
      return textResult('MCP tool is not enabled by the operator allowlist.', true);
    }

    try {
      if (requireDelegation && !delegatedToken) throw new Error('An API-issued delegated identity is required.');
      if (delegatedToken) {
        await authorizeDelegatedTool({
          token: delegatedToken,
          toolName: request.params.name,
          secret: process.env.RYANAI_MCP_DELEGATION_SECRET || '',
          serviceToken: process.env.RYANAI_MCP_SERVICE_TOKEN || '',
          apiBaseUrl: process.env.RYANAI_API_BASE_URL || 'http://127.0.0.1:3000',
        });
      }
      if (request.params.name === 'tool_registry') return textResult(JSON.stringify(registry, null, 2));
      if (request.params.name === 'run_project_checks') {
        const results = [];
        results.push(await run('npm', ['run', 'validate']));
        results.push(await run('docker', ['compose', 'config', '--quiet']));
        return textResult(`RyanAI checks passed.\n\n${results.join('\n\n')}`);
      }
      if (request.params.name === 'repository_status') {
        const status = await run('git', ['status', '--short']);
        const diffCheck = await run('git', ['diff', '--check']);
        return textResult(`Repository status:\n${status || '(clean)'}\n\nWhitespace check:\n${diffCheck || 'clean'}`);
      }
      if (request.params.name === 'ryanai_stack_manifest') {
        return textResult(JSON.stringify(JSON.parse(readFileSync(stackManifestPath, 'utf8')), null, 2));
      }
      if (request.params.name === 'platform_health') {
        const configuredUrl = process.env.RYANAI_API_HEALTH_URL || 'http://localhost:3000/health';
        const url = resolveHealthUrl(typeof args.url === 'string' ? args.url : undefined, configuredUrl);
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const body = await response.text();
        // A structured HTTP 503 with status=degraded is a valid readiness
        // snapshot, not a failed MCP invocation. Preserve other non-2xx failures.
        if (!response.ok && !isDegradedHealthResponse(response.status, body)) {
          throw new Error(`RyanAI API returned HTTP ${response.status}: ${body.slice(0, 500)}`);
        }
        return textResult(body);
      }
      if (request.params.name === 'reasoning_route') {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const provider = typeof args.provider === 'string' ? args.provider : '';
        const model = typeof args.model === 'string' ? args.model : '';
        if (!prompt) throw new Error('prompt is required.');
        if (prompt.length > 20000) throw new Error('prompt must be 20,000 characters or fewer.');
        if (!SUPPORTED_REASONING_PROVIDERS.includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
        const responseFormat = typeof args.response_format === 'string' ? args.response_format : 'text';
        return textResult(JSON.stringify(await routeReasoning(prompt, provider, model, {
          responseFormat,
          delegatedToken,
          env: process.env,
        }), null, 2));
      }
      if (request.params.name === 'comms_policy_read') {
        const channel = requireChannel(args.channel);
        const policy = {
          whatsapp: ['Respect opt-in and opt-out requests.', 'Use approved templates when required by provider policy.'],
          sms: ['Use E.164 recipients.', 'Respect consent, quiet hours and opt-out requests.'],
          voice: ['Use E.164 recipients.', 'Calls require explicit owner approval and recipient consent.'],
          email: ['Validate recipient addresses.', 'Provider acceptance is not proof of delivery.'],
        }[channel];
        return textResult(JSON.stringify({ channel, policy, readOnly: true, providerAccess: false }));
      }
      if (request.params.name === 'comms_draft_prepare') {
        const channel = requireChannel(args.channel);
        const recipient = typeof args.recipient === 'string' ? args.recipient.trim() : '';
        const message = typeof args.message === 'string' ? args.message.trim() : '';
        const subject = typeof args.subject === 'string' ? args.subject.trim() : undefined;
        if (!recipient || !message || message.length > 4000) throw new Error('A recipient and message of 1–4000 characters are required.');
        if (channel === 'email') {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('A valid email recipient is required.');
          if (subject && subject.length > 200) throw new Error('Email subject must be 200 characters or fewer.');
        } else {
          if (!/^\+[1-9]\d{7,14}$/.test(recipient)) throw new Error('Phone-based channels require an E.164 recipient.');
          if (subject) throw new Error('Subjects are supported only for email drafts.');
        }
        return textResult(JSON.stringify({
          status: 'draft_ready', channel, recipient,
          ...(channel === 'email' ? { subject: subject || 'RyanAI message' } : {}),
          message, approvalRequired: true, dispatchPerformed: false,
        }));
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      return textResult(`RyanAI MCP operation failed:\n${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  return server;
}

function requireChannel(value) {
  if (typeof value !== 'string' || !channels.includes(value)) throw new Error('Unsupported communications channel.');
  return value;
}

async function run(command, args) {
  const executable = isWindows && command === 'npm' ? 'npm.cmd' : command;
  const result = await execFileAsync(executable, args, {
    cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 * 8, timeout: 10 * 60 * 1000,
  });
  return `${command} ${args.join(' ')}\n${result.stdout.trim()}${result.stderr.trim() ? `\n[stderr]\n${result.stderr.trim()}` : ''}`;
}

function textResult(text, isError = false) {
  return { isError, content: [{ type: 'text', text }] };
}
