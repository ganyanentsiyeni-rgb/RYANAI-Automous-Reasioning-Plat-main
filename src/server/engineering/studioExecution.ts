/**
 * RyanAI Studio execution boundary.
 *
 * Studio owns project intake and lifecycle semantics. Execution is delegated
 * through this adapter contract so Studio can later use its own scheduler or
 * a different worker runtime without making the UI or route depend on Jarvis.
 *
 * The only adapter shipped today is explicitly Jarvis-backed. This module
 * does not claim independent execution until a separately reviewed native
 * scheduler/worker adapter is implemented and verified.
 */
import { dispatchAutonomousTask } from '../../agent/operations.js';

export interface StudioProjectRequest {
  readonly ownerId: string;
  readonly brief: string;
  readonly projectType: 'engineering' | 'research' | 'design' | 'data' | 'automation';
}

export interface StudioProjectReceipt {
  readonly id: string;
  readonly status: string;
  readonly queue: string;
}

export interface StudioExecutionAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly independent: boolean;
  submit(request: StudioProjectRequest): Promise<StudioProjectReceipt>;
}

const jarvisQueueAdapter: StudioExecutionAdapter = Object.freeze({
  id: 'jarvis-agent-runs',
  displayName: 'Jarvis-backed agent_runs queue',
  independent: false,
  async submit(request: StudioProjectRequest): Promise<StudioProjectReceipt> {
    const task = await dispatchAutonomousTask(request.ownerId, request.brief);
    return { id: task.id, status: task.status, queue: 'agent_runs' };
  },
});

let activeAdapter: StudioExecutionAdapter = jarvisQueueAdapter;

/** Submit through the configured adapter. Adapter selection is server-owned. */
export async function submitStudioProject(request: StudioProjectRequest): Promise<StudioProjectReceipt> {
  return activeAdapter.submit(request);
}

/** Truthful runtime metadata for Studio UI and operational diagnostics. */
export function getStudioExecutionDescriptor() {
  return {
    adapterId: activeAdapter.id,
    adapterName: activeAdapter.displayName,
    independentRuntime: activeAdapter.independent,
    lifecycleOwner: 'RyanAI Studio',
    authorizationAuthority: 'Gen-X',
    state: 'adapter_configured',
    note: activeAdapter.independent
      ? 'Studio-native execution adapter is active; worker health and task completion are reported separately.'
      : 'Studio owns project intake, but execution is currently delegated to the Jarvis-backed queue. Independent Studio scheduling is not yet implemented.',
  } as const;
}

/** Test-only injection seam; production callers cannot select adapters over HTTP. */
export function setStudioExecutionAdapterForTests(adapter: StudioExecutionAdapter): () => void {
  const previous = activeAdapter;
  activeAdapter = adapter;
  return () => { activeAdapter = previous; };
}
