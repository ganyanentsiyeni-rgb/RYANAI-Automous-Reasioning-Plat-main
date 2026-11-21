import { describe, expect, it } from 'vitest';
import { dispatchAction } from './dispatch.js';

describe('legacy dispatchAction safety boundary', () => {
  it.each([
    ['send_email', { to: 'owner@example.test', subject: 'Test', html: 'Test' }],
    ['send_whatsapp_message', { to: '+15555550123', message: 'Test' }],
    ['make_voice_call', { to: '+15555550123', twimlMessage: 'Test' }],
  ] as const)('fails closed for %s without contacting a provider', async (tool, args) => {
    await expect(dispatchAction(tool, args)).rejects.toThrow(
      /Legacy outbound communications dispatch is disabled/,
    );
  });
});
