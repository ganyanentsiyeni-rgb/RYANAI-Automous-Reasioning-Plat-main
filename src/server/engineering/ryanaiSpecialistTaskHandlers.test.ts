import { afterEach, describe, expect, it } from 'vitest';
import { getStudioWorkerHandlerReadiness, registerStudioTaskHandler } from './studioNativeCore.js';
import { registerRyanAISpecialistTaskHandlers } from './ryanaiSpecialistTaskHandlers.js';
import { findModuleAgentForTask, getModuleAgentForModule } from '../../agent/moduleAgentRegistry.js';
import { findWorkerForTask } from '../../agent/workerRegistry.js';

const unregister: Array<() => void> = [];
afterEach(() => { while (unregister.length) unregister.pop()?.(); });

describe('RyanAI specialist worker handler registration', () => {
  it.each([
    'coordinator',
    'repository-auditor',
    'security-auditor',
    'runtime-infrastructure',
    'data-queue',
    'provider-verification',
    'communications',
    'frontend-accessibility',
    'release-readiness',
  ])('registers a real bounded handler for %s', (profileId) => {
    unregister.push(registerRyanAISpecialistTaskHandlers(profileId));
    const readiness = getStudioWorkerHandlerReadiness(profileId);
    expect(readiness.ready).toBe(true);
    expect(readiness.registeredTaskTypes.length).toBeGreaterThan(0);
  });

  it('routes the dedicated AI Inspector module to the repository-auditor handler', () => {
    unregister.push(registerRyanAISpecialistTaskHandlers('repository-auditor'));
    expect(getModuleAgentForModule('ai-inspector')?.id).toBe('ai-inspector-module-agent');
    expect(findModuleAgentForTask('ai-inspector.audit')?.id).toBe('ai-inspector-module-agent');
    expect(findWorkerForTask('ai-inspector.audit')?.id).toBe('repository-auditor');
    expect(getStudioWorkerHandlerReadiness('repository-auditor').registeredTaskTypes).toContain('ai-inspector.audit');
    expect(getStudioWorkerHandlerReadiness('repository-auditor').registeredTaskTypes).toContain('ai-inspector.report');
  });

  it('does not register a handler for an unknown worker profile', () => {
    unregister.push(registerRyanAISpecialistTaskHandlers('unknown-worker'));
    expect(getStudioWorkerHandlerReadiness('unknown-worker').ready).toBe(false);
  });

  it('keeps CI diagnostics bound to its dedicated evidence handler registration', () => {
    const remove = registerStudioTaskHandler('ci-failure', async () => ({ kind: 'ci.diagnostics' }));
    try {
      expect(getStudioWorkerHandlerReadiness('ci-diagnostics').registeredTaskTypes).toContain('ci-failure');
    } finally {
      remove();
    }
  });
});
