import { createHash, randomUUID } from 'node:crypto';
import twilio from 'twilio';
import {
  authorizeVerificationPurpose,
  type VerificationActor,
  type VerificationPurpose,
} from './verificationPolicy.js';

export const VERIFY_CHALLENGE_TTL_SECONDS = 10 * 60;
export const VERIFY_RESEND_WINDOW_SECONDS = 60;
export const VERIFY_MAX_CHECK_ATTEMPTS = 5;
export type VerifyChannel = 'sms' | 'whatsapp' | 'call' | 'email';
export type VerifyState = 'pending' | 'approved' | 'expired' | 'failed';

interface RedisStore {
  status?: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', seconds: number, condition?: 'NX'): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
}
export interface VerifyProvider {
  start(input: { to: string; channel: VerifyChannel }): Promise<{ sid: string; status: string }>;
  check(input: { verificationSid: string; code: string }): Promise<{ status: string }>;
}
interface ChallengeRecord {
  subjectId: string;
  purpose: VerificationPurpose;
  channel: VerifyChannel;
  verificationSid: string;
  state: VerifyState;
  attempts: number;
  createdAt: string;
}

export class VerifyServiceError extends Error {
  constructor(public readonly code:
    | 'not_configured' | 'storage_unavailable' | 'invalid_input' | 'forbidden'
    | 'rate_limited' | 'challenge_not_found' | 'challenge_mismatch'
    | 'challenge_in_progress' | 'challenge_used' | 'invalid_code'
    | 'max_attempts' | 'provider_unavailable') {
    super(code);
    this.name = 'VerifyServiceError';
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function safeDestination(channel: VerifyChannel, destination: string): boolean {
  if (channel === 'email') return destination.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination);
  return /^\+[1-9]\d{7,14}$/.test(destination);
}
function verifyConfig(env: NodeJS.ProcessEnv) {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid)
    || !authToken || !serviceSid || !/^VA[0-9a-f]{32}$/i.test(serviceSid)) {
    throw new VerifyServiceError('not_configured');
  }
  return { accountSid, authToken, serviceSid };
}

export function createTwilioVerifyProvider(env: NodeJS.ProcessEnv = process.env): VerifyProvider {
  const { accountSid, authToken, serviceSid } = verifyConfig(env);
  const client = twilio(accountSid, authToken);
  return {
    async start({ to, channel }) {
      const result = await client.verify.v2.services(serviceSid).verifications.create({ to, channel });
      return { sid: result.sid, status: result.status };
    },
    async check({ verificationSid, code }) {
      const result = await client.verify.v2.services(serviceSid).verificationChecks.create({ verificationSid, code });
      return { status: result.status };
    },
  };
}

export interface TwilioVerifyServiceOptions {
  redis: RedisStore;
  provider?: VerifyProvider;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  newId?: () => string;
}
export interface StartVerificationInput {
  actor: VerificationActor;
  purpose: VerificationPurpose;
  channel: VerifyChannel;
  destination: string;
}
export interface CheckVerificationInput {
  actor: VerificationActor;
  purpose: VerificationPurpose;
  challengeId: string;
  code: string;
}
export interface StartVerificationResult {
  challengeId: string;
  state: 'pending';
  expiresInSeconds: number;
}
export interface CheckVerificationResult {
  state: VerifyState;
  verified: boolean;
}

export function createTwilioVerifyService(options: TwilioVerifyServiceOptions) {
  const env = options.env ?? process.env;
  const redis = options.redis;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  let provider = options.provider;
  const assertRedis = () => {
    if (redis.status !== 'ready') throw new VerifyServiceError('storage_unavailable');
  };
  const getProvider = () => {
    if (!provider) provider = createTwilioVerifyProvider(env);
    return provider;
  };
  const challengeKey = (id: string) => `ryanai:verify:challenge:${hash(id)}`;
  const lockKey = (id: string) => `ryanai:verify:lock:${hash(id)}`;
  const throttleKey = (subjectId: string, purpose: string, channel: string, destination: string) =>
    `ryanai:verify:start:${hash(subjectId)}:${purpose}:${channel}:${hash(destination.toLowerCase())}`;

  return {
    async start(input: StartVerificationInput): Promise<StartVerificationResult> {
      const policy = authorizeVerificationPurpose(input.actor, input.purpose);
      if (!policy.allowed) throw new VerifyServiceError('forbidden');
      if (!['sms', 'whatsapp', 'call', 'email'].includes(input.channel)
        || !safeDestination(input.channel, input.destination)) throw new VerifyServiceError('invalid_input');
      assertRedis();
      const id = newId();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new VerifyServiceError('invalid_input');
      }
      const key = challengeKey(id);
      const reservation: ChallengeRecord = {
        subjectId: policy.subjectId, purpose: input.purpose, channel: input.channel,
        verificationSid: '', state: 'pending', attempts: 0, createdAt: now().toISOString(),
      };
      const allowed = await redis.set(
        throttleKey(policy.subjectId, input.purpose, input.channel, input.destination),
        '1', 'EX', VERIFY_RESEND_WINDOW_SECONDS, 'NX',
      );
      if (allowed !== 'OK') throw new VerifyServiceError('rate_limited');
      const reserved = await redis.set(key, JSON.stringify(reservation), 'EX', VERIFY_CHALLENGE_TTL_SECONDS, 'NX');
      if (reserved !== 'OK') throw new VerifyServiceError('storage_unavailable');
      try {
        const result = await getProvider().start({ to: input.destination, channel: input.channel });
        if (!/^VE[0-9a-f]{32}$/i.test(result.sid) || result.status.toLowerCase() !== 'pending') {
          throw new VerifyServiceError('provider_unavailable');
        }
        reservation.verificationSid = result.sid;
        await redis.set(key, JSON.stringify(reservation), 'EX', VERIFY_CHALLENGE_TTL_SECONDS);
        return { challengeId: id, state: 'pending', expiresInSeconds: VERIFY_CHALLENGE_TTL_SECONDS };
      } catch (error) {
        await redis.del(key);
        if (error instanceof VerifyServiceError) throw error;
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status) : 0;
        if (status === 429) throw new VerifyServiceError('rate_limited');
        throw new VerifyServiceError('provider_unavailable');
      }
    },

    async check(input: CheckVerificationInput): Promise<CheckVerificationResult> {
      const policy = authorizeVerificationPurpose(input.actor, input.purpose);
      if (!policy.allowed) throw new VerifyServiceError('forbidden');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.challengeId)
        || !/^\d{4,10}$/.test(input.code)) throw new VerifyServiceError('invalid_input');
      assertRedis();
      const key = challengeKey(input.challengeId);
      const raw = await redis.get(key);
      if (!raw) throw new VerifyServiceError('challenge_not_found');
      let record: ChallengeRecord;
      try { record = JSON.parse(raw) as ChallengeRecord; }
      catch {
        await redis.del(key);
        throw new VerifyServiceError('challenge_not_found');
      }
      if (record.subjectId !== policy.subjectId || record.purpose !== input.purpose) {
        throw new VerifyServiceError('challenge_mismatch');
      }
      if (record.state !== 'pending' || !record.verificationSid) throw new VerifyServiceError('challenge_used');
      if (record.attempts >= VERIFY_MAX_CHECK_ATTEMPTS) {
        record.state = 'failed';
        await redis.set(key, JSON.stringify(record), 'EX', VERIFY_CHALLENGE_TTL_SECONDS);
        throw new VerifyServiceError('max_attempts');
      }
      const lock = lockKey(input.challengeId);
      if (await redis.set(lock, '1', 'EX', 30, 'NX') !== 'OK') {
        throw new VerifyServiceError('challenge_in_progress');
      }
      try {
        const remainingTtl = await redis.ttl(key);
        if (remainingTtl <= 0) throw new VerifyServiceError('challenge_not_found');
        const result = await getProvider().check({ verificationSid: record.verificationSid, code: input.code });
        const status = result.status.toLowerCase();
        if (status === 'approved') {
          record.state = 'approved';
          await redis.set(key, JSON.stringify(record), 'EX', remainingTtl);
          return { state: 'approved', verified: true };
        }
        if (['expired', 'canceled', 'deleted', 'max_attempts_reached', 'failed'].includes(status)) {
          record.state = status === 'expired' ? 'expired' : 'failed';
          await redis.set(key, JSON.stringify(record), 'EX', remainingTtl);
          return { state: record.state, verified: false };
        }
        record.attempts += 1;
        if (record.attempts >= VERIFY_MAX_CHECK_ATTEMPTS) record.state = 'failed';
        await redis.set(key, JSON.stringify(record), 'EX', remainingTtl);
        throw new VerifyServiceError(record.state === 'failed' ? 'max_attempts' : 'invalid_code');
      } catch (error) {
        if (error instanceof VerifyServiceError) throw error;
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status) : 0;
        if (status === 404) {
          record.state = 'expired';
          const ttl = await redis.ttl(key);
          if (ttl > 0) await redis.set(key, JSON.stringify(record), 'EX', ttl);
          return { state: 'expired', verified: false };
        }
        if (status === 429) throw new VerifyServiceError('rate_limited');
        throw new VerifyServiceError('provider_unavailable');
      } finally {
        await redis.del(lock);
      }
    },
  };
}
