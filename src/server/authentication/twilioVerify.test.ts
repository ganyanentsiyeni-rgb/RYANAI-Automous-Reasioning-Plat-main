import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwilioVerifyService, VerifyServiceError, type VerifyProvider } from './twilioVerify.js';

const actor = { subjectId: 'flow_1234567890123456', authenticated: false };
const challengeId = '11111111-1111-4111-8111-111111111111';
const verificationSid = 'VE' + 'a'.repeat(32);
class FakeRedis {
  status = 'ready';
  values = new Map<string, string>();
  expiries = new Map<string, number>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, _mode: 'EX', seconds: number, condition?: 'NX') {
    if (condition === 'NX' && this.values.has(key)) return null;
    this.values.set(key, value); this.expiries.set(key, seconds); return 'OK';
  }
  async del(...keys: string[]) {
    let count = 0; for (const key of keys) if (this.values.delete(key)) count++; return count;
  }
  async ttl(key: string) { return this.values.has(key) ? (this.expiries.get(key) ?? 600) : -2; }
}
describe('RyanAI Twilio Verify adapter', () => {
  let redis: FakeRedis;
  let provider: VerifyProvider;
  let service: ReturnType<typeof createTwilioVerifyService>;
  let nextId: string;
  beforeEach(() => {
    redis = new FakeRedis(); nextId = challengeId;
    provider = {
      start: vi.fn().mockResolvedValue({ sid: verificationSid, status: 'pending' }),
      check: vi.fn().mockResolvedValue({ status: 'approved' }),
    };
    service = createTwilioVerifyService({
      redis, provider, newId: () => nextId,
      now: () => new Date('2026-11-21T12:00:00.000Z'),
    });
  });
  it('starts a challenge and stores no OTP or destination', async () => {
    const result = await service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' });
    expect(result).toMatchObject({ challengeId, state: 'pending', expiresInSeconds: 600 });
    const state = [...redis.values.values()].find(value => value.includes(verificationSid));
    expect(state).toBeDefined();
    expect(state).not.toContain('+27821234567');
    expect(state).not.toContain('123456');
  });
  it('checks the provider SID and makes an approved challenge single-use', async () => {
    await service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' });
    expect(await service.check({ actor, purpose: 'signup', challengeId, code: '123456' }))
      .toEqual({ state: 'approved', verified: true });
    expect(provider.check).toHaveBeenCalledWith({ verificationSid, code: '123456' });
    await expect(service.check({ actor, purpose: 'signup', challengeId, code: '123456' }))
      .rejects.toMatchObject({ code: 'challenge_used' });
  });
  it('rejects challenge replay by another subject or purpose', async () => {
    await service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' });
    await expect(service.check({
      actor: { ...actor, subjectId: 'flow_other_123456789' }, purpose: 'signup', challengeId, code: '123456',
    })).rejects.toMatchObject({ code: 'challenge_mismatch' });
    await expect(service.check({ actor, purpose: 'login', challengeId, code: '123456' }))
      .rejects.toMatchObject({ code: 'challenge_mismatch' });
  });
  it('throttles duplicate starts', async () => {
    await service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' });
    nextId = '22222222-2222-4222-8222-222222222222';
    await expect(service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' }))
      .rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('fails closed when Redis is not ready or provider configuration is missing', async () => {
    redis.status = 'end';
    await expect(service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' }))
      .rejects.toMatchObject({ code: 'storage_unavailable' });
    const unconfigured = createTwilioVerifyService({ redis, env: {}, newId: () => challengeId });
    redis.status = 'ready';
    await expect(unconfigured.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' }))
      .rejects.toMatchObject({ code: 'not_configured' });
  });
  it('rejects malformed destinations and codes before provider calls', async () => {
    await expect(service.start({ actor, purpose: 'signup', channel: 'sms', destination: '21234567' }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.check({ actor, purpose: 'signup', challengeId, code: 'not-a-code' }))
      .rejects.toBeInstanceOf(VerifyServiceError);
    expect(provider.start).not.toHaveBeenCalled();
  });
  it('counts invalid codes and locks the challenge after five attempts', async () => {
    provider.check = vi.fn().mockResolvedValue({ status: 'pending' });
    await service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' });
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(service.check({ actor, purpose: 'signup', challengeId, code: '000000' }))
        .rejects.toMatchObject({ code: attempt === 4 ? 'max_attempts' : 'invalid_code' });
    }
    await expect(service.check({ actor, purpose: 'signup', challengeId, code: '000000' }))
      .rejects.toMatchObject({ code: 'challenge_used' });
    expect(provider.check).toHaveBeenCalledTimes(5);
  });
  it('maps provider rate limits without leaking provider error data', async () => {
    provider.start = vi.fn().mockRejectedValue({ status: 429, message: 'private provider payload' });
    await expect(service.start({ actor, purpose: 'signup', channel: 'sms', destination: '+27821234567' }))
      .rejects.toMatchObject({ code: 'rate_limited' });
  });
});
