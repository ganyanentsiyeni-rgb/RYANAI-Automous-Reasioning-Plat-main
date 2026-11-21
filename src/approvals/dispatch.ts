import type { ActionArgs, ActionTool } from './rules.js';

/**
 * The legacy pending-action approval queue predates the owner-verified
 * communications gateway. It must never contact SMTP or Twilio directly.
 *
 * Keep this adapter fail-closed so a stale queued action or an administrator
 * approval cannot bypass destination verification, callback verification,
 * and explicit test authorization in the supported communications flow.
 */
export async function dispatchAction(_tool: ActionTool, _args: ActionArgs): Promise<string> {
  throw new Error(
    'Legacy outbound communications dispatch is disabled. Use the owner-verified communications gateway after all delivery safeguards are enabled.',
  );
}
