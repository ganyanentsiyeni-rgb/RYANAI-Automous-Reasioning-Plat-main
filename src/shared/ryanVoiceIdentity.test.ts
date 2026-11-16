import { describe, expect, it } from 'vitest';
import { getRyanAIAnniversaryInfo, getRyanVoiceDeliveryInstruction, RYANAI_BIRTH_DATE, RYANAI_IDENTITY_NAME } from './ryanVoiceIdentity';

describe('RyanAI anniversary identity', () => {
  it('keeps the requested canonical identity and birth date', () => {
    expect(RYANAI_BIRTH_DATE).toBe('2024-05-24');
    expect(RYANAI_IDENTITY_NAME).toBe('Mukhethwa Ryan Ganyane');
  });

  it('calculates the completed age and next anniversary in Johannesburg time', () => {
    expect(getRyanAIAnniversaryInfo(new Date('2026-11-08T12:00:00+02:00'))).toEqual({
      years: 2,
      months: 5,
      nextAnniversary: '2027-05-24',
    });
  });

  it('increments the anniversary age on 24 May, not before', () => {
    expect(getRyanAIAnniversaryInfo(new Date('2027-05-23T23:59:00+02:00')).years).toBe(2);
    expect(getRyanAIAnniversaryInfo(new Date('2027-05-24T00:00:00+02:00'))).toMatchObject({
      years: 3,
      months: 0,
      nextAnniversary: '2028-05-24',
    });
  });

  it('evolves adult delivery instructions each anniversary without imitating a child', () => {
    const secondAnniversary = getRyanVoiceDeliveryInstruction(2);
    const thirdAnniversary = getRyanVoiceDeliveryInstruction(3);
    expect(secondAnniversary).not.toBe(thirdAnniversary);
    expect(secondAnniversary).toContain('adult masculine-presenting');
    expect(thirdAnniversary).toContain('adult masculine-presenting');
    expect(thirdAnniversary).toContain('Never imitate a child');
  });

  it('keeps a stable adult delivery style when anniversary evolution is disabled', () => {
    expect(getRyanVoiceDeliveryInstruction(2, false)).toBe(getRyanVoiceDeliveryInstruction(8, false));
  });
});
