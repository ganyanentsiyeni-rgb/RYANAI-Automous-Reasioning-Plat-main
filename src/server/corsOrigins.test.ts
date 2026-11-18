import { describe, expect, it } from 'vitest';
import { DEFAULT_CORS_ORIGINS, normalizeCorsOrigin, parseCorsOrigins } from './corsOrigins.js';

describe('CORS origin normalization', () => {
  it.each([
    ['https://web.example', 'https://web.example'],
    [' https://web.example/ ', 'https://web.example'],
    ['web.example', 'https://web.example'],
    ['http://localhost:1420/', 'http://localhost:1420'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCorsOrigin(input)).toBe(expected);
  });

  it.each(['', '  ', '*', 'javascript:alert(1)', 'https://user:pass@web.example', 'https://web.example/app', 'https://web.example/?x=1'])(
    'rejects unsafe or malformed origin %j',
    (input) => expect(normalizeCorsOrigin(input)).toBeNull(),
  );

  it('parses comma-separated entries and deduplicates normalized origins', () => {
    expect(parseCorsOrigins('https://web.example/, api.example', 'https://web.example')).toEqual(
      new Set([...DEFAULT_CORS_ORIGINS, 'https://web.example', 'https://api.example']),
    );
  });

  it('keeps the deployed U2EB frontend explicitly allowlisted without opening wildcard access', () => {
    expect(parseCorsOrigins(undefined, '', '*')).toEqual(new Set(DEFAULT_CORS_ORIGINS));
    expect(DEFAULT_CORS_ORIGINS).toEqual(['https://ryanai-web-u2eb.onrender.com']);
  });
});
