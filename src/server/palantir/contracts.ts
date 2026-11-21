import { z } from 'zod';

/**
 * Contract-only boundary for a future Palantir Foundry pilot.
 * This module performs local validation only; it makes no network calls and
 * does not grant or execute provider capabilities.
 */
const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const correlationId = z.string().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const classification = z.enum(['public', 'internal', 'confidential', 'restricted']);
const scalarAttribute = z.union([
  z.string().max(512),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const forbiddenAttributeKey = /(?:secret|token|password|credential|authorization|subscriber|imsi|imei|phone|prompt|raw[_-]?payload)/i;

const safeAttributesSchema = z.record(z.string().min(1).max(64), scalarAttribute)
  .superRefine((attributes, context) => {
    for (const key of Object.keys(attributes)) {
      if (forbiddenAttributeKey.test(key)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Sensitive or unrestricted attribute names are not permitted in a Foundry projection.',
        });
      }
    }
  });

export const FoundryObjectTypeSchema = z.enum([
  'Mission',
  'Task',
  'TaskAttempt',
  'AgentRun',
  'ChangeProposal',
  'VerificationEvidence',
  'ServiceHealthObservation',
  'RANCell',
  'RANMetric',
]);

export const FoundryProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.literal('palantir-foundry'),
  objectType: FoundryObjectTypeSchema,
  sourceId: identifier,
  sourceRevision: identifier,
  ownerScope: identifier,
  observedAt: z.string().datetime({ offset: true }),
  classification,
  provenanceRef: identifier,
  correlationId,
  accessMode: z.literal('read_only'),
  attributes: safeAttributesSchema,
}).strict();

export const PalantirReadToolContractSchema = z.object({
  schemaVersion: z.literal(1),
  toolName: z.string().min(1).max(120).regex(/^[a-z][a-z0-9_.-]*$/),
  accessMode: z.literal('read'),
  resourceScopes: z.array(identifier).min(1).max(20),
  requiredCapability: identifier,
  timeoutMs: z.number().int().min(1).max(30_000),
  rateLimitPerMinute: z.number().int().min(1).max(120),
  idempotent: z.literal(true),
  auditRequired: z.literal(true),
  owner: z.literal('ryanai'),
}).strict();

export type FoundryProjection = z.infer<typeof FoundryProjectionSchema>;
export type PalantirReadToolContract = z.infer<typeof PalantirReadToolContractSchema>;

export function parseFoundryProjection(value: unknown): FoundryProjection | null {
  const parsed = FoundryProjectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePalantirReadToolContract(value: unknown): PalantirReadToolContract | null {
  const parsed = PalantirReadToolContractSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
