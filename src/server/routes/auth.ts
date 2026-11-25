import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { createContextClient } from '@supabase/server/core';
import type { PrismaClient } from '@prisma/client';
import { normalizePluginPreferences, type PluginPreferences } from '../plugins/index.js';
import { normalizeResponsePreferences, type ResponsePreferences } from '../../shared/responsePreferences.js';

// --- Interfaces & Types ---

export type TrustedActorType = 'human' | 'agent' | 'service';

/**
 * Resolve actor identity only from trusted Supabase app metadata.
 * Unknown/missing metadata remains human-compatible for existing sessions;
 * explicit agent/service identities can never be promoted to human by a route.
 */
export function resolveTrustedActorType(appMetadata: Record<string, unknown> | undefined): TrustedActorType {
  const value = appMetadata?.actor_type;
  return value === 'agent' || value === 'service' || value === 'human' ? value : 'human';
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: 'user' | 'admin';
  displayName?: string;
  isOwner: boolean;
  /** User-owned plugin intent; never substitutes for provider authorization or execution approval. */
  pluginPreferences?: PluginPreferences;
  /** User-owned response style only; never an authorization or approval signal. */
  responsePreferences?: ResponsePreferences;
  /** AAL is taken only from Supabase-verified JWT claims. */
  sessionAssurance: 'aal1' | 'aal2';
  /** Trusted actor classification from Supabase app metadata; never from request input. */
  actorType: TrustedActorType;
}

// Augment Fastify types to include custom request properties and Prisma instance
declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

// --- Middleware & Guards (Supabase Auth) ---

/**
 * Verify with Supabase Auth; never trust a decoded token or browser metadata.
 * Attach a non-anonymous authUser after bearer-token verification.
 */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (request.authUser?.id) return;
  
  const token = /^Bearer ([^\s]+)$/i.exec(
    request.headers.authorization || '',
  )?.[1];
  
  if (!token) {
    return reply.code(401).send({ error: 'Sign in to continue.' });
  }

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    return reply.code(503).send({ error: 'Authentication is not configured.' });
  }

  try {
    const client = createContextClient({
      env: { url, publishableKeys: { default: key } },
      auth: { token },
      supabaseOptions: {
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
        },
      },
    });

    const { data, error } = await client.auth.getUser(token);

    if (error || !data.user || data.user.is_anonymous) {
      const status =
        error && (!error.status || error.status >= 500) ? 503 : 401;
      return reply.code(status).send({
        error:
          status === 503
            ? 'Authentication is temporarily unavailable.'
            : 'Invalid or expired session. Please sign in again.',
      });
    }

    // getUser confirms the live identity; getClaims verifies the JWT signature
    // and supplies the session assurance claim. Never infer AAL from user metadata.
    const { data: claimsData, error: claimsError } = await client.auth.getClaims(token);
    if (claimsError || !claimsData?.claims
      || claimsData.claims.sub !== data.user.id
      || !['aal1', 'aal2'].includes(String(claimsData.claims.aal))) {
      const status = claimsError && (!claimsError.status || claimsError.status >= 500) ? 503 : 401;
      return reply.code(status).send({
        error: status === 503
          ? 'Session assurance is temporarily unavailable.'
          : 'Invalid session claims. Please sign in again.',
      });
    }

    request.authUser = {
      id: data.user.id,
      sessionAssurance: claimsData.claims.aal as 'aal1' | 'aal2',
      actorType: resolveTrustedActorType(data.user.app_metadata as Record<string, unknown> | undefined),
      email: data.user.email,
      role: data.user.app_metadata?.role === 'admin' ? 'admin' : 'user',
      displayName: typeof data.user.user_metadata?.full_name === 'string' ? data.user.user_metadata.full_name : undefined,
      isOwner: data.user.app_metadata?.owner === true || Boolean(data.user.email && process.env.RYANAI_OWNER_EMAIL?.trim() && data.user.email.toLowerCase() === process.env.RYANAI_OWNER_EMAIL.trim().toLowerCase()),
      pluginPreferences: normalizePluginPreferences(data.user.user_metadata?.ryanai_plugin_preferences),
      responsePreferences: normalizeResponsePreferences(data.user.user_metadata?.ryanai_copilot_settings),
    };
  } catch {
    return reply
      .code(503)
      .send({ error: 'Authentication is temporarily unavailable.' });
  }
}

/**
 * Require a verified user, responding with 403 unless authUser has the admin role.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ error: 'Administrator access is required.' });
  }
}

/**
 * Require the separately configured RyanAI owner identity.
 * Administrator role alone is deliberately insufficient for owner-level
 * account lifecycle, credential, or security operations.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (!request.authUser?.isOwner) {
    return reply.code(403).send({ error: 'RyanAI owner authorization is required.' });
  }
}

// --- Global Hook Installer ---

/**
 * Install authentication before routes, including WebSocket upgrades.
 */
export function installAuthentication(fastify: FastifyInstance) {
  // Test harnesses and composed Fastify applications may predeclare this request
  // decorator. Preserve the existing decorator rather than throwing during boot.
  if (!fastify.hasRequestDecorator('authUser')) {
    fastify.decorateRequest('authUser', null);
  }

  fastify.addHook('preValidation', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (request.method === 'OPTIONS') return;
    // Machine-to-machine routes authenticate their own dedicated bearer tokens.
    if (request.method === 'POST' && ['/api/internal/openai/chat', '/api/internal/mcp/delegation', '/api/internal/mcp/authorize', '/api/internal/ryanai/events'].includes(path)) return;
    // Comms browser routes require a verified session and an owner/admin identity.
    // The Comms plugin narrows outbound sends and history to the configured owner.
    if (path.startsWith('/api/comms/')) {
      await requireUser(request, reply);
      if (reply.sent) return;
      if (request.authUser?.role !== 'admin' && !request.authUser?.isOwner) {
        return reply.code(403).send({ error: 'Owner or administrator access is required.' });
      }
      return;
    }
    // This machine-to-machine route verifies JARVIS_INGRESS_TOKEN in its own preHandler.
    if (request.method === 'POST' && path === '/api/jarvis/patches/apply') return;
    
    if (
      ['GET', 'HEAD'].includes(request.method) &&
      ['/', '/health', '/api/health', '/livez', '/readyz'].includes(path)
    ) {
      return;
    }

    // Provider-neutral event ingestion verifies a timestamped HMAC in its own route.
    // Signed provider-neutral event ingestion authenticates its own HMAC.
    if (request.method === 'POST' && path === '/api/events/ingest') return;

    // Webhooks with their own signature verification
    if (
      request.method === 'POST' &&
      ['/api/slack/interactions', '/api/webhooks/twilio/whatsapp', '/api/webhooks/twilio/voice', '/api/webhooks/twilio/voice/respond', '/api/webhooks/twilio/sms', '/api/webhooks/twilio/status', '/api/webhooks/resend/inbound'].includes(path)
    ) {
      return;
    }

    // The GitHub callback is bound to the one-time state created by an authenticated user.
    if (request.method === 'GET' && path === '/api/github/callback') return;
    if (request.method === 'GET' && /^\/api\/plugins\/oauth\/(google-calendar|microsoft-365-calendar)\/callback$/.test(path)) return;
    if (path.startsWith('/api/github/') || path.startsWith('/api/plugins/')) return requireUser(request, reply);
    if (path === '/api/phonelink/device-sessions/exchange' || path.startsWith('/api/phonelink/mobile/')) return;
    if (path.startsWith('/api/phonelink/')) return requireUser(request, reply);

    // Public auth signin route
    if (request.method === 'POST' && path === '/api/auth/signin') {
      return;
    }

    // Retired legacy local-password login/logout/sign-in routes
    if (
      request.method === 'POST' &&
      ['/api/auth/login', '/api/auth/logout', '/signin'].includes(path)
    ) {
      return;
    }

    // Agent operations routes enforce their own user/admin boundary. Keep ordinary
    // authenticated users out of the global admin-only fallback; privileged
    // knowledge and live-probe handlers perform explicit role checks themselves.
    if (path.startsWith('/api/agent/ops/')) {
      return requireUser(request, reply);
    }

    if (path.startsWith('/api/engineering/')) {
      return requireUser(request, reply);
    }

    // Aerial inference applies its own Gen-X decision after verifying the
    // human identity. Do not force the global admin-only fallback first.
    if (request.method === 'POST' && path === '/api/aerial/inference') {
      return requireUser(request, reply);
    }

    if (
      (request.method === 'POST' &&
        ['/api/reason', '/api/reasoning/stream', '/api/v1/realtime/voice-ticket'].includes(path)) ||
      (request.method === 'GET' && path === '/api/auth/verify') ||
      (path.startsWith('/api/quant/') && !(request.method === 'GET' && path === '/api/quant/stream')) ||
      path.startsWith('/api/user/memory')
    ) {
      return requireUser(request, reply);
    }

    // WebSocket upgrades consume short-lived, one-time tickets issued to verified users.
    // The route-specific preValidation hook consumes each ticket exactly once.
    if (
      request.method === 'GET' &&
      ['/api/v1/realtime/voice', '/api/quant/stream'].includes(path)
    ) return;

    return requireAdmin(request, reply);
  });
}

// --- Fastify Plugin Registration ---

export const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Retire the local Prisma-password path. The frontend uses Supabase Auth,
  // and this legacy handler could report success without issuing a usable session.
  fastify.post('/api/auth/signin', async (_request, reply) =>
    reply.code(410).send({
      success: false,
      error: 'Gone',
      message: 'Local password sign-in has been retired. Use Supabase Auth through the RyanAI sign-in page.',
    }),
  );

  // 2. Session verification route
  fastify.get(
    '/api/auth/verify',
    { preHandler: requireUser },
    async (request) => ({
      authenticated: true,
      user: request.authUser,
    }),
  );

  // 3. Retire legacy shared-password/cookie endpoints
  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    fastify.post(path, async (_request, reply) =>
      reply.code(410).send({
        error: 'Use the application sign-in and sign-out controls.',
      }),
    );
  }
};