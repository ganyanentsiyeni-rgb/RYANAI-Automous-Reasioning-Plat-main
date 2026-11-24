import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('optional browser Supabase client', () => {
  it.each([
    ['', ''],
    ['https://example.supabase.co', ''],
    ['https://example.supabase.co', '   '],
  ])(
    'keeps local mode with incomplete configuration (%s, %s)',
    async (url, key) => {
      vi.stubEnv('VITE_SUPABASE_URL', url);
      vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key);
      const { supabase } = await import('./supabase');
      expect(supabase).toBeNull();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each(['REPLACE_WITH_SUPABASE_URL', 'postgresql://db.example.test:5432/postgres', 'not a URL'])(
    'does not construct a browser client for an invalid URL (%s)',
    async (url) => {
      vi.stubEnv('VITE_SUPABASE_URL', url);
      vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
      const { supabase } = await import('./supabase');
      expect(supabase).toBeNull();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the Supabase URL is missing even if a publishable key exists', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    const { supabase } = await import('./supabase');
    expect(supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates one client with the publishable key, trimming whitespace, and explicit PKCE session lifecycle options', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://example.supabase.co ');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ' sb_publishable_test ');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-public-key');
    const { supabase } = await import('./supabase');
    expect(supabase).toBeTruthy();
    expect(createClient).toHaveBeenCalledExactlyOnceWith(
      'https://example.supabase.co',
      'sb_publishable_test',
      {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  });

  it.each(['', '   '])(
    'preserves the existing public anon-key configuration (%s)',
    async (publishableKey) => {
      vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', publishableKey);
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'legacy-public-key');
      const { supabase } = await import('./supabase');
      expect(supabase).toBeTruthy();
      expect(createClient).toHaveBeenCalledExactlyOnceWith(
        'https://example.supabase.co',
        'legacy-public-key',
        {
          auth: {
            flowType: 'pkce',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        },
      );
    },
  );
});
