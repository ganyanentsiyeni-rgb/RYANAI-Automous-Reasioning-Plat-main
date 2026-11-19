import { describe, expect, it } from 'vitest';
import { evaluateRyanAIToolCapabilityPolicy } from './ryanaiToolCapabilityPolicy.js';

describe('RyanAI native tool capability policy', () => {
  it('denies unknown capabilities', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'shell', risk: 'read',
      requiresHumanApproval: false, approved: false,
    }).allowed).toBe(false);
  });

  it('allows declared read capabilities without approval', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'read-task', risk: 'read',
      requiresHumanApproval: false, approved: false,
    })).toMatchObject({ allowed: true, ruleId: 'RYANAI-CAP-ALLOW-001' });
  });

  it('requires approval for write capabilities', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'record-progress', risk: 'write',
      requiresHumanApproval: false, approved: false,
    })).toMatchObject({ allowed: false, ruleId: 'RYANAI-CAP-003' });

    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'record-progress', risk: 'write',
      requiresHumanApproval: false, approved: true, approvalReference: 'approval-1',
    }).allowed).toBe(true);
  });

  it('never permits destructive capability execution', () => {
    expect(evaluateRyanAIToolCapabilityPolicy({
      actorId: 'owner-1', capabilityId: 'record-progress', risk: 'destructive',
      requiresHumanApproval: true, approved: true, approvalReference: 'approval-1',
    })).toMatchObject({ allowed: false, ruleId: 'RYANAI-CAP-004' });
  });
});
