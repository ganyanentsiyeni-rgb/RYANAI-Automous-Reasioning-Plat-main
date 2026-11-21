import { describe, expect, it } from 'vitest';
import {
  addressOwnerResponse,
  createLoginGreeting,
  getAddress,
  getLocalDateTimeContext,
  getTimeGreeting,
  RYANAI_LOCALE,
  RYANAI_TIME_ZONE,
} from './ryanIdentity.js';

describe('RyanAI identity and South African English defaults', () => {
  it('uses Sir G for the configured owner identity', () => {
    expect(getAddress({ isOwner: true, displayName: 'Ntsiyeni' })).toBe('Sir G');
  });

  it('uses a verified display name for other users', () => {
    expect(getAddress({ displayName: 'Alex Mokoena' })).toBe('Alex Mokoena');
  });

  it('falls back to the email local part when no display name exists', () => {
    expect(getAddress({ email: 'alex@example.test' })).toBe('alex');
  });

  it('uses South African English and Johannesburg timezone defaults', () => {
    expect(RYANAI_LOCALE).toBe('en-ZA');
    expect(RYANAI_TIME_ZONE).toBe('Africa/Johannesburg');
  });

  it('recognises morning, afternoon, evening and late night in Johannesburg time', () => {
    expect(getTimeGreeting(new Date('2026-11-23T04:30:00.000Z'))).toBe('Good morning');
    expect(getTimeGreeting(new Date('2026-11-23T10:30:00.000Z'))).toBe('Good afternoon');
    expect(getTimeGreeting(new Date('2026-11-23T16:30:00.000Z'))).toBe('Good evening');
    expect(getTimeGreeting(new Date('2026-11-23T20:30:00.000Z'))).toBe('Good night');
  });

  it('includes the local weekday, full date and time in the owner context', () => {
    const context = getLocalDateTimeContext(new Date('2026-11-23T16:30:00.000Z'));
    expect(context).toContain('Monday');
    expect(context).toContain('23 November 2026');
    expect(context).toContain('18:30');
    expect(context).toContain('Africa/Johannesburg');
  });

  it('creates a login greeting with owner address and live local date-time context', () => {
    const greeting = createLoginGreeting(
      { isOwner: true },
      new Date('2026-11-23T04:30:00.000Z'),
    );
    expect(greeting).toContain('Good morning, Sir G.');
    expect(greeting).toContain('Monday, 23 November 2026 at 06:30');
  });

  it('addresses owner communications once without duplicating Sir G', () => {
    expect(addressOwnerResponse('Your systems are ready.')).toBe('Certainly, Sir G. Your systems are ready.');
    expect(addressOwnerResponse('Certainly, Sir G. Your systems are ready.')).toBe('Certainly, Sir G. Your systems are ready.');
  });
});
