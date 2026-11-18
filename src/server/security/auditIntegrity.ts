import { createHash } from 'node:crypto';

export interface AuditIntegrityRecord {
  id: string;
  actorId: string;
  eventType: string;
  resourceId: string | null;
  details: unknown;
}

export interface AuditIntegrityMetadata {
  version: 1;
  previousHash: string;
  eventHash: string;
}

export interface AuditIntegrityVerification {
  valid: boolean;
  checked: number;
  legacyUnverified: number;
  firstInvalidEventId: string | null;
  headHash: string;
}

const GENESIS_HASH = '0'.repeat(64);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ':' + canonicalize(record[key]),
  ).join(',') + '}';
}

function payloadFor(record: AuditIntegrityRecord): string {
  const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
    ? { ...(record.details as Record<string, unknown>) }
    : record.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    delete (details as Record<string, unknown>).integrity;
  }
  return canonicalize({
    id: record.id,
    actorId: record.actorId,
    eventType: record.eventType,
    resourceId: record.resourceId,
    details,
  });
}

export function createAuditIntegrity(
  record: AuditIntegrityRecord,
  previousHash: string = GENESIS_HASH,
): AuditIntegrityMetadata {
  if (!/^[a-f0-9]{64}$/i.test(previousHash)) {
    throw new Error('previousHash must be a SHA-256 hex digest.');
  }
  const eventHash = createHash('sha256')
    .update(previousHash.toLowerCase() + '\n' + payloadFor(record))
    .digest('hex');
  return { version: 1, previousHash: previousHash.toLowerCase(), eventHash };
}

export function verifyAuditIntegrity(
  records: readonly AuditIntegrityRecord[],
): AuditIntegrityVerification {
  let headHash = GENESIS_HASH;
  let checked = 0;
  let legacyUnverified = 0;
  let firstInvalidEventId: string | null = null;
  let chainStarted = false;

  for (const record of records) {
    const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? record.details as Record<string, unknown>
      : {};
    const metadata = details.integrity as Partial<AuditIntegrityMetadata> | undefined;
    if (!metadata) {
      if (!chainStarted) {
        legacyUnverified += 1;
        continue;
      }
      firstInvalidEventId = record.id;
      break;
    }
    chainStarted = true;
    if (metadata.version !== 1 || metadata.previousHash !== headHash ||
        typeof metadata.eventHash !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.eventHash)) {
      firstInvalidEventId = record.id;
      break;
    }
    const expected = createAuditIntegrity(record, headHash);
    if (expected.eventHash !== metadata.eventHash.toLowerCase()) {
      firstInvalidEventId = record.id;
      break;
    }
    headHash = expected.eventHash;
    checked += 1;
  }

  return {
    valid: firstInvalidEventId === null,
    checked,
    legacyUnverified,
    firstInvalidEventId,
    headHash,
  };
}

export const AUDIT_INTEGRITY_GENESIS_HASH = GENESIS_HASH;
