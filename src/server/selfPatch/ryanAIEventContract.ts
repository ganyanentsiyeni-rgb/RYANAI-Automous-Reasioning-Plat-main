/**
 * RyanAI-only event contract for Self-Patch / PA observation.
 *
 * This module validates shape and scope only. It does not authenticate transport,
 * authorize actions, send communications, or import Gen-X/Jarvis policy.
 * The receiving adapter must authenticate the transport before calling this parser.
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

export type CommsDeliveryState = (typeof COMMS_DELIVERY_STATES)[number];
export type RyanAIEvent =
  | {
      schemaVersion: 1;
      eventType: 'comms.delivery.receipt';
      source: 'ryanai-comms';
      repository: typeof RYANAI_REPOSITORY;
      commitSha: string;
      eventId: string;
      correlationId: string;
      occurredAt: string;
      channel: 'whatsapp' | 'sms' | 'voice' | 'email';
      state: CommsDeliveryState;
      providerReferenceHash?: string;
    }
  | {
      schemaVersion: 1;
      eventType: 'selfpatch.audit.finding';
      source: 'ryanai-self-patch';
      repository: typeof RYANAI_REPOSITORY;
      commitSha: string;
      eventId: string;
      correlationId: string;
      occurredAt: string;
      severity: 'info' | 'warning' | 'error' | 'critical';
      findingCode: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const SAFE_CODE = /^[a-z][a-z0-9._-]{1,63}$/;
const SAFE_CORRELATION = /^[a-zA-Z0-9._:-]{16,128}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validBase(value: Record<string, unknown>): boolean {
  return value.schemaVersion === 1
    && value.repository === RYANAI_REPOSITORY
    && typeof value.commitSha === 'string' && SHA.test(value.commitSha)
    && typeof value.eventId === 'string' && UUID.test(value.eventId)
    && typeof value.correlationId === 'string' && SAFE_CORRELATION.test(value.correlationId)
    && typeof value.occurredAt === 'string' && ISO_DATE.test(value.occurredAt)
    && Number.isFinite(Date.parse(value.occurredAt));
}

/**
 * Returns a sanitized, typed event or null. Unknown fields are rejected so
 * message bodies, recipient addresses, credentials and arbitrary payloads
 * cannot accidentally cross this event boundary.
 */
export function parseRyanAIEvent(input: unknown): RyanAIEvent | null {
  if (!isRecord(input) || !validBase(input)) return null;

  if (input.eventType === 'comms.delivery.receipt') {
    const allowed = [
      'schemaVersion', 'eventType', 'source', 'repository', 'commitSha',
      'eventId', 'correlationId', 'occurredAt', 'channel', 'state',
      'providerReferenceHash',
    ] as const;
    if (!hasOnlyKeys(input, allowed)
      || input.source !== 'ryanai-comms'
      || !['whatsapp', 'sms', 'voice', 'email'].includes(String(input.channel))
      || !COMMS_DELIVERY_STATES.includes(input.state as CommsDeliveryState)
      || (input.state === 'delivered' && (typeof input.providerReferenceHash !== 'string'
        || !/^[0-9a-f]{64}$/i.test(input.providerReferenceHash)))
      || (input.providerReferenceHash !== undefined
        && (typeof input.providerReferenceHash !== 'string'
          || !/^[0-9a-f]{64}$/i.test(input.providerReferenceHash)))) return null;

    return {
      schemaVersion: 1,
      eventType: 'comms.delivery.receipt',
      source: 'ryanai-comms',
      repository: RYANAI_REPOSITORY,
      commitSha: input.commitSha as string,
      eventId: input.eventId as string,
      correlationId: input.correlationId as string,
      occurredAt: input.occurredAt as string,
      channel: input.channel as 'whatsapp' | 'sms' | 'voice' | 'email',
      state: input.state as CommsDeliveryState,
      ...(input.providerReferenceHash ? { providerReferenceHash: input.providerReferenceHash as string } : {}),
    };
  }

  if (input.eventType === 'selfpatch.audit.finding') {
    const allowed = [
      'schemaVersion', 'eventType', 'source', 'repository', 'commitSha',
      'eventId', 'correlationId', 'occurredAt', 'severity', 'findingCode',
    ] as const;
    if (!hasOnlyKeys(input, allowed)
      || input.source !== 'ryanai-self-patch'
      || !['info', 'warning', 'error', 'critical'].includes(String(input.severity))
      || typeof input.findingCode !== 'string' || !SAFE_CODE.test(input.findingCode)) return null;

    return {
      schemaVersion: 1,
      eventType: 'selfpatch.audit.finding',
      source: 'ryanai-self-patch',
      repository: RYANAI_REPOSITORY,
      commitSha: input.commitSha as string,
      eventId: input.eventId as string,
      correlationId: input.correlationId as string,
      occurredAt: input.occurredAt as string,
      severity: input.severity as 'info' | 'warning' | 'error' | 'critical',
      findingCode: input.findingCode,
    };
  }

  return null;
}
