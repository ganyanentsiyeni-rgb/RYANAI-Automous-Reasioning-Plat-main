// Load local configuration before tracing and application imports.
import '../loadEnv.js';

// Tracing must precede application imports.
import '../instrument.js';
import { shutdownTelemetry } from '../telemetry.js';

import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { parseCorsOrigins } from './corsOrigins.js';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRedis from '@fastify/redis';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors from '@fastify/cors';
import pg from 'pg';
import { getAudiobookPrismaClient } from './audiobookPrisma.js';
import { connectRedis, isRedisReady } from './connectRedis.js';
import { prisma } from '../lib/prisma.js';
import { databaseFailureDiagnostic } from './startupDiagnostics.js';
import { resolveConnectionUrls } from './startupConfig.js';
import { startupSummary } from './startupDiagnostics.js';
import { evaluateStudioWorkerHeartbeats, inspectReadiness, isAgentWorkerReady } from './readiness.js';

import { API_ROUTES } from '../config/core.js';
import { evaluateGenXSecurityEvent } from '../security/genxPolicy.js';

import { invokeReasoningAgent } from '../agent/invoke.js';
import { startScheduler } from '../scheduler/runner.js';
import { startAlerts } from '../alerts/runner.js';
import { registerWebSocketRoutes } from '../api/websocket.js';
import { authPlugin, installAuthentication } from './routes/auth.js';
import authSigninRoute from '../api/auth/signin.js';
import { commsPlugin } from './comms/index.js';
import { commsAuthorizationRoutes } from './comms/authorization.js';
import { githubIntegrationRoutes } from './routes/githubIntegration.js';
import { approvalRoutes } from './routes/approvalRoutes.js';
import { engineeringEvidenceRoutes } from './routes/engineeringEvidenceRoutes.js';
import { slackInteractionsPlugin } from './routes/slackInteractions.js';
import { twilioWebhookPlugin } from './routes/twilioWebhook.js';
import { metricsRoutes } from './routes/metrics.js';
import { adminAuditRoutes } from './routes/adminAudit.js';
import { adminUsersRoutes } from './routes/adminUsers.js';
import { langGraphCheckpointerSetupRoutes } from './routes/langgraphCheckpointerSetup.js';
import { adminAccountLifecycleRoutes } from './routes/adminAccountLifecycle.js';
import { quantRoutes } from './routes/quantRoutes.js';
import { quantPortfolioOptimizationRoutes } from './routes/quantPortfolioOptimizationRoutes.js';
import { quantReconciliationRoutes } from './routes/quantReconciliationRoutes.js';
import { quantStreamingRoutes } from './routes/quantStreamingRoutes.js';
import { quantPaperSafetyRoutes } from './routes/quantPaperSafetyRoutes.js';
import { tasksRoutes } from './routes/tasks.js';
import { pendingActionsRoutes } from './routes/pendingActions.js';
import { jarvisRoutes } from './routes/jarvisRoutes.js';
import { internalJarvisRoutes } from './routes/internalJarvisRoutes.js';
import { mcpDelegationRoutes } from './routes/mcpDelegation.js';
import { providerGatewayRoutes } from './routes/providerGateway.js';
import { registerPatchRoutes } from './routes/patchRoutes.js';
import { inspectDatabaseSchema } from './databaseSchema.js';
import { agentOperationsRoutes } from './routes/agentOperations.js';
import { memoryRoutes } from './routes/memory.js';
import { realtimeVoiceRoutes } from './routes/realtimeVoice.js';
import { audioIntelligenceRoutes } from './routes/audioIntelligence.js';
import { audiobookProjectRoutes } from './routes/audiobookProjects.js';
import { getAgentTaskWorkerStatus, startAgentTaskWorker, startBrainHealthMonitor, type AgentRunProgressEvent } from '../agent/operations.js';
import { AgentPAScript, setAgentPAObserver } from '../skills/agentPAScript.js';
import { startAttachmentScanner } from './attachments/scanner.js';
import { startAttachmentOrphanCleanup } from './attachments/orphanCleanup.js';
import { pluginRegistryRoutes } from './plugins/routes.js';
import { providerAuthorizationRoutes } from './plugins/providerAuthorizationRoutes.js';
import { phoneLinkRoutes } from './routes/phoneLink.js';
import { eventIngestionRoutes } from './routes/eventIngestionRoutes.js';
import { adminEventQueueRoutes } from './routes/adminEventQueue.js';
import { aerialRoutes } from './aerial/routes.js';
import { intelligenceEventHandlers } from '../events/eventHandlers.js';
import { startIntelligenceEventWorker } from '../events/eventWorker.js';

const { Pool } = pg;

console.log('🚀 RyanAI Platform Initialization');
console.log('==================================\n');

// Configuration
const nodeEnv = process.env.NODE_ENV || 'production';
const connectionUrls = resolveConnectionUrls(
  nodeEnv,
  process.env.DATABASE_URL,
  process.env.REDIS_URL,
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SESSION_POOLER_HOST,
  process.env.SUPABASE_SSL_ROOT_CERT_PATH,
);
const config = {
  port: parseInt(
    process.env.PORT ||
      (nodeEnv === 'development' ? '3001' : '3000'),
    10,
  ),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv,
  database: { url: connectionUrls.databaseUrl },
  redis: { url: connectionUrls.redisUrl },
};

console.log(`📋 Configuration:`);
console.log(`    - Node Env: ${config.nodeEnv}`);
console.log(`    - Host: ${config.host}:${config.port}`);
console.log(
  `    - Database: ${process.env.DATABASE_URL ? 'URL supplied' : 'Local development/test default'} (connection not yet checked)`,
);
console.log(
  `    - Redis: ${process.env.REDIS_URL ? 'URL supplied' : 'Local development/test default'} (connection not yet checked)\n`,
);

// Pretty logging is reserved for local development. Staging and production
// use structured JSON so the runtime does not depend on dev-only pino-pretty.
const isDevelopment = config.nodeEnv === 'development';

// Initialize Fastify instance with trustProxy and telemetry-aware logger
const fastify = Fastify({
  trustProxy: true,
  logger: {
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    ...(isDevelopment && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    }),
  },
});

// Initialize the core platform Prisma client and the separate optional Neon audiobook client.
fastify.decorate('prisma', prisma);
const audiobookPrisma = getAudiobookPrismaClient();
fastify.decorate('audiobookPrisma', audiobookPrisma);
if (!audiobookPrisma) {
  fastify.log.warn('Audiobook routes are disabled because AUDIOBOOK_DATABASE_URL is not configured.');
}

// Register CORS with an explicit origin allowlist. Reflecting every Origin while
// allowing credentials would let arbitrary websites make authenticated API calls.
const allowedCorsOrigins = parseCorsOrigins(
  process.env.CORS_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.PUBLIC_APP_URL,
);

if (process.env.NODE_ENV !== 'production') {
  [
    'http://localhost:1420',
    'http://127.0.0.1:1420',
    'http://localhost:9090',
    'http://127.0.0.1:9090',
  ].forEach((origin) => allowedCorsOrigins.add(origin));
}

await fastify.register(fastifyCors, {
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
});

installAuthentication(fastify);

// Database pool
let dbPool: pg.Pool;

// Service health status
const serviceStatus = {
  database: false,
  redis: false,
  agentCheckpointer: false,
  api: false,
};

// In degraded startup mode Fastify owns no Redis plugin, so close the reconnecting
// ioredis client explicitly during graceful shutdown.
let redisClient: Awaited<ReturnType<typeof connectRedis>> | undefined;
let redisClientManagedByFastify = false;

// ============================================================================
// API ROUTES REGISTRATION
// ============================================================================

function registerCoreRoutes() {
  const healthCheck = async (_request: FastifyRequest, reply: FastifyReply) => {
    const readiness = await inspectReadiness({
      database: async () => {
        if (!dbPool) throw new Error('PostgreSQL pool is unavailable');
        await dbPool.query('SELECT 1');
      },
      redis: async () => {
        if (!fastify.hasDecorator('redis')) throw new Error('Redis client is unavailable');
        await fastify.redis.ping();
      },
      agentCheckpointerInitialized: serviceStatus.agentCheckpointer,
      apiListening: serviceStatus.api,
      agentQueueListenerReady: isAgentWorkerReady(getAgentTaskWorkerStatus()),
    });
    reply.code(readiness.ready ? 200 : 503);
    return {
      status: readiness.ready ? 'online' : 'degraded',
      service: 'ryanai-api-gateway',
      timestamp: new Date().toISOString(),
      services: readiness.services,
      agentQueue: (() => {
        const worker = getAgentTaskWorkerStatus();
        return {
          state: worker.state,
          recoveryIntervalMs: worker.recoveryIntervalMs,
          listener: worker.listener ? {
            state: worker.listener.state,
            connected: worker.listener.connected,
            subscribed: worker.listener.subscribed,
            reconnectAttempts: worker.listener.reconnectAttempts,
            backoffMs: worker.listener.backoffMs,
            lastConnectedAt: worker.listener.lastConnectedAt,
            lastErrorCode: worker.listener.lastErrorCode,
          } : null,
          lastNotificationAt: worker.lastNotificationAt,
          lastRecoverySweepAt: worker.lastRecoverySweepAt,
          queueClaimState: worker.queueClaimState,
          lastClaimAttemptAt: worker.lastClaimAttemptAt,
          lastSuccessfulClaimAt: worker.lastSuccessfulClaimAt,
          lastClaimError: worker.lastClaimError,
          lastClaimErrorCode: worker.lastClaimErrorCode,
        };
      })(),
      engine: 'LangGraph ReAct',
      architect: 'RyanAI',
      cudaActive: false,
      activeGraph: 'reasoning-agent',
    };
  };

  // Liveness is deliberately independent of dependency readiness. Render and
  // Docker probe /health; keep it 200 while the process is alive so dependency
  // outages do not cause restart loops that prevent PA from reporting recovery.
  const livenessCheck = async () => ({
    status: 'alive',
    service: 'ryanai-api-gateway',
    timestamp: new Date().toISOString(),
    services: {
      api: fastify.server.listening,
      database: serviceStatus.database,
      redis: serviceStatus.redis,
      agentCheckpointer: serviceStatus.agentCheckpointer,
    },
  });
  fastify.get('/livez', livenessCheck);
  fastify.get('/health', livenessCheck);

  // Readiness probes live PostgreSQL and Redis connections on every request.
  fastify.get('/readyz', healthCheck);

  // Studio runs as an independent process; its liveness must not change API liveness.
  fastify.get('/studio-worker/readyz', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const heartbeats = await prisma.studioWorkerHeartbeat.findMany({
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
        select: { workerId: true, status: true, lastSeenAt: true },
      });
      const worker = evaluateStudioWorkerHeartbeats(heartbeats);
      reply.code(worker.ready ? 200 : 503);
      return {
        status: worker.ready ? 'healthy' : 'degraded',
        service: 'studio-worker',
        timestamp: new Date().toISOString(),
        worker: {
          ready: worker.ready,
          state: worker.state,
          lastSeenAt: worker.lastSeenAt,
          ageMs: worker.ageMs,
        },
        staleAfterMs: 30_000,
      };
    } catch {
      reply.code(503);
      return {
        status: 'degraded',
        service: 'studio-worker',
        timestamp: new Date().toISOString(),
        worker: { ready: false, state: 'unavailable' },
      };
    }
  });
  if ((API_ROUTES.healthPath as string) !== '/health') {
    fastify.get(API_ROUTES.healthPath, healthCheck);
  }
  if ((API_ROUTES.healthPath as string) !== '/api/health') {
    fastify.get('/api/health', healthCheck);
  }

  // Sentry integration test route
  fastify.get('/debug-sentry', async () => {
    throw new Error('RyanAI Sentry Integration Test Exception!');
  });

  // Root
  fastify.get('/', async () => {
    return {
      status: 'online',
      service: 'RyanAI API Gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  // Anonymous public survey submissions. Optional Beta contact data is stored separately.
  fastify.post<{
    Body: {
      role?: string;
      aiExperience?: string;
      discovery?: string;
      currentUse?: string;
      features?: string[];
      useCases?: string[];
      usefulness?: string;
      topPriority?: string;
      biggestBarrier?: string;
      trustPriority?: string;
      accessPreference?: string;
      betaInterest?: string;
      feedback?: string;
      privacyConsent?: boolean;
    };
  }>('/api/community-feedback', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = request.body ?? {};
    if (body.privacyConsent !== true) {
      return reply.code(400).send({
        success: false,
        error: 'Privacy acknowledgement is required before submitting survey feedback.',
      });
    }
    const required = [
      body.role, body.aiExperience, body.discovery, body.currentUse,
      body.usefulness, body.topPriority, body.biggestBarrier,
      body.trustPriority, body.accessPreference, body.betaInterest,
    ];
    if (required.some((value) => typeof value !== 'string' || !value.trim())) {
      return reply.code(400).send({ success: false, error: 'Please complete all required survey questions.' });
    }

    const answers = {
      privacyConsent: true,
      privacyConsentAt: new Date().toISOString(),
      role: body.role!.trim().slice(0, 100),
      aiExperience: body.aiExperience!.trim().slice(0, 100),
      discovery: body.discovery!.trim().slice(0, 100),
      currentUse: body.currentUse!.trim().slice(0, 100),
      features: Array.isArray(body.features)
        ? body.features.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : [],
      useCases: Array.isArray(body.useCases)
        ? body.useCases.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : [],
      usefulness: body.usefulness!.trim().slice(0, 100),
      topPriority: body.topPriority!.trim().slice(0, 1200),
      biggestBarrier: body.biggestBarrier!.trim().slice(0, 150),
      trustPriority: body.trustPriority!.trim().slice(0, 150),
      accessPreference: body.accessPreference!.trim().slice(0, 150),
      betaInterest: body.betaInterest!.trim().slice(0, 150),
      feedback: typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 2000) : '',
    };

    try {
      await prisma.$executeRaw`INSERT INTO public.community_feedback_submissions (answers)
        VALUES (${JSON.stringify(answers)}::jsonb)`;
    } catch (err) {
      fastify.log.error({ err }, 'Community feedback submission failed');
      return reply.code(503).send({
        success: false,
        error: 'Survey submissions are temporarily unavailable. Please try again later.',
      });
    }

    // Notify the owner only after the anonymous response is durably stored.
    // SMTP acceptance is not proof of final mailbox delivery.
    const ownerEmail = process.env.RYANAI_OWNER_EMAIL?.trim();
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS;
    let notificationStatus: 'accepted' | 'not_configured' | 'failed' = 'not_configured';

    if (ownerEmail && smtpUser && smtpPass) {
      try {
        const { default: nodemailer } = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT) || 587,
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || smtpUser,
          to: ownerEmail,
          subject: 'New RyanAI Community Survey response',
          text: [
            'A new anonymous RyanAI Community Survey response was received.',
            '',
            'The response contains survey answers only; it does not contain respondent account or contact identity.',
            '',
            JSON.stringify(answers, null, 2),
          ].join('\n'),
        });
        notificationStatus = 'accepted';
      } catch (notificationError) {
        notificationStatus = 'failed';
        fastify.log.error({ err: notificationError }, 'Community survey owner email notification failed');
      }
    } else {
      fastify.log.warn(
        'Community survey saved, but owner email notification is not configured (owner address or SMTP credentials missing).',
      );
    }

    return reply.code(201).send({
      success: true,
      notificationStatus,
      message: 'Thank you. Your feedback has been received.',
    });
  });

  // Beta contact details are kept separate from anonymous survey answers.
  fastify.post<{ Body: { name?: string; email?: string; consent?: boolean } }>(
    '/api/community-beta-interest',
    { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const name = typeof request.body?.name === 'string'
        ? request.body.name.trim().slice(0, 100)
        : '';
      const email = typeof request.body?.email === 'string'
        ? request.body.email.trim().slice(0, 254)
        : '';

      if (request.body?.consent !== true) {
        return reply.code(400).send({ success: false, error: 'Consent is required to register Beta interest.' });
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({ success: false, error: 'Please provide a valid email address.' });
      }

      try {
        await prisma.$executeRaw`INSERT INTO public.community_beta_interest (name, email, consent)
          VALUES (${name || null}, ${email}, true)`;
        return reply.code(201).send({ success: true, message: 'Your Beta interest has been recorded.' });
      } catch (err) {
        fastify.log.error({ err }, 'Community Beta interest registration failed');
        return reply.code(503).send({
          success: false,
          error: 'Beta registration is temporarily unavailable. Please try again later.',
        });
      }
    },
  );

  function contentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    return JSON.stringify(content) ?? String(content);
  }

  function authorizeUserReasoning(principal: string) {
    const environment = config.nodeEnv === 'production' ? 'production'
      : config.nodeEnv === 'staging' ? 'staging' : 'development';
    const policy = evaluateGenXSecurityEvent({
      agentId: 'ryanai-api',
      principal,
      toolName: 'api_reasoning_request',
      action: 'NETWORK',
      target: 'configured-approved-provider',
      environment,
      actorType: 'human',
    });
    if (policy.decision !== 'ALLOW') {
      fastify.log.warn({ ruleId: policy.ruleId, principal }, 'Gen-X denied user reasoning request');
    }
    return policy;
  }

  async function runReasoning(
    prompt: string,
    model?: string,
    user?: FastifyRequest['authUser'],
    language?: string,
    onProgress?: (event: AgentRunProgressEvent) => void,
  ) {
    const result = await invokeReasoningAgent({ prompt, model, user, language, onProgress });
    const reasoningTrace = result.messages.map(
      (message: { content: unknown }) => contentToText(message.content),
    );
    const output = reasoningTrace.at(-1) ?? '';

    return {
      success: true,
      objective: prompt,
      output,
      reasoningTrace,
      engine: result.engine ?? 'RyanAI Three-Brain Orchestrator',
      response: output,
      trace: reasoningTrace,
      runId: result.runId,
      handoffs: result.handoffs,
      timestamp: new Date().toISOString(),
    };
  }

  const reasoningBodySchema = {
    body: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 20000 },
        model: { type: 'string', maxLength: 100 },
        sessionId: { type: 'string', maxLength: 200 },
        language: { type: 'string', maxLength: 16 },
      },
    },
  };

  const handleReasoningRequest = async (
    request: FastifyRequest<{ Body: { prompt?: string; model?: string; language?: string } }>,
    reply: FastifyReply,
  ) => {
    if (!request.authUser?.id) {
      return reply.code(401).send({
        success: false,
        error: 'Sign in to use traceable three-brain reasoning.',
      });
    }
    const prompt = request.body?.prompt?.trim();
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }
    if (authorizeUserReasoning(request.authUser.id).decision !== 'ALLOW') {
      return reply.code(403).send({ success: false, error: 'Gen-X denied this reasoning request.' });
    }

    try {
      return await runReasoning(prompt, request.body?.model, request.authUser, request.body?.language);
    } catch (err) {
      fastify.log.error({ err }, 'Reasoning request failed');
      return reply.code(502).send({
        success: false,
        error: 'Reasoning provider request failed. Please try again later.',
      });
    }
  };

  // Collision-free reasoning endpoint registrations
  fastify.post<{ Body: { prompt?: string; model?: string; language?: string } }>(
    API_ROUTES.reasonPath,
    { schema: reasoningBodySchema },
    handleReasoningRequest,
  );
  if (API_ROUTES.reasonPath !== '/api/reason') {
    fastify.post<{ Body: { prompt?: string; model?: string; language?: string } }>(
      '/api/reason',
      { schema: reasoningBodySchema },
      handleReasoningRequest,
    );
  }

  // Reasoning stream endpoint
  fastify.post<{
    Body: { prompt?: string; sessionId?: string; model?: string; language?: string };
  }>(API_ROUTES.streamPath, { schema: reasoningBodySchema }, async (request, reply) => {
    if (!request.authUser?.id) {
      return reply.code(401).send({
        success: false,
        error: 'Sign in to use traceable three-brain reasoning.',
      });
    }
    const prompt = request.body?.prompt?.trim();
    const { sessionId } = request.body || {};
    if (!prompt) {
      return reply
        .code(400)
        .send({ success: false, error: 'A non-empty prompt is required' });
    }
    if (authorizeUserReasoning(request.authUser.id).decision !== 'ALLOW') {
      return reply.code(403).send({ success: false, error: 'Gen-X denied this reasoning request.' });
    }

    reply.hijack();
    const { raw } = reply;

    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) raw.setHeader(name, value);
    }
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');

    let isDisconnected = false;
    raw.on('close', () => {
      isDisconnected = true;
    });

    const sendEvent = (data: Record<string, unknown>) => {
      if (!isDisconnected && !raw.writableEnded) {
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      sendEvent({
        status: 'processing',
        message: `Running reasoning for ${sessionId || 'default'}...`,
      });
      const result = await runReasoning(
        prompt,
        request.body?.model,
        request.authUser,
        request.body?.language,
        (progress) => sendEvent({
          status: 'processing',
          message: 'Persisted brain handoff state changed.',
          runId: progress.runId,
          runStatus: progress.status,
          handoffs: progress.handoffs.map(({ fromAgent, toAgent, status, startedAt, completedAt, error }) => ({
            fromAgent, toAgent, status, startedAt, completedAt, error,
          })),
        }),
      );
      sendEvent({
        status: 'complete',
        result: result.output,
        reasoningTrace: result.reasoningTrace,
        runId: result.runId,
        handoffs: result.handoffs,
      });
    } catch (err: unknown) {
      fastify.log.error({ err }, 'Streaming reasoning request failed');
      sendEvent({
        error: 'Reasoning provider request failed. Please try again later.',
      });
    } finally {
      if (!raw.writableEnded) {
        raw.end();
      }
    }
  });

  // This legacy route previously echoed a requested tool/action and returned
  // success without executing anything. Fail explicitly instead of reporting a
  // false success; real MCP calls belong on the dedicated Streamable HTTP server.
  fastify.post<{
    Body: { action?: string; tool?: string; payload?: Record<string, unknown> };
  }>('/api/mcp', async (request, reply) => {
    const { action, tool } = request.body || {};

    if (!action && !tool) {
      return reply
        .code(400)
        .send({ success: false, error: 'Missing action or tool parameter' });
    }

    return reply.code(501).send({
      success: false,
      error: 'MCP tool execution is not available through this legacy API route. Use the dedicated Streamable HTTP MCP service at /mcp.',
    });
  });

  // System info
  fastify.get('/api/system', async () => {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      env: config.nodeEnv,
    };
  });
}

// ============================================================================
// INITIALIZATION FUNCTIONS
// ============================================================================

async function initializeDatabase() {
  console.log('📡 Initializing Database...');
  try {
    dbPool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    const result = await dbPool.query('SELECT NOW()');
    const schema = await inspectDatabaseSchema((sql) => dbPool!.query(sql));

    if (!schema.communications) {
      throw new Error(
        'Required communication schema is missing. Run npm run db:migrate before starting the API.',
      );
    }

    console.log(`✓ Database connected: ${result.rows[0].now}`);
    serviceStatus.database = true;
    serviceStatus.agentCheckpointer = schema.agentCheckpointer;

    if (!schema.agentCheckpointer) {
      console.warn(
        '⚠️ Agent checkpointer schema is not prepared. Run npm run db:migrate before enabling agent execution.',
      );
    }

    return true;
  } catch (err) {
    console.error(
      `✗ Database connection failed:`,
      databaseFailureDiagnostic(err),
    );
    return false;
  }
}

async function verifyRedis() {
  console.log('⚡ Initializing Redis...');
  try {
    if (!fastify.hasDecorator('redis')) throw new Error('Redis client is unavailable');
    const pong = await fastify.redis.ping();
    console.log(`✓ Redis connected: ${pong}`);
    serviceStatus.redis = true;
    return true;
  } catch {
    console.error(
      `✗ Redis connection failed:`,
      'Redis health probe failed. Raw error details are omitted to protect credentials.',
    );
    return false;
  }
}

// ============================================================================
// MIDDLEWARE & PLUGINS INITIALIZATION
// ============================================================================

async function registerPlugins() {
  // Register liveness/readiness routes before optional infrastructure plugins.
  registerCoreRoutes();
  const redis = await connectRedis(config.redis.url, 5000, true);
  redisClient = redis;
  const redisReadyAtStartup = isRedisReady(redis);

  // Register foundational Fastify plugins first. @fastify/redis waits for a
  // ready client during boot; registering a reconnecting client makes Avvio
  // time out and prevents the HTTP listener from completing startup.
  await fastify.register(fastifyWebsocket);

  if (redisReadyAtStartup) {
    await fastify.register(fastifyRedis, {
      client: redis,
      closeClient: true,
    });
    redisClientManagedByFastify = true;
  } else {
    // Keep the reconnecting ioredis client available to dependency probes and
    // Redis-backed handlers. They remain unavailable until PING succeeds, but
    // their outage must not prevent liveness routes and the API listener.
    // The plugin augments FastifyRedis with a namespace index signature.
    // Degraded mode attaches the same ioredis client directly and does not use
    // namespace lookups, so align the decorator value with Fastify's declared type.
    // In degraded startup the reconnecting ioredis client is attached directly.
    // The plugin type augmentation models a different namespaced client shape.
    fastify.decorate('redis', redis as never);
    fastify.log.warn(
      { redisStatus: redis.status },
      'Redis is not ready at startup; continuing in degraded mode while the client reconnects.',
    );
  }

  // When Redis is unavailable, @fastify/rate-limit uses its process-local store.
  // This preserves per-process limits without blocking startup on a network dependency.
  await fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    ...(redisReadyAtStartup ? { redis: fastify.redis } : {}),
  });
  if (!redisReadyAtStartup) {
    fastify.log.warn(
      'Distributed rate limiting is unavailable; process-local limits are active until Redis is ready.',
    );
  }

  // 2. Register WebSocket routes after rate-limiting and redis are fully decorated
  await registerWebSocketRoutes(fastify);

  // 3. Register Application & Webhook Routes
  await fastify.register(authPlugin);
  await fastify.register(authSigninRoute);
  await fastify.register(githubIntegrationRoutes);
  await fastify.register(pluginRegistryRoutes);
  await fastify.register(providerAuthorizationRoutes);
  await fastify.register(phoneLinkRoutes);
  await fastify.register(eventIngestionRoutes);
  await fastify.register(adminEventQueueRoutes);
  await fastify.register(aerialRoutes);
  await fastify.register(commsPlugin);
  await fastify.register(commsAuthorizationRoutes);
  await fastify.register(approvalRoutes);
  await fastify.register(engineeringEvidenceRoutes);
  await fastify.register(slackInteractionsPlugin);
  await fastify.register(twilioWebhookPlugin);
  await fastify.register(metricsRoutes);
  await fastify.register(adminAuditRoutes);
  await fastify.register(adminUsersRoutes);
  await fastify.register(langGraphCheckpointerSetupRoutes);
  await fastify.register(adminAccountLifecycleRoutes);
  await fastify.register(quantRoutes);
  await fastify.register(quantPortfolioOptimizationRoutes);
  await fastify.register(quantStreamingRoutes);
  await fastify.register(quantReconciliationRoutes);
  await fastify.register(quantPaperSafetyRoutes);
  await fastify.register(tasksRoutes);
  await fastify.register(agentOperationsRoutes);
  await fastify.register(memoryRoutes);
  await fastify.register(realtimeVoiceRoutes);
  await fastify.register(audioIntelligenceRoutes);
  await fastify.register(audiobookProjectRoutes);
  await fastify.register(pendingActionsRoutes);
  await fastify.register(jarvisRoutes);
  await fastify.register(internalJarvisRoutes);
  await fastify.register(mcpDelegationRoutes);
  await fastify.register(providerGatewayRoutes);
  await fastify.register(registerPatchRoutes);
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function start() {
  try {
    console.log('\n🔧 Registering plugins and health routes...\n');
    try {
      await registerPlugins();
    } catch {
      // Core liveness routes are registered before Redis setup. Keep the HTTP
      // process available for diagnostics even if an optional plugin fails.
      fastify.log.error(
        'Redis/plugin initialization failed. Raw connection details are omitted to protect credentials.',
      );
    }

    // Bind the HTTP listener before any network-dependent database probe.
    console.log('\n🚀 Starting Fastify Server...\n');
    await fastify.listen({ port: config.port, host: config.host });
    serviceStatus.api = true;

    console.log('\n✓ RyanAI API Gateway is running!');
    console.log('\n📍 Endpoints:');
    console.log('    - Root: http://' + config.host + ':' + config.port + '/');
    console.log('    - Health: http://' + config.host + ':' + config.port + '/health');
    console.log('    - Readiness: http://' + config.host + ':' + config.port + '/readyz');
    console.log('    - System: http://' + config.host + ':' + config.port + '/api/system');
    console.log('    - Signin: http://' + config.host + ':' + config.port + '/signin');

    // Probe PostgreSQL only after the listener is available. Failed credentials
    // leave readiness degraded, but cannot prevent PA from reporting the outage.
    const [databaseReady, redisReady] = await Promise.all([
      initializeDatabase(),
      verifyRedis(),
    ]);

    if (!databaseReady || !redisReady || !serviceStatus.agentCheckpointer) {
      fastify.log.warn({
        database: databaseReady,
        redis: redisReady,
        agentCheckpointer: serviceStatus.agentCheckpointer,
      }, 'API listener remains live in degraded mode; PA monitoring continues until dependencies recover.');
    }
    fastify.log.info(startupSummary(serviceStatus));
    fastify.log.info({ startupSummary: startupSummary(serviceStatus) }, 'RyanAI startup dependency summary');

    const syncAgentWorker = (databaseHealthy: boolean, redisHealthy: boolean) => {
      // Provider probes depend on primary PostgreSQL/checkpointer readiness,
      // not Redis. Keep them running after transient database recovery.
      const canMonitorBrains = databaseHealthy && serviceStatus.agentCheckpointer;
      if (canMonitorBrains && !stopBrainMonitor) {
        stopBrainMonitor = startBrainHealthMonitor();
        fastify.log.info('Brain health monitor started after database/checkpointer readiness.');
      } else if (!canMonitorBrains && stopBrainMonitor) {
        stopBrainMonitor();
        stopBrainMonitor = undefined;
        fastify.log.warn('Brain health monitor stopped because database/checkpointer readiness was lost.');
      }

      // Durable agent execution additionally requires Redis and its queue listener.
      const canRun = canMonitorBrains && redisHealthy;
      if (canRun && !stopAgentWorker) {
        stopAgentWorker = startAgentTaskWorker();
        fastify.log.info('Durable agent task worker started after dependency recovery.');
      } else if (!canRun && stopAgentWorker) {
        stopAgentWorker();
        stopAgentWorker = undefined;
        fastify.log.warn('Durable agent task worker stopped because a required dependency is unavailable.');
      }
    };
    syncAgentWorker(databaseReady, redisReady);

    if (process.env.INTELLIGENCE_EVENT_WORKER_ENABLED === 'true' && databaseReady) {
      stopIntelligenceEventWorker = startIntelligenceEventWorker(prisma, intelligenceEventHandlers, {
        onError: (error) => fastify.log.error({ err: error }, 'Intelligence event worker iteration failed.'),
      }) ?? undefined;
      if (stopIntelligenceEventWorker) fastify.log.info({ handlers: intelligenceEventHandlers.supportedEventTypes() }, 'Intelligence event worker started.');
      else fastify.log.warn('Intelligence event worker requested but remains inactive: no trusted event handlers are registered.');
    }
    const paObserver = new AgentPAScript({
      fastifyPort: config.port,
      heartbeatIntervalMs: Number(process.env.PA_HEARTBEAT_INTERVAL_MS ?? 15000),
      healthCheck: async () => {
        const mcpHealthUrl = process.env.RYANAI_MCP_HEALTH_URL?.trim();
        const probeMcp = async (): Promise<boolean | null> => {
          if (!mcpHealthUrl) return null;
          try {
            const url = new URL(mcpHealthUrl);
            const localHost = ['localhost', '127.0.0.1', '::1', '[::1]', 'mcp-server'].includes(url.hostname.toLowerCase());
            if (url.pathname !== '/health' || !['http:', 'https:'].includes(url.protocol)
              || url.username || url.password || url.search || url.hash
              || (url.protocol !== 'https:' && !localHost)) return false;
            const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
            return response.ok;
          } catch {
            return false;
          }
        };
        const probeNeon = async (): Promise<boolean | null> => {
          if (!audiobookPrisma) return null;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              audiobookPrisma.$queryRawUnsafe('SELECT 1'),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Neon health probe timed out')), 1500);
              }),
            ]);
            return true;
          } catch {
            return false;
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        };
        const [database, redis, mcp, neon] = await Promise.allSettled([
          (async () => {
            if (!dbPool) throw new Error('PostgreSQL pool is unavailable');
            await dbPool.query('SELECT 1');
            const schema = await inspectDatabaseSchema((sql) => dbPool!.query(sql));
            serviceStatus.database = true;
            serviceStatus.agentCheckpointer = schema.agentCheckpointer;
          })(),
          (async () => {
            if (!fastify.hasDecorator('redis')) throw new Error('Redis client is unavailable');
            return fastify.redis.ping();
          })(),
          probeMcp(),
          probeNeon(),
        ]);
        const worker = getAgentTaskWorkerStatus();
        const snapshot = {
          api: fastify.server.listening,
          database: database.status === 'fulfilled',
          redis: redis.status === 'fulfilled' && redis.value === 'PONG',
          agentCheckpointer: serviceStatus.agentCheckpointer,
          agentWorker: isAgentWorkerReady(worker),
          mcpServer: mcp.status === 'fulfilled' ? mcp.value : false,
          neonAudiobookDatabase: audiobookPrisma
            ? neon.status === 'fulfilled' && neon.value === true
            : null,
        };
        serviceStatus.database = snapshot.database;
        serviceStatus.redis = snapshot.redis;
        if (!snapshot.database) serviceStatus.agentCheckpointer = false;
        syncAgentWorker(snapshot.database, snapshot.redis);
        return snapshot;
      },
    });
    paObserver.on('report', (report) => fastify.log.info({ pa: report }, 'PA observer report'));
    paObserver.on('healthCheckFailed', (report) => fastify.log.warn({ pa: report }, 'PA observer health degraded'));
    paObserver.on('transition', (transition) => fastify.log.warn({ paTransition: transition }, 'PA dependency state transition'));
    setAgentPAObserver(paObserver);
    await paObserver.start();
    stopAgentPA = () => { void paObserver.stop().finally(() => setAgentPAObserver(null)); };

    if (process.env.ATTACHMENT_SCANNER_ENABLED === 'true') {
      stopAttachmentScanner = startAttachmentScanner();
    }
    if (process.env.ATTACHMENT_ORPHAN_CLEANUP_ENABLED === 'true') {
      stopAttachmentOrphanCleanup = startAttachmentOrphanCleanup();
    }

    // Scheduled tasks start AI runs with no person present, and those runs cost
    // money. Turn them on with an explicit setting.
    if (process.env.SCHEDULER_ENABLED === 'true') {
      stopScheduler = startScheduler();
    }

    // Alerts send messages to the owner with no person present. Turn them on
    // with an explicit setting. A setting that cannot work stops the start with
    // a clear error, so a typo never leaves you without alerts.
    if (process.env.ALERTS_ENABLED === 'true') {
      stopAlerts = startAlerts();
    }
  } catch (err) {
    fastify.log.fatal(err);
    process.exit(1);
  }
}

// Graceful shutdown hooks
let stopScheduler: (() => void) | undefined;
let stopBrainMonitor: (() => void) | undefined;
let stopAgentWorker: (() => void) | undefined;
let stopAttachmentScanner: (() => void) | undefined;
let stopAttachmentOrphanCleanup: (() => void) | undefined;
let stopAlerts: (() => void) | undefined;
let stopAgentPA: (() => void) | undefined;
let stopIntelligenceEventWorker: (() => void) | undefined;
const shutdown = async () => {
  console.log('\n📴 Shutting down gracefully...');
  stopScheduler?.();
  stopBrainMonitor?.();
  stopAgentWorker?.();
  stopAttachmentScanner?.();
  stopAttachmentOrphanCleanup?.();
  stopAlerts?.();
  stopAgentPA?.();
  stopIntelligenceEventWorker?.();
  if (redisClient && !redisClientManagedByFastify) {
    redisClient.disconnect();
  }
  if (dbPool) await dbPool.end();
  if (prisma) await prisma.$disconnect();
  if (audiobookPrisma) await audiobookPrisma.$disconnect();
  await fastify.close();
  await shutdownTelemetry();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();