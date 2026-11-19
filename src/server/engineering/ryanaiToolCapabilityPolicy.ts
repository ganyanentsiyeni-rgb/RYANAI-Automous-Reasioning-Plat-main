import { RYANAI_WORKER_ROSTER } from '../../agent/workerRegistry.js';

export interface RyanAIToolCapabilityPolicyRequest {
  actorId: string;
  capabilityId: string;
  risk: 'read' | 'write' | 'outbound' | 'destructive';
  requiresHumanApproval: boolean;
  approvalReference?: string;
  approved: boolean;
}

export interface RyanAIToolCapabilityPolicyDecision {
  allowed: boolean;
  ruleId: string;
  reason: string;
}

const KNOWN_CAPABILITIES = new Set(
  RYANAI_WORKER_ROSTER.flatMap((worker) => worker.allowedActions),
);

export function evaluateRyanAIToolCapabilityPolicy(
  request: RyanAIToolCapabilityPolicyRequest,
): RyanAIToolCapabilityPolicyDecision {
  if (!request.actorId.trim() || !request.capabilityId.trim()) {
    return { allowed: false, ruleId: 'RYANAI-CAP-001', reason: 'Actor and capability identifiers are required.' };
  }

  if (!KNOWN_CAPABILITIES.has(request.capabilityId)) {
    return { allowed: false, ruleId: 'RYANAI-CAP-002', reason: 'Capability is not declared by the RyanAI workforce registry.' };
  }

  if (request.risk !== 'read' || request.requiresHumanApproval) {
    if (!request.approved || !request.approvalReference?.trim()) {
      return { allowed: false, ruleId: 'RYANAI-CAP-003', reason: 'Matching explicit human approval is required for this capability.' };
    }
  }

  if (request.risk === 'destructive') {
    return { allowed: false, ruleId: 'RYANAI-CAP-004', reason: 'Destructive provider capabilities are disabled by the RyanAI native execution boundary.' };
  }

  return {
    allowed: true,
    ruleId: 'RYANAI-CAP-ALLOW-001',
    reason: 'Capability is registered and satisfies RyanAI approval policy.',
  };
}
