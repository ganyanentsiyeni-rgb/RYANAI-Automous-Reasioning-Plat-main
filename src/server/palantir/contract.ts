export const PALANTIR_READ_OBJECT_TYPES = [
  'Mission',
  'Task',
  'AgentRun',
  'ChangeProposal',
  'VerificationEvidence',
  'ServiceHealthObservation',
  'RANCell',
  'RANMetric',
] as const;

export type PalantirReadObjectType = typeof PALANTIR_READ_OBJECT_TYPES[number];

export interface PalantirReadRequest {
  operation: 'read';
  objectType: PalantirReadObjectType;
  objectId: string;
  fields: string[];
  tenantScope: string;
  correlationId: string;
}

const OBJECT_TYPE_SET = new Set<string>(PALANTIR_READ_OBJECT_TYPES);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Validates a narrowly scoped read request before a future Palantir adapter
 * may translate it to an SDK/API call. This module performs no network I/O.
 */
export function validatePalantirReadRequest(input: unknown): PalantirReadRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Palantir request must be an object.');
  }

  const value = input as Record<string, unknown>;
  if (value.operation !== 'read') {
    throw new Error('Only read operations are supported by the initial Palantir contract.');
  }
  if (typeof value.objectType !== 'string' || !OBJECT_TYPE_SET.has(value.objectType)) {
    throw new Error('Palantir object type is not allowlisted.');
  }
  if (typeof value.objectId !== 'string' || !SAFE_IDENTIFIER.test(value.objectId)) {
    throw new Error('Palantir object ID is invalid.');
  }
  if (typeof value.tenantScope !== 'string' || !SAFE_IDENTIFIER.test(value.tenantScope)) {
    throw new Error('Palantir tenant scope is required and must be a safe identifier.');
  }
  if (typeof value.correlationId !== 'string' || !SAFE_IDENTIFIER.test(value.correlationId)) {
    throw new Error('Palantir correlation ID is required and must be a safe identifier.');
  }
  if (!Array.isArray(value.fields) || value.fields.length > 25 ||
      value.fields.some((field) => typeof field !== 'string' || !SAFE_FIELD.test(field))) {
    throw new Error('Palantir fields must be an array of at most 25 safe field names.');
  }

  return {
    operation: 'read',
    objectType: value.objectType as PalantirReadObjectType,
    objectId: value.objectId,
    fields: [...new Set(value.fields as string[])],
    tenantScope: value.tenantScope,
    correlationId: value.correlationId,
  };
}
