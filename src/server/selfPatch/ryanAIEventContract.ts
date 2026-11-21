import { z } from 'zod';

/**
 * RyanAI-only event contract for Comms receipts and Self-Patch observations.
 * Shape validation only: no transport, persistence, authorization, execution,
 * or message delivery is performed here.
 */
export const RYANAI_REPOSITORY = 'ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main';

export const COMMS_DELIVERY_STATES = [
  'not_configured',
  'blocked_by_policy_boundary',
  'blocked_by_provider',
  'queued',
  'accepted_by_provider',
  'delivered',
  'failed',
  'unknown',
  'not_tested',
] as const;

const commonFields = {
  schemaVersion: z.literal(1),
  repository: z.literal(RYANAI_REPOSITORY),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  eventId: z.string().uuid(),
  correlationId: z.string().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  occurredAt: z.string().datetime({ offset: true }),
};

const commsReceiptSchema = z.object({
  ...commonFields,
  eventType: z.literal('comms.delivery.receipt'),
  source: z.literal('ryanai-comms'),
  channel: z.enum(['sms', 'whatsapp', 'voice', 'email']),
  state: z.enum(COMMS_DELIVERY_STATES),
  providerReferenceHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict().superRefine((event, context) => {
  if (event.state === 'delivered' && !event.providerReferenceHash) {
    context.addIssue({
      code: 'custom',
      path: ['providerReferenceHash'],
      message: 'A delivered receipt requires a validated provider reference hash.',
    });
  }
});

const selfPatchFindingSchema = z.object({
  ...commonFields,
  eventType: z.literal('selfpatch.audit.finding'),
  source: z.literal('ryanai-self-patch'),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  findingCode: z.string().min(3).max(120).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
}).strict();

export const RyanAIEventSchema = z.discriminatedUnion('eventType', [
  commsReceiptSchema,
  selfPatchFindingSchema,
]);

export type CommsDeliveryState = (typeof COMMS_DELIVERY_STATES)[number];
export type RyanAIEvent = z.infer<typeof RyanAIEventSchema>;

/** Return a validated event, or null for malformed, untrusted, or out-of-scope input. */
export function parseRyanAIEvent(value: unknown): RyanAIEvent | null {
  const parsed = RyanAIEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
