import { describe, expect, it } from 'vitest';
import {
  parseFoundryProjection,
  parsePalantirReadToolContract,
} from './contracts.js';

const projection = {
  schemaVersion: 1,
  provider: 'palantir-foundry',
  objectType: 'VerificationEvidence',
  sourceId: 'github-run-44900000000',
  sourceRevision: '2085331f1da2460cd7ad7929dbfd4219ea4febf2',
  ownerScope: 'ryanai-test-tenant',
  observedAt: '2026-11-21T12:00:00.000Z',
  classification: 'internal',
  provenanceRef: 'github-actions/run/44900000000',
  correlationId: 'ryanai-ci-20261121-0001',
  accessMode: 'read_only',
  attributes: {
    workflow: 'CI - Build, Test, and Integrate',
    conclusion: 'success',
    attempt: 1,
  },
};

const readTool = {
  schemaVersion: 1,
  toolName: 'foundry.read_object',
  accessMode: 'read',
  resourceScopes: ['ontology:RyanAIMission:read'],
  requiredCapability: 'palantir.ontology.read',
  timeoutMs: 5000,
  rateLimitPerMinute: 30,
  idempotent: true,
  auditRequired: true,
  owner: 'ryanai',
};

describe('Palantir Foundry contract-only boundary', () => {
  it('accepts a scoped, versioned, read-only projection', () => {
    expect(parseFoundryProjection(projection)).toMatchObject({
      provider: 'palantir-foundry',
      objectType: 'VerificationEvidence',
      accessMode: 'read_only',
      ownerScope: 'ryanai-test-tenant',
    });
  });

  it('rejects prohibited sensitive attribute names', () => {
    expect(parseFoundryProjection({
      ...projection,
      attributes: { accessToken: 'must-not-export' },
    })).toBeNull();
    expect(parseFoundryProjection({
      ...projection,
      attributes: { subscriberImsi: '001010123456789' },
    })).toBeNull();
  });

  it('rejects unknown fields and invalid source revisions', () => {
    expect(parseFoundryProjection({ ...projection, endpoint: 'https://tenant.example' })).toBeNull();
    expect(parseFoundryProjection({ ...projection, sourceRevision: '../latest' })).toBeNull();
  });

  it('accepts only explicitly scoped, read-only, auditable MCP tools', () => {
    expect(parsePalantirReadToolContract(readTool)).toMatchObject({
      accessMode: 'read',
      resourceScopes: ['ontology:RyanAIMission:read'],
      idempotent: true,
      auditRequired: true,
    });
  });

  it('rejects write tools, missing scope, non-idempotent tools, and unaudited tools', () => {
    expect(parsePalantirReadToolContract({ ...readTool, accessMode: 'write' })).toBeNull();
    expect(parsePalantirReadToolContract({ ...readTool, resourceScopes: [] })).toBeNull();
    expect(parsePalantirReadToolContract({ ...readTool, idempotent: false })).toBeNull();
    expect(parsePalantirReadToolContract({ ...readTool, auditRequired: false })).toBeNull();
  });

  it('rejects a non-RyanAI owner and unrecognized tool properties', () => {
    expect(parsePalantirReadToolContract({ ...readTool, owner: 'external-agent' })).toBeNull();
    expect(parsePalantirReadToolContract({ ...readTool, baseUrl: 'https://tenant.example' })).toBeNull();
  });
});
