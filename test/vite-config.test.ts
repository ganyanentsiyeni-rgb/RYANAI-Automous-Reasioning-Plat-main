import type { ConfigEnv } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../vite.config';

vi.mock('vite', () => ({
  defineConfig: (value: unknown) => value,
  loadEnv: () => ({}),
}));
vi.mock('@vitejs/plugin-react', () => ({
  default: () => ({ name: 'react-fixture' }),
}));

const resolveConfig = config as (env: ConfigEnv) => {
  server?: { proxy?: Record<string, { target?: string }> };
};
const build: ConfigEnv = { command: 'build', mode: 'production' };

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://ryanai-api.onrender.com');
  vi.stubEnv('VITE_API_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('deployment-neutral Vite configuration', () => {
  it('routes frontend API calls to the configured backend origin', () => {
    const resolved = resolveConfig(build);
    expect(resolved.server?.proxy?.['/api']?.target).toBe('https://ryanai-api.onrender.com');
  });

  it('uses the local API fallback when no hosted origin is configured', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const resolved = resolveConfig(build);
    expect(resolved.server?.proxy?.['/api']?.target).toBe('http://127.0.0.1:3001');
  });
});

describe('hosted frontend configuration', () => {
  it('rejects staging builds without the Supabase browser key instead of publishing a broken sign-in page', () => {
    vi.stubEnv('VITE_APP_ENV', 'staging');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://narsvpwymvlrhurqbthu.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    expect(() => resolveConfig(build)).toThrow(
      'Hosted frontend configuration is incomplete: VITE_SUPABASE_PUBLISHABLE_KEY',
    );
  });

  it('accepts staging builds when API and Supabase public configuration are present', () => {
    vi.stubEnv('VITE_APP_ENV', 'staging');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://narsvpwymvlrhurqbthu.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_fixture');
    expect(resolveConfig(build)).toBeDefined();
  });
});

describe('browser credential protection', () => {
  it.each([
    'VITE_OPENAI_API_KEY',
    'VITE_NVIDIA_API_KEY',
    'VITE_QWEN_API_KEY',
    'VITE_TOGETHER_API_KEY',
    'VITE_OPENROUTER_API_KEY',
    'VITE_MODEL_GATEWAY_API_KEY',
    'VITE_LOCAL_API_KEY',
  ])('rejects provider credentials configured as %s', (name) => {
    vi.stubEnv(name, 'test-only-not-a-real-secret');
    expect(() => resolveConfig({ command: 'serve', mode: 'development' })).toThrow(
      'Refusing to build with provider credentials in browser-exposed variables',
    );
  });
});
