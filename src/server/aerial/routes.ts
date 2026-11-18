import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { AerialClient } from './client.js';

interface InferBody {
  prompt: string;
  model?: string;
  inputs?: unknown;
}

function requireAuthenticatedHuman(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.authUser?.id) {
    reply.code(401).send({ success: false, error: 'Authenticated user identity is required.' });
    return false;
  }
  const policy = evaluateGenXSecurityEvent({
    agentId: 'ryanai-api',
    principal: request.authUser.id,
    toolName: 'aerial_ai_ran_inference',
    action: 'NETWORK',
    target: 'configured-aerial-runtime',
    environment: process.env.NODE_ENV === 'production' ? 'production'
      : process.env.NODE_ENV === 'staging' ? 'staging' : 'development',
    actorType: 'human',
  });
  if (policy.decision !== 'ALLOW') {
    reply.code(403).send({
      success: false,
      error: 'Gen-X denied this Aerial AI-RAN request.',
      ruleId: policy.ruleId,
    });
    return false;
  }
  return true;
}

export const aerialRoutes: FastifyPluginAsync = async (fastify) => {
  const client = new AerialClient();

  fastify.get('/api/aerial/health', async () => ({
    success: true,
    provider: 'nvidia-aerial',
    ...(await client.health()),
  }));

  fastify.get('/api/aerial/status', async () => ({
    success: true,
    provider: 'nvidia-aerial',
    enabled: client.getConfig().enabled,
    mode: client.getConfig().mode,
    model: client.getConfig().model,
    externalEndpointConfigured: Boolean(client.getConfig().baseUrl),
    inferenceEndpointConfigured: Boolean(client.getConfig().inferenceUrl),
  }));

  fastify.post<{ Body: InferBody }>('/api/aerial/inference', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['prompt'],
        additionalProperties: false,
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 20000 },
          model: { type: 'string', minLength: 1, maxLength: 200 },
          inputs: {},
        },
      },
    },
  }, async (request, reply) => {
    if (!requireAuthenticatedHuman(request, reply)) return;
    try {
      const result = await client.infer(request.body, AbortSignal.timeout(client.getConfig().timeoutMs));
      return {
        success: true,
        provider: result.provider,
        model: result.model,
        response: result.response,
        simulated: result.simulated,
        latencyMs: result.latencyMs,
        policyDecision: 'ALLOW',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Aerial inference failed.';
      fastify.log.warn({ reason: message }, 'Aerial AI-RAN inference failed');
      return reply.code(503).send({ success: false, error: message });
    }
  });
};
