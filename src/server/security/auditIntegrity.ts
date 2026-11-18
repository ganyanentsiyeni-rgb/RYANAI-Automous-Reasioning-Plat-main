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

/**
 * Verifies by following previousHash links, not by trusting database sort order.
 * This makes equal timestamps and random UUID tie-breakers irrelevant. A fork,
 * disconnected component, duplicate predecessor, malformed link, or payload
 * edit is invalid. Unhashed historical rows remain explicitly unverified.
 */
export function verifyAuditIntegrity(
  records: readonly AuditIntegrityRecord[],
): AuditIntegrityVerification {
  const legacy = records.filter((record) => {
    const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? record.details as Record<string, unknown>
      : {};
    return !Object.prototype.hasOwnProperty.call(details, 'integrity');
  });
  const linked = records.filter((record) => {
    const details = record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? record.details as Record<string, unknown>
      : {};
    return Object.prototype.hasOwnProperty.call(details, 'integrity');
  });
  const byPreviousHash = new Map<string, AuditIntegrityRecord[]>();
  for (const record of linked) {
    const details = record.details as Record<string, unknown>;
    const metadata = details.integrity as Partial<AuditIntegrityMetadata> | undefined;
    const previousHash = metadata?.previousHash;
    if (typeof previousHash !== 'string' || !/^[a-f0-9]{64}$/i.test(previousHash)) {
      return { valid: false, checked: 0, legacyUnverified: legacy.length, firstInvalidEventId: record.id, headHash: GENESIS_HASH };
    }
    const key = previousHash.toLowerCase();
    const bucket = byPreviousHash.get(key) ?? [];
    bucket.push(record);
    byPreviousHash.set(key, bucket);
  }

  let headHash = GENESIS_HASH;
  let checked = 0;
  const visited = new Set<string>();
  while (true) {
    const candidates = byPreviousHash.get(headHash) ?? [];
    if (candidates.length === 0) break;
    if (candidates.length !== 1) {
      return { valid: false, checked, legacyUnverified: legacy.length, firstInvalidEventId: candidates[0].id, headHash };
    }
    const record = candidates[0];
    const details = record.details as Record<string, unknown>;
    const metadata = details.integrity as Partial<AuditIntegrityMetadata>;
    if (visited.has(record.id) || metadata.version !== 1 ||
        typeof metadata.eventHash !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.eventHash)) {
      return { valid: false, checked, legacyUnverified: legacy.length, firstInvalidEventId: record.id, headHash };
    }
    const expected = createAuditIntegrity(record, headHash);
    if (expected.eventHash !== metadata.eventHash.toLowerCase()) {
      return { valid: false, checked, legacyUnverified: legacy.length, firstInvalidEventId: record.id, headHash };
    }
    visited.add(record.id);
    headHash = expected.eventHash;
    checked += 1;
  }

  if (checked !== linked.length) {
    const disconnected = linked.find((record) => !visited.has(record.id));
    return {
      valid: false,
      checked,
      legacyUnverified: legacy.length,
      firstInvalidEventId: disconnected?.id ?? null,
      headHash,
    };
  }
  return { valid: true, checked, legacyUnverified: legacy.length, firstInvalidEventId: null, headHash };
}

export const AUDIT_INTEGRITY_GENESIS_HASH = GENESIS_HASH;
