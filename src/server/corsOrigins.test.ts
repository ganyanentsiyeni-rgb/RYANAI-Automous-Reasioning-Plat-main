import { describe, expect, it } from 'vitest';
import { normalizeCorsOrigin, parseCorsOrigins } from './corsOrigins.js';

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
      new Set(['https://web.example', 'https://api.example']),
    );
  });

  it('does not create an allow-all policy from an empty configuration', () => {
    expect(parseCorsOrigins(undefined, '', '*')).toEqual(new Set());
  });
});
