import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { IntelligenceEventInbox, EventIdempotencyConflictError } from '../../events/intelligenceEventInbox.js';
import { verifyEventRequestSignature } from '../../events/eventSignature.js';

const MAX_EVENT_BODY_BYTES = 256 * 1024;

/**
 * Signed machine-to-machine event intake. It only validates and persists
 * envelopes; it never dispatches provider actions or interprets payloads.
 */
export const eventIngestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/events/ingest', {
    bodyLimit: MAX_EVENT_BODY_BYTES,
  }, async (request, reply) => {
    const secret = process.env.RYANAI_EVENT_INGESTION_SECRET?.trim();
    if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
      return reply.code(503).send({ status: 'not_configured', error: 'Signed event ingestion is not configured.' });
    }

    const verification = verifyEventRequestSignature({
      secret,
      timestamp: request.headers['x-ryanai-timestamp'],
      signature: request.headers['x-ryanai-signature'],
      body: request.body,
    });
    if (!verification.valid) {
      return reply.code(401).send({ status: 'unauthorized', error: 'Invalid or expired event signature.' });
    }

    try {
      const inbox = new IntelligenceEventInbox(fastify.prisma);
      const result = await inbox.enqueue(request.body);
      return reply.code(result.duplicate ? 200 : 202).send({
        status: result.duplicate ? 'duplicate' : 'accepted',
        eventId: result.event.eventId,
      });
    } catch (error) {
      if (error instanceof EventIdempotencyConflictError) {
        return reply.code(409).send({ status: 'conflict', error: 'Event identity or idempotency key conflicts with an existing event.' });
      }
      if (error instanceof ZodError) {
        return reply.code(400).send({ status: 'invalid_event', error: 'Event envelope failed validation.' });
      }
      throw error;
    }
  });
};
