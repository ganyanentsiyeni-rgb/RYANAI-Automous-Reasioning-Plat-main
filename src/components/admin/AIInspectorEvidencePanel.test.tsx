// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIInspectorEvidencePanel from './AIInspectorEvidencePanel';
import { useRyanOperations } from '@/hooks/useRyanOperations';
vi.mock('@/hooks/useRyanOperations', () => ({ useRyanOperations: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const hook = vi.mocked(useRyanOperations);
let root: Root; let container: HTMLDivElement;
const base = { tasks: [], loading: false, error: null, lastConfirmedAt: null, refresh: vi.fn(), refreshing: false };
const evidence = { id: 'ev-1', sequence: 3, eventType: 'pa.capability.executed', createdAt: '2026-11-26T12:00:00Z', payload: { capability: 'ai-inspector.inspect', report: 'Audit completed with a high finding.', reportSource: 'scripts/ai-inspector-audit.mjs', reportDigest: 'a'.repeat(64), reportExitCode: 1, findings: [{ id: 'TLS-VERIFY-DISABLED', severity: 'high', message: 'TLS verification appears disabled.', evidenceFiles: ['config.ts'] }] } };
beforeEach(() => { vi.clearAllMocks(); hook.mockReturnValue(base as unknown as ReturnType<typeof useRyanOperations>); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe('AIInspectorEvidencePanel', () => {
 it('preserves completed-with-findings as distinct from clean', async () => { hook.mockReturnValue({ ...base, tasks: [{ id: 'r1', objective: 'AI Inspector audit', status: 'completed', evidence: [evidence] }] } as unknown as ReturnType<typeof useRyanOperations>); await act(async () => root.render(<AIInspectorEvidencePanel />)); expect(container.textContent).toContain('Completed — findings reported'); expect(container.textContent).toContain('TLS-VERIFY-DISABLED'); expect(container.textContent).toContain('Audit completed with a high finding.'); expect(container.textContent).toContain('Exit code 0 is not a clean-audit certification.'); });
 it('does not certify exit code zero as a clean audit', async () => { const zero = { ...evidence, payload: { ...evidence.payload, reportExitCode: 0, findings: [] } }; hook.mockReturnValue({ ...base, tasks: [{ id: 'r2', objective: 'AI Inspector audit', status: 'completed', evidence: [zero] }] } as unknown as ReturnType<typeof useRyanOperations>); await act(async () => root.render(<AIInspectorEvidencePanel />)); expect(container.textContent).toContain('Completed — exit code 0'); expect(container.textContent).not.toContain('Audit clean'); });
 it('distinguishes missing from malformed evidence', async () => { hook.mockReturnValue({ ...base, tasks: [{ id: 'r3', objective: 'AI Inspector audit', status: 'running', evidence: [] }, { id: 'r4', objective: 'AI Inspector follow-up', status: 'completed', evidence: [{ ...evidence, payload: { capability: 'ai-inspector.inspect', report: 'partial' } }] }] } as unknown as ReturnType<typeof useRyanOperations>); await act(async () => root.render(<AIInspectorEvidencePanel />)); expect(container.textContent).toContain('No persisted Inspector report evidence'); expect(container.textContent).toContain('incomplete or malformed'); });
 it('limits absence claims to the recent AgentRun window', async () => { hook.mockReturnValue({ ...base, tasks: [{ id: 'r5', objective: 'Queue telemetry', status: 'completed' }] } as unknown as ReturnType<typeof useRyanOperations>); await act(async () => root.render(<AIInspectorEvidencePanel />)); expect(container.textContent).toContain('latest AgentRun window'); expect(container.textContent).not.toContain('No AI Inspector audit has ever run'); });
 it('shows loading and API errors independently', async () => { hook.mockReturnValue({ ...base, loading: true, error: 'HTTP 403' } as unknown as ReturnType<typeof useRyanOperations>); await act(async () => root.render(<AIInspectorEvidencePanel />)); expect(container.textContent).toContain('HTTP 403'); expect(container.textContent).toContain('Loading authenticated AgentRun evidence'); });
});
