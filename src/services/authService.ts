const RETIRED_AUTH_MESSAGE =
  'Local password/JWT authentication has been retired. Use Supabase Auth through the RyanAI sign-in page.';

/**
 * Retired compatibility exports. These deliberately do not call the legacy
 * API, read localStorage, or persist a second browser token.
 */
export async function authenticateUser(
  _endpoint: 'signup' | 'signin',
  _credentials: Record<string, string>,
): Promise<never> {
  throw new Error(RETIRED_AUTH_MESSAGE);
}

export async function fetchCurrentProfile(): Promise<never> {
  throw new Error(RETIRED_AUTH_MESSAGE);
}
