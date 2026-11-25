import { describe, expect, it, vi } from 'vitest';
import { createPluginRegistry, type PluginAdapter, type PluginManifest } from './pluginRegistry.js';
import { executePluginCapability } from './pluginExecutor.js';

const manifest: PluginManifest = {
  id: 'github',
  displayName: 'GitHub',
  version: '1.0.0',
  categories: ['engineering', 'workflows'],
  description: 'Repository and engineering workflow integration.',
  capabilities: [
    { id: 'repositories.read', risk: 'read', requiresHumanApproval: false },
    { id: 'pull_requests.write', risk: 'write', requiresHumanApproval: true },
  ],
  dataClassifications: ['user_content', 'repository_metadata'],
};

const adapter: PluginAdapter = {
  providerId: 'github',
  adapterVersion: '1.0.0',
  capabilities: ['repositories.read', 'pull_requests.write'],
  execute: vi.fn(async (request, context) => ({
    status: 'completed' as const,
    output: { capability: request.capabilityId, actorId: context.actorId, connectionRef: context.connectionRef },
  })),
};

describe('plugin execution boundary', () => {
  it('requires a registered adapter and authorization before execution', async () => {
    const registry = createPluginRegistry([manifest]);
    const authorizer = vi.fn(async () => ({ allowed: true }));
    await expect(executePluginCapability(registry, authorizer, {
      providerId: 'github',
      request: { capabilityId: 'repositories.read', input: { repo: 'example' } },
      actorId: 'user-1',
      connectionRef: 'conn-1',
      requestId: 'req-1',
      signal: new AbortController().signal,
    })).rejects.toThrow('adapter_required');
    expect(authorizer).not.toHaveBeenCalled();
  });

  it('executes only after authorization and passes an opaque connection reference', async () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter);
    const authorizer = vi.fn(async () => ({ allowed: true }));
    const result = await executePluginCapability(registry, authorizer, {
      providerId: 'github',
      request: { capabilityId: 'repositories.read', input: { repo: 'example' } },
      actorId: 'user-1',
      connectionRef: 'conn-1',
      requestId: 'req-1',
      signal: new AbortController().signal,
    });
    expect(authorizer).toHaveBeenCalledWith({
      providerId: 'github',
      capabilityId: 'repositories.read',
      actorId: 'user-1',
      requestId: 'req-1',
    });
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(result.output).toEqual({ capability: 'repositories.read', actorId: 'user-1', connectionRef: 'conn-1' });
  });

  it('fails closed when authorization denies execution', async () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter);
    const authorizer = vi.fn(async () => ({ allowed: false, reason: 'Gen-X denied capability.' }));
    await expect(executePluginCapability(registry, authorizer, {
      providerId: 'github',
      request: { capabilityId: 'repositories.read', input: {} },
      actorId: 'user-1',
      connectionRef: 'conn-1',
      requestId: 'req-1',
      signal: new AbortController().signal,
    })).rejects.toThrow('Gen-X denied capability');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('requires explicit human approval for outbound/write capabilities', async () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter);
    const authorizer = vi.fn(async () => ({ allowed: true, reason: 'policy-allowed' }));
    await expect(executePluginCapability(registry, authorizer, {
      providerId: 'github',
      request: { capabilityId: 'pull_requests.write', input: {} },
      actorId: 'user-1',
      connectionRef: 'conn-1',
      requestId: 'req-1',
      signal: new AbortController().signal,
    })).rejects.toThrow('Human approval is required');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('accepts an explicitly human-approved authorization reason for high-risk capability', async () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter);
    const authorizer = vi.fn(async () => ({ allowed: true, reason: 'human-approved: PR review recorded' }));
    await executePluginCapability(registry, authorizer, {
      providerId: 'github',
      request: { capabilityId: 'pull_requests.write', input: { number: 1 } },
      actorId: 'user-1',
      connectionRef: 'conn-1',
      requestId: 'req-1',
      signal: new AbortController().signal,
    });
    expect(adapter.execute).toHaveBeenCalled();
  });

  it('never executes when the request is already cancelled', async () => {
    const registry = createPluginRegistry([manifest]);
    registry.registerAdapter(adapter);
    const controller = new AbortController();
    controller.abort();
    const authorizer = vi.fn(async () => ({ allowed: true }));
    await expect(executePluginCapability(registry, authorizer, {
      providerId: 'github',
      request: { capabilityId: 'repositories.read', input: {} },
      actorId: 'user-1',
      connectionRef: 'conn-1',
      requestId: 'req-1',
      signal: controller.signal,
    })).rejects.toThrow('cancelled');
    expect(authorizer).not.toHaveBeenCalled();
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});
