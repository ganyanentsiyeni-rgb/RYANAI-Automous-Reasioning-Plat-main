import { describe, expect, it, vi } from 'vitest';
import {
  createPostgresGitHubOwnerEventWakeSource,
  RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL,
} from './postgresGitHubOwnerEventWakeSource.js';

describe('createPostgresGitHubOwnerEventWakeSource', () => {
  it('listens on the fixed owner channel and treats every notification as a payload-free wake', async () => {
    let notification: ((payload: string) => void) | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(async (channel: string, callback: (payload: string) => void) => {
      notification = callback;
      return unsubscribe;
    });
    const onWake = vi.fn();
    const onError = vi.fn();
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, onError);

    const stop = source.subscribe(onWake);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, expect.any(Function));
    notification?.('not-json-and-not-trusted');
    expect(onWake).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    notification?.('late-notification');
    expect(onWake).toHaveBeenCalledOnce();
  });

  it('unsubscribes if stopped while LISTEN setup is still pending', async () => {
    let resolveListen: ((unsubscribe: () => Promise<void>) => void) | undefined;
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(() => new Promise<() => Promise<void>>((resolve) => {
      resolveListen = resolve;
    }));
    const onWake = vi.fn();
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, vi.fn());

    const stop = source.subscribe(onWake);
    stop();
    resolveListen?.(unsubscribe);
    await Promise.resolve();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('reports listener setup failures without activating a worker', async () => {
    const setupError = new Error('LISTEN unavailable');
    const onError = vi.fn();
    const listen = vi.fn().mockRejectedValue(setupError);
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, onError);

    source.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(setupError);
  });
  it('reports asynchronous unsubscribe failures', async () => {
    const cleanupError = new Error('UNLISTEN failed');
    const onError = vi.fn();
    const listen = vi.fn().mockResolvedValue(() => Promise.reject(cleanupError));
    const source = createPostgresGitHubOwnerEventWakeSource({ listen }, onError);

    const stop = source.subscribe(vi.fn());
    await Promise.resolve();
    stop();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(cleanupError);
  });

});
