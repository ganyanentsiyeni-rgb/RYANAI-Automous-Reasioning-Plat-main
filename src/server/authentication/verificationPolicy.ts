/**
 * RyanAI verification-purpose contract.
 * A Twilio approval proves only channel possession for this purpose. It never
 * creates a Supabase session or changes Supabase Authenticator Assurance Level.
 */
export const VERIFICATION_PURPOSES = [
  'signup', 'login', 'account_recovery', 'email_change', 'phone_change',
  'new_device', 'sensitive_account_change', 'admin_access',
] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];
export type SessionAssurance = 'aal1' | 'aal2';

export interface VerificationActor {
  /** Server-established user ID or opaque server-created pre-auth flow ID. */
  subjectId: string;
  authenticated: boolean;
  userId?: string;
  role?: 'user' | 'admin';
  sessionAssurance?: SessionAssurance;
}

export type VerificationPolicyResult =
  | { allowed: true; purpose: VerificationPurpose; subjectId: string }
  | { allowed: false; reason: 'invalid_subject' | 'authentication_required' | 'preauth_only' | 'admin_required' | 'aal2_required' };

const SAFE_SUBJECT = /^[A-Za-z0-9_-]{16,128}$/;
const PREAUTH_PURPOSES = new Set<VerificationPurpose>(['signup', 'login', 'account_recovery']);
const AAL2_PURPOSES = new Set<VerificationPurpose>(['email_change', 'phone_change', 'sensitive_account_change', 'admin_access']);

/** Routes must derive subjectId from Supabase or a server-created pre-auth flow. */
export function authorizeVerificationPurpose(
  actor: VerificationActor,
  purpose: VerificationPurpose,
): VerificationPolicyResult {
  if (!SAFE_SUBJECT.test(actor.subjectId)) return { allowed: false, reason: 'invalid_subject' };
  if (PREAUTH_PURPOSES.has(purpose)) {
    if (actor.authenticated) return { allowed: false, reason: 'preauth_only' };
    return { allowed: true, purpose, subjectId: actor.subjectId };
  }
  if (!actor.authenticated || !actor.userId || actor.userId !== actor.subjectId) {
    return { allowed: false, reason: 'authentication_required' };
  }
  if (purpose === 'admin_access' && actor.role !== 'admin') {
    return { allowed: false, reason: 'admin_required' };
  }
  if (AAL2_PURPOSES.has(purpose) && actor.sessionAssurance !== 'aal2') {
    return { allowed: false, reason: 'aal2_required' };
  }
  return { allowed: true, purpose, subjectId: actor.subjectId };
}
