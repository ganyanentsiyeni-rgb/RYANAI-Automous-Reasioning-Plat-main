import { describe, expect, it, vi } from 'vitest';
import {
  createRyanAiPostgresWakeListener,
  type RyanAiPgListenerClient,
  type RyanAiPgNotification,
} from './postgresWakeListenerClient.js';
import { RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL } from '../events/postgresGitHubOwnerEventWakeSource.js';

function fakeClient() {
  const listeners = new Set<(message: RyanAiPgNotification) => void>();
  const query = vi.fn(async (_sql: string) => undefined);
  const on = vi.fn((_event: 'notification', listener: (message: RyanAiPgNotification) => void) => {
    listeners.add(listener);
  });
  const off = vi.fn((_event: 'notification', listener: (message: RyanAiPgNotification) => void) => {
    listeners.delete(listener);
  });
  const end = vi.fn(async () => undefined);
  return {
    client: { query, on, off, end } as RyanAiPgListenerClient,
    query,
    on,
    off,
    end,
    emit(message: RyanAiPgNotification) {
      for (const listener of listeners) listener(message);
    },
  };
}

describe('concrete PostgreSQL wake listener client', () => {
  it('LISTENs on the fixed owner channel and forwards only matching-channel wake signals', async () => {
    const fake = fakeClient();
    const receive = vi.fn();
    const listener = createRyanAiPostgresWakeListener(fake.client);
    const stop = await listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, receive);

    expect(fake.query).toHaveBeenCalledWith(`LISTEN "${RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL}"`);
    fake.emit({ channel: 'unrelated_channel', payload: 'ignore' });
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: 'opaque-untrusted-payload' });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith('opaque-untrusted-payload');

    await stop();
    expect(fake.query).toHaveBeenLastCalledWith(`UNLISTEN "${RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL}"`);
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: 'late' });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(fake.end).not.toHaveBeenCalled();
  });

  it('rejects arbitrary channel names before issuing SQL', async () => {
    const fake = fakeClient();
    const listener = createRyanAiPostgresWakeListener(fake.client);
    await expect(listener.listen('owner"; DROP TABLE users; --', vi.fn()))
      .rejects.toThrow('Unsupported RyanAI PostgreSQL wake channel');
    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.on).not.toHaveBeenCalled();
  });

  it('removes the event handler if LISTEN setup fails', async () => {
    const fake = fakeClient();
    const setupError = new Error('connection unavailable');
    fake.query.mockRejectedValueOnce(setupError);
    const listener = createRyanAiPostgresWakeListener(fake.client);
    await expect(listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, vi.fn()))
      .rejects.toBe(setupError);
    expect(fake.on).toHaveBeenCalledOnce();
    expect(fake.off).toHaveBeenCalledOnce();
  });

  it('closes the dedicated client only when ownership is explicitly transferred', async () => {
    const fake = fakeClient();
    const listener = createRyanAiPostgresWakeListener(fake.client, { closeClientOnStop: true });
    const stop = await listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, vi.fn());
    await stop();
    await stop();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('reports asynchronous consumer failures without leaking an unhandled rejection', async () => {
    const fake = fakeClient();
    const error = new Error('consumer failed');
    const onError = vi.fn();
    const listener = createRyanAiPostgresWakeListener(fake.client, { onError });
    await listener.listen(RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, async () => {
      throw error;
    });
    fake.emit({ channel: RYANAI_GITHUB_OWNER_EVENT_WAKE_CHANNEL, payload: '{}' });
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
