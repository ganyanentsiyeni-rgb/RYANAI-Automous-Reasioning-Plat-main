import { describe, expect, it } from 'vitest';
import { authenticateUser, fetchCurrentProfile } from './authService';

describe('retired legacy browser auth service', () => {
  it('does not create a second local sign-in session', async () => {
    await expect(authenticateUser('signin', { email: 'user@example.test', password: 'test' }))
      .rejects.toThrow('Use Supabase Auth');
  });

  it('does not retrieve profiles using a localStorage JWT', async () => {
    await expect(fetchCurrentProfile()).rejects.toThrow('Use Supabase Auth');
  });
});
