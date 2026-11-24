import { afterEach, describe, expect, it } from 'vitest';
import { getStudioWorkerHandlerReadiness } from './studioNativeCore.js';
import { registerRyanAISpecialistTaskHandlers, runRyanAIInspectorAudit, runRyanAIRepositoryInventory } from './ryanaiSpecialistTaskHandlers.js';
import { findModuleAgentForTask, getModuleAgentForModule } from '../../agent/moduleAgentRegistry.js';
import { findWorkerForTask } from '../../agent/workerRegistry.js';
import { registerRyanAICiDiagnosticsTaskHandlers } from './ryanaiCiDiagnosticsTask.js';

const unregister: Array<() => void> = [];
afterEach(() => { while (unregister.length) unregister.pop()?.(); });

describe('RyanAI specialist worker handler registration', () => {
  it.each([
    'coordinator',
    'repository-auditor',
    'ci-diagnostics',
    'security-auditor',
    'runtime-infrastructure',
    'data-queue',
    'provider-verification',
    'communications',
    'frontend-accessibility',
    'release-readiness',
  ])('registers a real bounded handler for %s', (profileId) => {
    if (profileId === 'coordinator') {
      unregister.push(registerStudioTaskHandler('coordination', async () => ({ kind: 'ryanai.coordination.plan' })));
    }
    if (profileId === 'ci-diagnostics') {
      unregister.push(registerRyanAICiDiagnosticsTaskHandlers(async () => { throw new Error('GitHub evidence fixture is not connected.'); }));
    } else {
      unregister.push(registerRyanAISpecialistTaskHandlers(profileId));
    }
    const readiness = getStudioWorkerHandlerReadiness(profileId);
    expect(readiness.ready).toBe(true);
    expect(readiness.missingTaskTypes).toEqual([]);
    expect(readiness.registeredTaskTypes).toHaveLength(readiness.supportedTaskTypes.length);
  });

  it('returns a bounded read-only repository inventory without executing discovered commands', async () => {
    const context = {
      task: { id: 'inventory-test', objective: 'Inspect repository structure', requiredCapabilities: ['read-repository'] },
    } as unknown as Parameters<typeof runRyanAIRepositoryInventory>[0];
    const inventory = await runRyanAIRepositoryInventory(context);
    expect(inventory.kind).toBe('repository.inventory');
    expect(inventory.taskId).toBe('inventory-test');
    expect(inventory.mode).toBe('READ_ONLY_STATIC_INVENTORY');
    expect(inventory.commandsExecuted).toBe(false);
    expect(inventory.environmentValuesRead).toBe(false);
    expect(inventory.packages.some((item) => item.path === 'package.json')).toBe(true);
    expect(inventory.packageScriptCount).toBeGreaterThan(0);
    expect(inventory.workflows.length).toBeGreaterThan(0);
    expect(inventory.repositoryScripts.every((item) => item.status === 'NOT_EXECUTED')).toBe(true);
  });

  it('rejects repository inventory without the explicit read-repository capability', async () => {
    const context = {
      task: { id: 'inventory-denied', objective: 'Inspect repository', requiredCapabilities: [] },
    } as unknown as Parameters<typeof runRyanAIRepositoryInventory>[0];
    await expect(runRyanAIRepositoryInventory(context)).rejects.toThrow('explicit read-repository capability');
  });

  it('routes the dedicated AI Inspector module to the repository-auditor handler', () => {
    unregister.push(registerRyanAISpecialistTaskHandlers('repository-auditor'));
    expect(getModuleAgentForModule('ai-inspector')?.id).toBe('ai-inspector-module-agent');
    expect(findModuleAgentForTask('ai-inspector.audit')?.id).toBe('ai-inspector-module-agent');
    expect(findWorkerForTask('ai-inspector.audit')?.id).toBe('repository-auditor');
    expect(getStudioWorkerHandlerReadiness('repository-auditor').registeredTaskTypes).toContain('ai-inspector.audit');
    expect(getStudioWorkerHandlerReadiness('repository-auditor').registeredTaskTypes).toContain('ai-inspector.report');
  });

  it('returns the read-only Inspector report to PA even when findings set exit code 1', async () => {
    const report = await runRyanAIInspectorAudit({ taskId: 'test-inspector-run' });
    expect(report.kind).toBe('ryanai.ai-inspector.report');
    expect(report.taskId).toBe('test-inspector-run');
    expect(report.report).toContain('# RyanAI Inspector & Audit Report');
    expect(report.report).toContain('## Cross-module source inspection');
    expect(report.report).toContain('src/agent');
    expect(report.inspectionEvidenceFiles).toContain('package.json');
    expect(report.findings).toBeInstanceOf(Array);
    expect([0, 1]).toContain(report.exitCode);
    expect(report.externalActions).toBe('none');
    expect(report.reportSource).toBe('scripts/ai-inspector-audit.mjs');
    expect(report.sourceInspectionSource).toBe('src/server/engineering/ryanaiSpecialistTaskHandlers.ts');
  });

  it('does not register a handler for an unknown worker profile', () => {
    unregister.push(registerRyanAISpecialistTaskHandlers('unknown-worker'));
    expect(getStudioWorkerHandlerReadiness('unknown-worker').ready).toBe(false);
  });

  it('keeps CI diagnostics bound to all three dedicated evidence task handlers', () => {
    for (const taskType of ['ci-failure', 'test-failure', 'build-failure']) {
      unregister.push(registerStudioTaskHandler(taskType, async () => ({ kind: 'ci.diagnostics' })));
    }
    const readiness = getStudioWorkerHandlerReadiness('ci-diagnostics');
    expect(readiness.ready).toBe(true);
    expect(readiness.missingTaskTypes).toEqual([]);
  });

  it('does not mark a partially registered worker profile as ready', () => {
    unregister.push(registerStudioTaskHandler('security-audit', async () => ({ kind: 'security.audit' })));
    const readiness = getStudioWorkerHandlerReadiness('security-auditor');
    expect(readiness.ready).toBe(false);
    expect(readiness.registeredTaskTypes).toEqual(['security-audit']);
    expect(readiness.missingTaskTypes).toEqual(['dependency-audit', 'container-audit']);
    expect(readiness.reason).toContain('registration is incomplete');
  });
});
