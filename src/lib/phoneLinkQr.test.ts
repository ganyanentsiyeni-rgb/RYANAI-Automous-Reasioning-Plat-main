import { describe, expect, it } from 'vitest';
import { createPhoneLinkQr } from './phoneLinkQr';

describe('PhoneLink QR encoder', () => {
  it('creates a version 5 QR matrix for a pairing URL', () => {
    const matrix = createPhoneLinkQr('https://ryanai.example/#/phonelink/pair?code=abcdefghijklmnopqrstuvwx');
    expect(matrix).toHaveLength(37);
    expect(matrix.every(row => row.length === 37)).toBe(true);
    expect(matrix[0][0]).toBe(true);
    expect(matrix[3][3]).toBe(true);
    expect(matrix[1][1]).toBe(false);
    expect(matrix[30][30]).toBe(true);
    expect(matrix[30][29]).toBe(false);
    expect(matrix[30][28]).toBe(true);
  });

  it('rejects payloads that exceed the supported QR version', () => {
    expect(() => createPhoneLinkQr('x'.repeat(107))).toThrow(/too long/i);
  });
});
