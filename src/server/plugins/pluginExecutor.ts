import {
  type PluginAdapterExecutionRequest,
  type PluginAdapterExecutionResult,
  type PluginExecutionContext,
  type PluginRegistry,
} from './pluginRegistry.js';

export interface PluginExecutionAuthorizationInput {
  readonly providerId: string;
  readonly capabilityId: string;
  readonly actorId: string;
  readonly workspaceId?: string;
  readonly requestId: string;
}

export interface PluginExecutionAuthorization {
  readonly allowed: boolean;
  readonly reason?: string;
}

export type PluginExecutionAuthorizer = (
  input: PluginExecutionAuthorizationInput,
) => Promise<PluginExecutionAuthorization>;

export interface ExecutePluginCapabilityInput {
  readonly providerId: string;
  readonly request: PluginAdapterExecutionRequest;
  readonly actorId: string;
  readonly connectionRef: string;
  readonly requestId: string;
  readonly workspaceId?: string;
  readonly signal: AbortSignal;
}

export async function executePluginCapability(
  registry: PluginRegistry,
  authorizer: PluginExecutionAuthorizer,
  input: ExecutePluginCapabilityInput,
): Promise<PluginAdapterExecutionResult> {
  const manifest = registry.get(input.providerId);
  if (!manifest) throw new Error(`Unknown plugin provider: ${input.providerId}.`);
  const capability = manifest.capabilities.find((item) => item.id === input.request.capabilityId);
  if (!capability) {
    throw new Error(`Unknown capability ${input.request.capabilityId} for ${input.providerId}.`);
  }
  if (!registry.hasAdapter(input.providerId)) {
    throw new Error(`Plugin ${input.providerId} is adapter_required; execution is unavailable.`);
  }
  if (input.signal.aborted) throw new Error('Plugin execution was cancelled before authorization.');
  if (!input.actorId.trim() || !input.connectionRef.trim() || !input.requestId.trim()) {
    throw new Error('Plugin execution requires actorId, connectionRef and requestId.');
  }

  const authorization = await authorizer({
    providerId: input.providerId,
    capabilityId: input.request.capabilityId,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
  });
  if (!authorization.allowed) {
    throw new Error(authorization.reason?.trim() || 'Plugin execution was denied by authorization policy.');
  }
  if (capability.requiresHumanApproval && !authorization.reason?.includes('human-approved')) {
    throw new Error('Human approval is required for this plugin capability.');
  }

  return registry.execute(input.providerId, input.request, {
    connectionRef: input.connectionRef,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
    capabilityId: input.request.capabilityId,
    signal: input.signal,
  });
}
