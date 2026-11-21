import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressOwnerMessage,
  communicationSystemInstruction,
  getOwnerGreeting,
  getOwnerTitle,
} from './personalization.js';

afterEach(() => vi.unstubAllEnvs());

describe('RyanAI owner communication personalization', () => {
  it('defaults to the respectful Sir G title', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', '');
    expect(getOwnerTitle()).toBe('Sir G');
    expect(addressOwnerMessage('Your report is ready.')).toBe('Sir G, Your report is ready.');
  });

  it('respects an explicitly configured owner title without duplicating it', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', 'Captain');
    expect(getOwnerTitle()).toBe('Captain');
    expect(addressOwnerMessage('Captain, the task is complete.')).toBe('Captain, the task is complete.');
  });

  it('sets South African English as the spoken and written communication standard', () => {
    vi.stubEnv('RYANAI_OWNER_TITLE', 'Sir G');
    const instruction = communicationSystemInstruction();
    expect(instruction).toContain('English - South Africa');
    expect(instruction).toContain('Sir G');
    expect(instruction).toContain('Africa/Johannesburg');
    expect(instruction).toContain('weekday, date, time, greetings');
    expect(getOwnerGreeting()).toContain('Sir G. Today is');
  });
});
