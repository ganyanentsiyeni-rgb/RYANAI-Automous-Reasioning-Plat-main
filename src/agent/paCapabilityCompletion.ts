import { PA_DELEGATION_CAPABILITIES, type PADelegationCapability } from './paJarvisHandshake.js';

export interface PACapabilityReceipt {
  capability: PADelegationCapability;
  status: 'passed' | 'failed' | 'queued' | 'skipped' | 'provider_blocked';
  evidenceReferences: string[];
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
    if (receipt.status !== 'passed' || !Array.isArray(receipt.evidenceReferences) || receipt.evidenceReferences.length === 0 ||
        receipt.evidenceReferences.some((reference) => typeof reference !== 'string' || !reference.trim())) {
      throw new Error('PA delegation cannot be finalized: ' + capability + ' has no passed, evidence-backed receipt.');
    }
  }
}
