import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../routes/auth.js';
import { decryptProviderCredential, readProviderEncryptionKey } from './providerAuthorization.js';
import { pluginRegistry } from './pluginCatalog.js';
import { resolveProviderCapabilityState } from './providerCapabilityState.js';
import { evaluateGenXSecurityEvent } from '../../security/genxPolicy.js';
import { probeAuthenticatedProvider, readStoredProviderHealthEvidence } from './providerHealth.js';

const SUPPORTED_HEALTH_PROVIDERS = new Set([
  'google-calendar',
  'gmail',
  'microsoft-365-calendar',
]);

function requiredEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export const providerHealthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { provider: string } }>(
    '/api/plugins/:provider/health',
    { preHandler: requireUser },
    async (request, reply) => {
      const ownerUserId = request.authUser?.id;
      if (!ownerUserId) return reply.code(401).send({ error: 'Sign in before checking provider health.' });

      const providerId = request.params.provider;
      if (!SUPPORTED_HEALTH_PROVIDERS.has(providerId)) {
        return reply.code(404).send({ error: 'Authenticated health probe is not supported for this provider.' });
      }

      const manifest = pluginRegistry.get(providerId);
      if (!manifest) return reply.code(404).send({ error: 'Provider is not registered.' });

      const connection = await fastify.prisma.pluginProviderConnection.findUnique({
        where: { ownerUserId_providerId: { ownerUserId, providerId } },
      });

      if (!connection || connection.status !== 'connected' || connection.revokedAt || !connection.encryptedAccessToken) {
        return reply.code(409).send({
          provider: providerId,
          healthStatus: readStoredProviderHealthEvidence(connection?.connectionMetadata).status,
          executionStatus: 'blocked_connection',
          usable: false,
          error: 'No active owner connection is available for an authenticated health probe.',
        });
      }

      if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt <= new Date()) {
        return reply.code(409).send({
          provider: providerId,
          healthStatus: readStoredProviderHealthEvidence(connection.connectionMetadata).status,
          executionStatus: 'blocked_authentication',
          usable: false,
          error: 'The stored access token is expired; refresh or reconnect before probing provider health.',
        });
      }

      const key = readProviderEncryptionKey(requiredEnv('RYANAI_PLUGIN_TOKEN_ENCRYPTION_KEY') ?? undefined);
      if (!key) return reply.code(503).send({ error: 'Provider token encryption is not configured.' });

      let accessToken: string;
      try {
        accessToken = decryptProviderCredential(
          connection.encryptedAccessToken,
          key,
          'plugin-token:' + providerId + ':' + ownerUserId,
        );
      } catch {
        return reply.code(503).send({ error: 'Provider authorization could not be resolved securely.' });
      }

      const capabilityId = providerId === 'gmail' ? 'gmail.messages.read' : 'calendar.events.read';
      const genx = evaluateGenXSecurityEvent({
        agentId: 'ryanai-api',
        principal: ownerUserId,
        toolName: 'plugin_provider_read',
        action: 'NETWORK',
        target: `plugin-provider:${providerId}:${capabilityId}`,
        environment: process.env.NODE_ENV === 'production' ? 'production'
          : process.env.NODE_ENV === 'staging' ? 'staging' : 'development',
        actorType: 'human',
        ownerAuthorized: true,
      });
      if (genx.decision !== 'ALLOW') {
        request.log.warn({ ruleId: genx.ruleId, providerId, capabilityId }, 'Gen-X denied provider health network probe');
        return reply.code(403).send({
          provider: providerId,
          healthStatus: readStoredProviderHealthEvidence(connection.connectionMetadata).status,
          executionStatus: 'blocked_genx',
          usable: false,
          error: 'Gen-X denied this provider health request.',
        });
      }

      const result = await probeAuthenticatedProvider(providerId, accessToken);
      const metadata = connection.connectionMetadata && typeof connection.connectionMetadata === 'object' && !Array.isArray(connection.connectionMetadata)
        ? connection.connectionMetadata as Record<string, unknown>
        : {};
      await fastify.prisma.pluginProviderConnection.update({
        where: { id: connection.id },
        data: {
          connectionMetadata: {
            ...metadata,
            health: {
              status: result.status,
              checkedAt: result.checkedAt,
              latencyMs: result.latencyMs,
              safeNote: result.safeNote,
            },
          },
        },
      });

      const capabilityState = resolveProviderCapabilityState(
        manifest.adapterStatus,
        {
          status: connection.status,
          revokedAt: connection.revokedAt,
          accessTokenExpiresAt: connection.accessTokenExpiresAt,
          hasRefreshToken: Boolean(connection.encryptedRefreshToken),
        },
        new Date(),
        result.status,
      );

      return {
        provider: providerId,
        healthStatus: result.status,
        lastHealthCheckAt: result.checkedAt,
        latencyMs: result.latencyMs,
        healthNote: result.safeNote,
        adapterStatus: manifest.adapterStatus,
        executionStatus: capabilityState.executionStatus,
        usable: capabilityState.usable,
      };
    },
  );
};
