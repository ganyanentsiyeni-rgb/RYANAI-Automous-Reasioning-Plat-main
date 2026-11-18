import { z } from 'zod';

/**
 * Provider-neutral event envelope shared by RyanAI integrations.
 *
 * This is a validation contract only: it does not publish, persist, authorize,
 * or execute events. Producers must treat external payloads as untrusted data.
 */
export const RyanAIEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  schemaVersion: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  source: z
    .object({
      provider: z.string().min(1).max(80),
      service: z.string().min(1).max(80).optional(),
    })
    .strict(),
  correlationId: z.string().min(1).max(160).optional(),
  idempotencyKey: z.string().min(1).max(200),
  classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export type RyanAIEventEnvelope = z.infer<typeof RyanAIEventEnvelopeSchema>;
