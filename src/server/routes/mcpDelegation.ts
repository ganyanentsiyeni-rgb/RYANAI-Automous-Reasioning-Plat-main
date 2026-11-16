import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { requireUser } from './auth.js';
import { hasValidMcpServiceToken, issueMcpDelegationToken, MCP_DELEGATED_SCOPES, verifyMcpDelegationToken } from '../security/mcpDelegation.js';

interface DelegationBody { scopes: string[]; }
interface AuthorizeBody { scope: string; }

const scopeToolNames: Record<string, string> = {
  tool_registry: 'mcp_tool_registry',
  repository_status: 'mcp_repository_status',
  platform_health: 'mcp_platform_health',
  ryanai_stack_manifest: 'mcp_stack_manifest',
  reasoning_request: 'api_reasoning_request',
};

function requireMcpService(request: FastifyRequest, reply: FastifyReply): void {
  const expected = process.env.RYANAI_MCP_SERVICE_TOKEN?.trim() ?? '';
  if (expected.length < 32) {
    reply.code(503).send({ error: 'MCP service authentication is not configured.' });
    return;
  }
  if (!hasValidMcpServiceToken(request.headers['x-ryanai-service-token'], expected)) {
    reply.code(401).send({ error: 'Unauthorized MCP service.' });
  }
}

/**
 * Keep the Fastify hook return type void. Returning FastifyReply from a hook
 * makes Fastify's overload resolution select the WebSocket route signature,
 * which then incorrectly types the HTTP request as a WebSocket.
 */
async function requireMcpDelegationAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  requireMcpService(request, reply);
  if (reply.sent) return;
  await requireUser(request, reply);
}

export const mcpDelegationRoutes: FastifyPluginAsync = async (fastify) => {
  if (!fastify.hasRequestDecorator('authUser')) fastify.decorateRequest('authUser', null);
  fastify.post<{ Body: DelegationBody }>('/api/internal/mcp/delegation', {
    preHandler: requireMcpDelegationAuth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['scopes'],
        additionalProperties: false,
        properties: {
          scopes: {
            type: 'array',
            minItems: 1,
            maxItems: MCP_DELEGATED_SCOPES.length,
            uniqueItems: true,
            items: { type: 'string', enum: [...MCP_DELEGATED_SCOPES] },
          },
        },
      },
    },
  }, async (request, reply) => {
    const principal = request.authUser;
    if (!principal?.id) return reply.code(401).send({ error: 'Verified user identity is required.' });

    const environment = process.env.NODE_ENV === 'production' ? 'production'
      : process.env.NODE_ENV === 'staging' ? 'staging' : 'development';
    for (const scope of request.body.scopes) {
      const policy = evaluateGenXSecurityEvent({
        agentId: scope === 'reasoning_request' ? 'ryanai-api' : 'mcp-gateway',
        principal: principal.id,
        toolName: scopeToolNames[scope],
        action: scope === 'reasoning_request' ? 'NETWORK' : 'READ',
        target: scope === 'reasoning_request' ? 'configured-approved-provider' : 'mcp:' + scope,
        ...(scope === 'reasoning_request' ? { actorType: 'human' as const } : {}),
        environment,
      });
      if (policy.decision !== 'ALLOW') {
        fastify.log.warn({ ruleId: policy.ruleId, principal: principal.id, scope }, 'Gen-X denied MCP delegation scope');
        return reply.code(403).send({ error: 'Gen-X denied the requested MCP capability.', ruleId: policy.ruleId });
      }
    }

    const secret = process.env.RYANAI_MCP_DELEGATION_SECRET?.trim() ?? '';
    if (secret.length < 32) {
      return reply.code(503).send({ error: 'MCP delegation signing is not configured.' });
    }
    try {
      const issued = issueMcpDelegationToken({
        subject: principal.id,
        role: principal.role,
        scopes: request.body.scopes,
        secret,
      });
      return {
        token: issued.token,
        tokenType: 'Bearer',
        audience: 'ryanai-mcp',
        expiresAt: new Date(issued.expiresAt * 1000).toISOString(),
        scopes: issued.claims.scope,
      };
    } catch {
      return reply.code(400).send({ error: 'Unable to issue delegated MCP identity.' });
    }
  });

  // MCP must present both its service identity and the short-lived user
  // delegation on every tool call. This is an execution-time Gen-X check,
  // not a cached decision made only when the delegation token was issued.
  fastify.post<{ Body: AuthorizeBody }>('/api/internal/mcp/authorize', {
    preHandler: requireMcpService,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['scope'],
        additionalProperties: false,
        properties: { scope: { type: 'string', enum: [...MCP_DELEGATED_SCOPES] } },
      },
    },
  }, async (request, reply) => {
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization || '')?.[1];
    if (!bearer) return reply.code(401).send({ error: 'Delegated user identity is required.' });
    const secret = process.env.RYANAI_MCP_DELEGATION_SECRET?.trim() ?? '';
    let claims;
    try {
      claims = verifyMcpDelegationToken(bearer, secret);
    } catch {
      return reply.code(401).send({ error: 'Delegated user identity is invalid or expired.' });
    }
    const scope = request.body.scope;
    if (!claims.scope.includes(scope as (typeof MCP_DELEGATED_SCOPES)[number])) {
      return reply.code(403).send({ error: 'Delegated identity does not grant this MCP capability.' });
    }
    const environment = process.env.NODE_ENV === 'production' ? 'production'
      : process.env.NODE_ENV === 'staging' ? 'staging' : 'development';
    const policy = evaluateGenXSecurityEvent({
      agentId: scope === 'reasoning_request' ? 'ryanai-api' : 'mcp-gateway',
      principal: claims.sub,
      toolName: scopeToolNames[scope],
      action: scope === 'reasoning_request' ? 'NETWORK' : 'READ',
      target: scope === 'reasoning_request' ? 'configured-approved-provider' : 'mcp:' + scope,
      ...(scope === 'reasoning_request' ? { actorType: 'human' as const } : {}),
      environment,
    });
    if (policy.decision !== 'ALLOW') {
      fastify.log.warn({ ruleId: policy.ruleId, principal: claims.sub, scope }, 'Gen-X denied MCP execution-time authorization');
      return reply.code(403).send({ allowed: false, error: 'Gen-X denied the MCP capability.', ruleId: policy.ruleId });
    }
    return { allowed: true, scope, principalId: claims.sub, decision: policy.decision, ruleId: policy.ruleId };
  });
};