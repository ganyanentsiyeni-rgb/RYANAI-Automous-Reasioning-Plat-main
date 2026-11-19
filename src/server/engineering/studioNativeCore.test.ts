import { describe, expect, it, vi } from 'vitest';
import { executeStudioToolCapability, getStudioNativeRuntimeDescriptor, recommendStudioWorker } from './studioNativeCore.js';

describe('RyanAI Studio Native Core contracts', () => {
  it('recommends a specialist using declared task capabilities', () => {
    expect(recommendStudioWorker('ci-failure')?.id).toBe('ci-diagnostics');
    expect(recommendStudioWorker('unknown-task')).toBeNull();
  });

  it('blocks write capabilities without matching human approval', async () => {
    const execute = vi.fn();
    const audit = vi.fn().mockResolvedValue(undefined);
    await expect(executeStudioToolCapability({
      actorId: 'owner-1', connectionRef: 'opaque-connection-ref', requestId: 'req-1',
      capabilityId: 'write-communications-report', input: {}, manifest: { capabilities: [{ id: 'write-communications-report', risk: 'read', requiresHumanApproval: false }] },
      resolveConnection: async () => true, verifyApproval: async () => false, execute, audit,
    })).rejects.toThrow('Matching explicit human approval must be verified by RyanAI.');
    expect(execute).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'blocked' }));
  });

  it('denies capabilities not declared by the RyanAI workforce registry', async () => {
    const execute = vi.fn();
    const audit = vi.fn().mockResolvedValue(undefined);
    await expect(executeStudioToolCapability({
      actorId: 'owner-1', connectionRef: 'opaque-connection-ref', requestId: 'req-2',
      capabilityId: 'files.read', input: {}, manifest: { capabilities: [{ id: 'files.read', risk: 'read', requiresHumanApproval: false }] },
      resolveConnection: async () => true, verifyApproval: async () => false,
      execute, audit,
    })).rejects.toThrow('Capability is not declared by the RyanAI workforce registry.');
    expect(execute).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'blocked' }));
  });

  it('blocks a provider call when the owner connection cannot be resolved', async () => {
    const execute = vi.fn();
    const audit = vi.fn().mockResolvedValue(undefined);
    await expect(executeStudioToolCapability({
      actorId: 'owner-1', connectionRef: 'unowned-ref', requestId: 'req-connection',
      capabilityId: 'read-workflow-runs', input: {}, manifest: { capabilities: [{ id: 'read-workflow-runs', risk: 'read', requiresHumanApproval: false }] },
      resolveConnection: async () => false, verifyApproval: async () => false,
      execute, audit,
    })).rejects.toThrow('Owner-scoped provider connection could not be resolved');
    expect(execute).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'blocked' }));
  });

  it('executes a read capability only after policy approval and records the outcome', async () => {
    const execute = vi.fn().mockResolvedValue({ items: 2 });
    const audit = vi.fn().mockResolvedValue(undefined);
    const result = await executeStudioToolCapability({
      actorId: 'owner-1', connectionRef: 'opaque-connection-ref', requestId: 'req-3',
      capabilityId: 'read-workflow-runs', input: {}, manifest: { capabilities: [{ id: 'files.read', risk: 'read', requiresHumanApproval: false }] },
      resolveConnection: async () => true, verifyApproval: async () => true,
      execute, audit,
    });
    expect(result).toEqual({ items: 2 });
    expect(execute).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'completed' }));
  });
});

describe('Studio worker runtime reporting', () => {
  it('reports separate-process worker health as unknown until a shared heartbeat exists', () => {
    expect(getStudioNativeRuntimeDescriptor()).toMatchObject({
      workerRuntime: 'separate_process',
      workerHealth: 'unknown',
      productionExecutionEnabled: false,
    });
    expect(getStudioNativeRuntimeDescriptor().workerHealthReason).toContain('Worker heartbeats are persisted');
  });
});


describe('RyanAI-native Studio task admission', () => {
  it('allows only a registered worker assigned to a supported task type', async () => {
    const { evaluateRyanAIStudioTaskAdmission } = await import('./ryanaiStudioTaskAdmission.js');
    expect(evaluateRyanAIStudioTaskAdmission({
      taskType: 'ci-failure',
      assignedWorkerId: 'ci-diagnostics',
      requiredCapabilities: ['read-workflow-runs', 'read-job-logs'],
      approvalRequired: false,
      approvalStatus: 'not_required',
    })).toMatchObject({ allowed: true, decision: 'ALLOW' });
  });

  it('denies missing or unknown worker assignments', async () => {
    const { evaluateRyanAIStudioTaskAdmission } = await import('./ryanaiStudioTaskAdmission.js');
    expect(evaluateRyanAIStudioTaskAdmission({
      taskType: 'ci-failure', assignedWorkerId: null, requiredCapabilities: [],
      approvalRequired: false, approvalStatus: 'not_required',
    }).allowed).toBe(false);
    expect(evaluateRyanAIStudioTaskAdmission({
      taskType: 'ci-failure', assignedWorkerId: 'unregistered', requiredCapabilities: [],
      approvalRequired: false, approvalStatus: 'not_required',
    }).allowed).toBe(false);
  });

  it('denies unsupported task types and undeclared capabilities', async () => {
    const { evaluateRyanAIStudioTaskAdmission } = await import('./ryanaiStudioTaskAdmission.js');
    expect(evaluateRyanAIStudioTaskAdmission({
      taskType: 'production-deploy', assignedWorkerId: 'ci-diagnostics', requiredCapabilities: [],
      approvalRequired: false, approvalStatus: 'not_required',
    }).allowed).toBe(false);
    expect(evaluateRyanAIStudioTaskAdmission({
      taskType: 'ci-failure', assignedWorkerId: 'ci-diagnostics', requiredCapabilities: ['production.deploy'],
      approvalRequired: false, approvalStatus: 'not_required',
    }).allowed).toBe(false);
  });

  it('requires persisted owner approval when the task declares it', async () => {
    const { evaluateRyanAIStudioTaskAdmission } = await import('./ryanaiStudioTaskAdmission.js');
    const task = {
      taskType: 'ci-failure', assignedWorkerId: 'ci-diagnostics', requiredCapabilities: [],
      approvalRequired: true, approvalStatus: 'pending',
    };
    expect(evaluateRyanAIStudioTaskAdmission(task).allowed).toBe(false);
    expect(evaluateRyanAIStudioTaskAdmission({ ...task, approvalStatus: 'approved' }).allowed).toBe(true);
  });
});
