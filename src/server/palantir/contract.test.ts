import { describe, expect, it } from 'vitest';
import { validatePalantirReadRequest } from './contract.js';

const validRequest = {
  operation: 'read',
  objectType: 'VerificationEvidence',
  objectId: 'gh-pr-588',
  fields: ['status', 'sourceRevision', 'status'],
  tenantScope: 'ryanai-test',
  correlationId: 'req-20261121-01',
};

describe('Palantir read-only ontology contract', () => {
  it('accepts allowlisted reads and removes duplicate field names', () => {
    expect(validatePalantirReadRequest(validRequest)).toEqual({
      ...validRequest,
      fields: ['status', 'sourceRevision'],
    });
  });

  it('rejects writes and unknown operations', () => {
    expect(() => validatePalantirReadRequest({ ...validRequest, operation: 'write' }))
      .toThrow('Only read operations');
  });

  it('rejects object types outside the RyanAI projection allowlist', () => {
    expect(() => validatePalantirReadRequest({ ...validRequest, objectType: 'UserCredential' }))
      .toThrow('not allowlisted');
  });

  it('rejects unsafe identifiers and excessive field selection', () => {
    expect(() => validatePalantirReadRequest({ ...validRequest, objectId: '../private' }))
      .toThrow('object ID is invalid');
    expect(() => validatePalantirReadRequest({
      ...validRequest,
      fields: Array.from({ length: 26 }, (_, index) => 'field' + index),
    })).toThrow('at most 25');
  });

  it('rejects malformed input and untrusted field syntax', () => {
    expect(() => validatePalantirReadRequest(null)).toThrow('must be an object');
    expect(() => validatePalantirReadRequest({ ...validRequest, fields: ['token;drop'] }))
      .toThrow('safe field names');
  });
});
