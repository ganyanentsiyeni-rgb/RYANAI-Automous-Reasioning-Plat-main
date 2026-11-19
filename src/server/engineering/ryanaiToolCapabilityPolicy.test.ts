import { describe, expect, it } from 'vitest';
import { evaluateRyanAIToolCapabilityPolicy } from './ryanaiToolCapabilityPolicy.js';

describe('RyanAI native tool capability policy', () => {
  it('denies unknown capabilities regardless of caller-supplied manifest metadata', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'shell', approvalVerified: true, approvalReference: 'approval-1',
    })).toMatchObject({ allowed: false, ruleId: 'RYANAI-CAP-002' });
  });

  it('allows registered read capabilities without approval', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'read-workflow-runs', approvalVerified: false,
    })).toMatchObject({ allowed: true, risk: 'read', requiresHumanApproval: false });
  });

  it('derives write risk from the registry and requires verified approval', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'write-audit-report', approvalVerified: false,
    })).toMatchObject({ allowed: false, ruleId: 'RYANAI-CAP-003', risk: 'write' });

    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'write-audit-report', approvalVerified: true, approvalReference: 'approval-1',
    })).toMatchObject({ allowed: true, risk: 'write', requiresHumanApproval: true });
  });

  it('treats provider probes as outbound and requires verified approval', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'run-approved-provider-probe', approvalVerified: false,
    })).toMatchObject({ allowed: false, ruleId: 'RYANAI-CAP-003', risk: 'outbound' });
  });
});
