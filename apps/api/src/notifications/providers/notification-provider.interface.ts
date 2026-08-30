/**
 * Boundary for delivering a notification over one external channel
 * (PUSH/SMS/EMAIL). Mirrors the exact shape/spirit of
 * `AuthNotificationAdapter` (apps/api/src/auth/notifications/) — every
 * delivery call site depends on this interface, never a concrete vendor
 * SDK, so wiring up a real provider later touches one binding, not every
 * caller. See docs/adr/0016-notifications-and-alerts.md.
 */
export interface NotificationProviderResult {
  status: 'SENT' | 'NOT_CONFIGURED' | 'FAILED';
  providerMessageId?: string;
  /** Set only for FAILED. `retryable: true` means a transient condition worth a bounded retry; `false` means a permanent failure (bad address, rejected recipient) that must not be retried. */
  failureReason?: string;
  retryable?: boolean;
}

export interface NotificationChannelProvider {
  send(params: { to: string; title: string; body: string }): Promise<NotificationProviderResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
