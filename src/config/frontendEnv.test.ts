import { describe, expect, it } from 'vitest';
import { validateFrontendEnvironment } from './frontendEnv';

describe('frontend environment security boundary', () => {
  it('allows loopback only in development', () => {
    expect(validateFrontendEnvironment(
      { VITE_API_BASE_URL: 'http://127.0.0.1:3001' },
      'development',
    ).apiBaseUrl).toBe('http://127.0.0.1:3001');

    expect(() => validateFrontendEnvironment(
      { VITE_API_BASE_URL: 'http://127.0.0.1:3001' },
      'production',
    )).toThrow(/Loopback API endpoints/);
  });

  it.each(['localhost', '127.0.0.1', '0.0.0.0', 'service.localhost'])(
    'rejects %s in hosted builds',
    (host) => {
      expect(() => validateFrontendEnvironment(
        { VITE_API_BASE_URL: `https://${host}:3001` },
        'production',
      )).toThrow(/Loopback API endpoints/);
    },
  );

  it('requires a hosted API URL outside development', () => {
    expect(() => validateFrontendEnvironment({}, 'production'))
      .toThrow(/VITE_API_BASE_URL is required/);
  });

  it('requires HTTPS in staging and production', () => {
    expect(() => validateFrontendEnvironment(
      { VITE_API_BASE_URL: 'http://api.example.com' },
      'staging',
    )).toThrow(/must use HTTPS/);
  });

  it('rejects server credentials in VITE variables', () => {
    expect(() => validateFrontendEnvironment(
      {
        VITE_API_BASE_URL: 'https://api.example.com',
        VITE_DATABASE_URL: 'postgres://example',
      },
      'production',
    )).toThrow(/VITE_DATABASE_URL/);
  });

  it('allows only explicitly browser-safe Supabase key names', () => {
    expect(validateFrontendEnvironment(
      {
        VITE_API_BASE_URL: 'https://api.example.com',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      },
      'production',
    ).appEnvironment).toBe('production');
    expect(() => validateFrontendEnvironment(
      {
        VITE_API_BASE_URL: 'https://api.example.com',
        VITE_SUPABASE_SERVICE_ROLE_KEY: 'never-expose',
      },
      'production',
    )).toThrow(/VITE_SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('rejects credentials embedded in the API URL', () => {
    expect(() => validateFrontendEnvironment(
      { VITE_API_BASE_URL: 'https://user:pass@api.example.com' },
      'production',
    )).toThrow(/embedded credentials/);
  });

  it('normalizes trailing slashes without rewriting hosted origins', () => {
    expect(validateFrontendEnvironment(
      { VITE_API_BASE_URL: 'https://api.example.com///' },
      'production',
    ).apiBaseUrl).toBe('https://api.example.com');
  });
});
