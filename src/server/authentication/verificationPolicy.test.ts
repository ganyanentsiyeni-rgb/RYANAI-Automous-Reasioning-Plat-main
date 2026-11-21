import { describe, expect, it } from 'vitest';
import { authorizeVerificationPurpose, type VerificationActor } from './verificationPolicy.js';

const user: VerificationActor = {
  subjectId: 'user_1234567890123456',
  userId: 'user_1234567890123456',
  authenticated: true,
  role: 'user',
  sessionAssurance: 'aal2',
};

describe('RyanAI verification purpose policy', () => {
  it('allows pre-auth signup, login and recovery for server-created flow subjects', () => {
    const actor = { subjectId: 'flow_1234567890123456', authenticated: false };
    for (const purpose of ['signup', 'login', 'account_recovery'] as const) {
      expect(authorizeVerificationPurpose(actor, purpose).allowed).toBe(true);
    }
  });
  it('rejects pre-auth purposes for an authenticated session', () => {
    expect(authorizeVerificationPurpose(user, 'login')).toMatchObject({ allowed: false, reason: 'preauth_only' });
  });
  it('requires the authenticated subject to match the Supabase user', () => {
    expect(authorizeVerificationPurpose({ ...user, subjectId: 'other_123456789012345' }, 'phone_change'))
      .toMatchObject({ allowed: false, reason: 'authentication_required' });
  });
  it('requires existing Supabase aal2 for sensitive purposes', () => {
    expect(authorizeVerificationPurpose({ ...user, sessionAssurance: 'aal1' }, 'phone_change'))
      .toMatchObject({ allowed: false, reason: 'aal2_required' });
  });
  it('requires admin role and aal2 for admin access', () => {
    expect(authorizeVerificationPurpose(user, 'admin_access')).toMatchObject({ allowed: false, reason: 'admin_required' });
    expect(authorizeVerificationPurpose({ ...user, role: 'admin' }, 'admin_access').allowed).toBe(true);
  });
  it('rejects malformed subjects', () => {
    expect(authorizeVerificationPurpose({ subjectId: '+15555550123', authenticated: false }, 'signup'))
      .toMatchObject({ allowed: false, reason: 'invalid_subject' });
  });
});
