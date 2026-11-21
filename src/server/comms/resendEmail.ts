export type ResendEmailDeliveryState =
  | 'accepted_by_provider'
  | 'delivered'
  | 'queued'
  | 'failed'
  | 'unknown';

/**
 * Translate authenticated Resend events into the platform-neutral delivery
 * vocabulary. Only delivered (or a later open/click event) proves delivery.
 */
export function mapResendEmailDeliveryState(eventType: string): ResendEmailDeliveryState {
  switch (eventType.trim().toLowerCase()) {
    case 'email.sent':
      return 'accepted_by_provider';
    case 'email.delivered':
    case 'email.opened':
    case 'email.clicked':
      return 'delivered';
    case 'email.delivery_delayed':
      return 'queued';
    case 'email.bounced':
    case 'email.complained':
    case 'email.failed':
    case 'email.suppressed':
      return 'failed';
    default:
      return 'unknown';
  }
}
