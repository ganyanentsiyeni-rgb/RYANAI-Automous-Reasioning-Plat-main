import { afterEach, describe, expect, it, vi } from 'vitest';
import { areCommunicationAttachmentsEnabled, isCommunicationsEnabled, isCommunicationsTestAuthorized } from './featureFlags.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('communications feature flags', () => {
  it('fails closed when communication flags are missing or empty', () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', '');
    vi.stubEnv('COMMUNICATION_ATTACHMENTS_ENABLED', '');
    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', '');

    expect(isCommunicationsEnabled()).toBe(false);
    expect(areCommunicationAttachmentsEnabled()).toBe(false);
  });

  it('requires the exact lowercase opt-in value', () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'TRUE');
    vi.stubEnv('COMMUNICATION_ATTACHMENTS_ENABLED', 'true');
    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', 'true');

    expect(isCommunicationsEnabled()).toBe(false);
    expect(areCommunicationAttachmentsEnabled()).toBe(false);
  });

  it('requires communications, attachment handling, and malware scanning', () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'true');
    vi.stubEnv('COMMUNICATION_ATTACHMENTS_ENABLED', 'true');
    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', 'false');

    expect(areCommunicationAttachmentsEnabled()).toBe(false);

    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', 'true');
    expect(areCommunicationAttachmentsEnabled()).toBe(true);
  });

  it('keeps attachments disabled when communications are disabled', () => {
    vi.stubEnv('COMMUNICATIONS_ENABLED', 'false');
    vi.stubEnv('COMMUNICATION_ATTACHMENTS_ENABLED', 'true');
    vi.stubEnv('ATTACHMENT_SCANNER_ENABLED', 'true');

    expect(areCommunicationAttachmentsEnabled()).toBe(false);
  });
});


describe('communications test authorization', () => {
  it('fails closed unless the explicit test authorization flag is exactly true', () => {
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', '');
    expect(isCommunicationsTestAuthorized()).toBe(false);
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'TRUE');
    expect(isCommunicationsTestAuthorized()).toBe(false);
    vi.stubEnv('RYANAI_COMMS_TEST_AUTHORIZED', 'true');
    expect(isCommunicationsTestAuthorized()).toBe(true);
  });
});
