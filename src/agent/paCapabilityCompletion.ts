import { PA_DELEGATION_CAPABILITIES, type PADelegationCapability } from './paJarvisHandshake.js';

export interface PACapabilityReceipt {
  capability: PADelegationCapability;
  status: 'passed' | 'failed' | 'queued' | 'skipped' | 'provider_blocked';
  evidenceReferences: string[];
  childRunId?: string;
  repositoryInspection?: {
    repositoryFullName: string;
    commitSha: string;
    inspectedAt: string;
    source: 'github-oauth-read-only';
  };
}

/** A delegated run cannot be finalized from reasoning output alone. */
export function assertPACompletionCapabilityReceipts(scopeValue: unknown, receipts: PACapabilityReceipt[]): void {
  if (!scopeValue || typeof scopeValue !== 'object' || Array.isArray(scopeValue)) return;
  const scope = scopeValue as Record<string, unknown>;
  if (typeof scope.paDelegationId !== 'string') return;
  if (!Array.isArray(scope.capabilities) || scope.capabilities.length === 0 ||
      scope.capabilities.some((item) => typeof item !== 'string' || !PA_DELEGATION_CAPABILITIES.includes(item as PADelegationCapability)) ||
      new Set(scope.capabilities).size !== scope.capabilities.length) {
    throw new Error('PA delegation cannot be finalized: approved capability scope is missing or invalid.');
  }
  const expected = scope.capabilities as PADelegationCapability[];
  const byCapability = new Map<PADelegationCapability, PACapabilityReceipt>();
  for (const receipt of receipts) {
    if (!expected.includes(receipt.capability) || byCapability.has(receipt.capability)) {
      throw new Error('PA delegation cannot be finalized: capability receipts contain an unexpected or duplicate capability.');
    }
    byCapability.set(receipt.capability, receipt);
  }
  const missing = expected.filter((capability) => !byCapability.has(capability));
  if (missing.length) throw new Error('PA delegation cannot be finalized: missing capability receipts: ' + missing.join(', ') + '.');
  for (const capability of expected) {
    const receipt = byCapability.get(capability)!;
    if (capability === 'comms.task.create' && (typeof receipt.childRunId !== 'string' || !receipt.childRunId.startsWith('pa_comms_'))) {
      throw new Error('PA delegation cannot be finalized: comms.task.create has no durable child task reference.');
    }
    if (receipt.status !== 'passed' || !Array.isArray(receipt.evidenceReferences) || receipt.evidenceReferences.length === 0 ||
        receipt.evidenceReferences.some((reference) => typeof reference !== 'string' || !reference.trim())) {
      throw new Error('PA delegation cannot be finalized: ' + capability + ' has no passed, evidence-backed receipt.');
    }
  }
}


/** Bind the repository.inspect receipt to the exact append-only evidence event. */
export function assertPARepositoryInspectionEvidence(
  receipts: PACapabilityReceipt[],
  evidenceEvents: Array<{ id: string; eventType: string; payload: unknown }>,
): void {
  const receipt = receipts.find((item) => item.capability === 'repository.inspect');
  if (!receipt) return;
  const snapshot = receipt.repositoryInspection;
  if (!snapshot || !snapshot.repositoryFullName.trim() ||
      !/^[a-f0-9]{40}$/i.test(snapshot.commitSha) ||
      !snapshot.inspectedAt.trim() || snapshot.source !== 'github-oauth-read-only' ||
      receipt.evidenceReferences.length !== 1 ||
      !receipt.evidenceReferences[0].startsWith('agent-run-evidence:')) {
    throw new Error('PA repository inspection cannot be finalized: exact snapshot metadata or evidence reference is missing.');
  }
  const evidenceId = receipt.evidenceReferences[0].slice('agent-run-evidence:'.length);
  const evidence = evidenceEvents.find((event) => event.id === evidenceId && event.eventType === 'pa.capability.executed');
  const payload = evidence?.payload && typeof evidence.payload === 'object'
    ? evidence.payload as Record<string, unknown>
    : null;
  if (!payload || payload.capability !== 'repository.inspect' ||
      payload.repositoryFullName !== snapshot.repositoryFullName ||
      payload.commitSha !== snapshot.commitSha ||
      payload.inspectedAt !== snapshot.inspectedAt ||
      payload.source !== snapshot.source || payload.readOnly !== true) {
    throw new Error('PA repository inspection cannot be finalized: evidence event does not match the exact inspected repository snapshot.');
  }
}
