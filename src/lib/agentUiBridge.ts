import { createAgent } from '@ui-sdk/react/agent';

export interface RyanAiAgentApprovalRequest {
  /** Human-readable explanation supplied by the UI SDK component. */
  summary: string;
  /** Aborted when the agent step is cancelled or times out. */
  signal: AbortSignal;
}

export type RyanAiAgentApproval = (
  request: RyanAiAgentApprovalRequest,
) => boolean | Promise<boolean>;

export interface RyanAiAgentOptions {
  /**
   * Required application-owned approval handler.
   * The bridge never invents an approval UI or approves consequential actions.
   */
  requestApproval: RyanAiAgentApproval;
}

/**
 * Creates a UI SDK bridge for the current browser page.
 *
 * The UI SDK can only see UI SDK primitives mounted on that page. Existing
 * native React controls are intentionally not treated as agent-operable.
 * The returned bridge is an in-process capability; do not expose it globally
 * or forward arbitrary model/tool requests to it without server authorization.
 */
export function createRyanAiAgentUiBridge(
  options: RyanAiAgentOptions,
) {
  return createAgent({
    allow: async (step, { signal }) => {
      if (!step.confirm) return true;

      if (signal.aborted) return false;

      try {
        return await options.requestApproval({
          summary: step.confirm,
          signal,
        });
      } catch {
        // Approval UI errors, dismissals and unavailable handlers fail closed.
        return false;
      }
    },
  });
}
