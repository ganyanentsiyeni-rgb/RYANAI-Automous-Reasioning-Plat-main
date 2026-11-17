/**
 * Production communications and attachment handling are opt-in.
 * Missing, empty, misspelled, or non-lowercase values remain disabled.
 * Attachment operations additionally require the malware scanner.
 */
export function isCommunicationsEnabled(): boolean {
  return process.env.COMMUNICATIONS_ENABLED === 'true';
}

export function areCommunicationAttachmentsEnabled(): boolean {
  return isCommunicationsEnabled()
    && process.env.COMMUNICATION_ATTACHMENTS_ENABLED === 'true'
    && process.env.ATTACHMENT_SCANNER_ENABLED === 'true';
}

/** Outbound provider calls require a separate, explicit owner-authorized test gate. */
export function isCommunicationsTestAuthorized(): boolean {
  return process.env.RYANAI_COMMS_TEST_AUTHORIZED === 'true';
}
