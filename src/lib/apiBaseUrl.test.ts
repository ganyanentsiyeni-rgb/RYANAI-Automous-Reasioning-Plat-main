import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeApiBaseUrl, resolveApiBaseUrl } from './apiBaseUrl';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_API_URL', '');
  vi.stubGlobal('window', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  [
    ' https://primary.example/// ',
    'https://legacy.example',
    'https://primary.example',
  ],
  ['   ', ' https://legacy.example/// ', 'https://legacy.example'],
  ['', '', 'http://localhost:3000'],
])(
  'normalizes API configuration (%j, %j)',
  async (primary, legacy, expected) => {
    vi.stubEnv('VITE_API_BASE_URL', primary);
    vi.stubEnv('VITE_API_URL', legacy);
    expect((await import('./apiBaseUrl')).API_BASE_URL).toBe(expected);
  },
);

it('uses the browser origin when both configured URLs contain only whitespace', async () => {
  vi.stubEnv('VITE_API_BASE_URL', '  ');
  vi.stubEnv('VITE_API_URL', '\t');
  vi.stubGlobal('window', { location: { origin: 'https://web.example' } });
  expect((await import('./apiBaseUrl')).API_BASE_URL).toBe(
    'https://web.example',
  );
});

describe('development API proxy resolution', () => {
  it.each([
    'http://127.0.0.1:3001',
    'http://localhost:3001',
    'http://[::1]:3001',
  ])('routes loopback API target %s through the frontend origin', (target) => {
    expect(
      resolveApiBaseUrl(target, true, 'https://codespace-1421.app.github.dev'),
    ).toBe('https://codespace-1421.app.github.dev');
  });

  it('keeps a separately hosted API URL direct in development', () => {
    expect(
      resolveApiBaseUrl(
        'https://ryanai-api.onrender.com/',
        true,
        'https://codespace-1421.app.github.dev',
      ),
    ).toBe('https://ryanai-api.onrender.com');
  });

  it('does not rewrite loopback URLs in production', () => {
    expect(
      resolveApiBaseUrl(
        'http://127.0.0.1:3001',
        false,
        'https://web.example',
      ),
    ).toBe('http://127.0.0.1:3001');
  });

  it.each([
    ['localhost:3001', 'http://localhost:3001'],
    ['127.0.0.1:3001', 'http://127.0.0.1:3001'],
    ['ryanai-api.onrender.com', 'https://ryanai-api.onrender.com'],
  ])('normalizes host-only API target %s', (target, expected) => {
    expect(normalizeApiBaseUrl(target)).toBe(expected);
  });
});
