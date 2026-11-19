import { RYANAI_WORKER_ROSTER } from '../../agent/workerRegistry.js';

export type RyanAIToolCapabilityRisk = 'read' | 'write' | 'outbound' | 'destructive';

export interface RyanAIToolCapabilityPolicyRequest {
  actorId: string;
  capabilityId: string;
  approvalReference?: string;
  approvalVerified: boolean;
}

export interface RyanAIToolCapabilityPolicyDecision {
  allowed: boolean;
  ruleId: string;
  reason: string;
  risk: RyanAIToolCapabilityRisk | null;
  requiresHumanApproval: boolean;
}

const CAPABILITY_RISK = new Map<string, RyanAIToolCapabilityRisk>(
  RYANAI_WORKER_ROSTER.flatMap((worker) => worker.allowedActions.map((capabilityId) => [
    capabilityId,
    capabilityId === 'run-approved-provider-probe' ? 'outbound' : capabilityId.startsWith('read-') ? 'read' : 'write',
  ] as const)),
);

export function evaluateRyanAIToolCapabilityPolicy(
  request: RyanAIToolCapabilityPolicyRequest,
): RyanAIToolCapabilityPolicyDecision {
  const deny = (ruleId: string, reason: string, risk: RyanAIToolCapabilityRisk | null = null, requiresHumanApproval = false) => ({
    allowed: false, ruleId, reason, risk, requiresHumanApproval,
  });

  if (!request.actorId.trim() || !request.capabilityId.trim()) {
    return deny('RYANAI-CAP-001', 'Actor and capability identifiers are required.');
  }

  const risk = CAPABILITY_RISK.get(request.capabilityId);
  if (!risk) {
    return deny('RYANAI-CAP-002', 'Capability is not declared by the RyanAI workforce registry.');
  }

  if (risk === 'destructive') {
    return deny('RYANAI-CAP-004', 'Destructive provider capabilities are disabled by the RyanAI native execution boundary.', risk);
  }

  const requiresHumanApproval = risk !== 'read';
  if (requiresHumanApproval && (!request.approvalVerified || !request.approvalReference?.trim())) {
    return deny('RYANAI-CAP-003', 'Matching explicit human approval must be verified by RyanAI.', risk, true);
  }

  return {
    allowed: true,
    ruleId: 'RYANAI-CAP-ALLOW-001',
    reason: 'Capability risk is derived from the RyanAI registry and all required approval checks passed.',
    risk,
    requiresHumanApproval,
  };
}
