import { describe, expect, it } from 'vitest';
import { assessTask, buildOperationalReport, isSkillAvailable, PA_TASK_AWARENESS_SKILL, voiceAlertPriority, type OperationalTask, type SkillContract } from './operationalAwareness';

const task = (overrides: Partial<OperationalTask> = {}): OperationalTask => ({
  id: 'task-1', title: 'Sync authorised memory', moduleId: 'memory-vault', state: 'running',
  executionSurface: 'hybrid', requiresConnectivity: false, localFallbackAvailable: true,
  approvalRequired: false, approvalGranted: false, updatedAt: '2026-11-07T20:00:00.000Z',
  ...overrides,
});

describe('operational awareness contract', () => {
  it('does not mark a succeeded task complete without verification', () => {
    expect(assessTask(task({ state: 'succeeded' }), 'online').status).toBe('attention_required');
    expect(assessTask(task({ state: 'succeeded', completionVerified: true }), 'online').status).toBe('completed');
  });

  it('holds remote-only work safely while offline', () => {
    const result = assessTask(task({ requiresConnectivity: true, localFallbackAvailable: false }), 'offline');
    expect(result.status).toBe('offline');
    expect(result.warning).toBe('warning');
  });

  it('classifies an explicitly paused-offline task as offline', () => {
    const result = assessTask(task({ state: 'paused_offline' }), 'online');
    expect(result.status).toBe('offline');
    expect(result.label).toBe('Paused offline');
  });

  it('requires approval before classifying a task as executable', () => {
    expect(assessTask(task({ approvalRequired: true, approvalGranted: false }), 'online').status).toBe('approval_required');
  });

  it('summarises task states without inventing percentage progress', () => {
    const report = buildOperationalReport([
      task(), task({ id: 'task-2', state: 'queued' }),
      task({ id: 'task-3', state: 'failed' }),
      task({ id: 'task-4', state: 'succeeded', completionVerified: true }),
    ], 'online', '2026-11-07T20:01:00.000Z');
    expect(report).toMatchObject({ total: 4, executing: 1, queued: 1, attentionRequired: 1, completedVerified: 1 });
  });

  it('exposes skills only when mode, capabilities and permissions all match', () => {
    const skill: SkillContract = {
      id: 'local-asr', moduleId: 'comms', description: 'Local transcription',
      executionModes: ['offline'], requiredCapabilities: ['local-asr'],
      requiredPermissions: ['microphone'], verificationRequired: true, enabled: true,
    };
    expect(isSkillAvailable(skill, 'offline', new Set(['local-asr']), new Set(['microphone']))).toBe(true);
    expect(isSkillAvailable(skill, 'online', new Set(['local-asr']), new Set(['microphone']))).toBe(false);
    expect(isSkillAvailable(skill, 'offline', new Set(['local-asr']), new Set())).toBe(false);
  });

  it('registers PA as the first read-only Task Awareness skill adopter', () => {
    expect(PA_TASK_AWARENESS_SKILL).toMatchObject({
      id: 'task-awareness',
      moduleId: 'personal-assistant',
      enabled: true,
      verificationRequired: true,
      requiredPermissions: [],
    });
    expect(isSkillAvailable(
      PA_TASK_AWARENESS_SKILL,
      'online',
      new Set(['persisted-task-state', 'worker-runtime-awareness']),
      new Set(),
    )).toBe(true);
  });

  it('prioritises critical spoken failures and suppresses unverified completion announcements', () => {
    expect(voiceAlertPriority({ kind: 'task_failed' })).toBe('critical');
    expect(voiceAlertPriority({ kind: 'task_completed', verified: false })).toBe('silent');
    expect(voiceAlertPriority({ kind: 'task_completed', verified: true })).toBe('normal');
  });
});
