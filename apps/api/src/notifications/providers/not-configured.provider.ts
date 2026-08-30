import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannelProvider, NotificationProviderResult } from './notification-provider.interface';

/**
 * The only PUSH/SMS/EMAIL provider wired up in this phase — no real vendor
 * (Firebase/Twilio/SendGrid/etc.) is configured, and none is hard-coded.
 * Deliberately does NOT pretend to deliver anything: it logs the attempt
 * clearly labeled as unconfigured (so a developer can see a delivery was
 * *attempted*, distinguishing this from silently doing nothing) and always
 * returns `NOT_CONFIGURED` — never `SENT`. A real provider binds a
 * different class to the same `PUSH_PROVIDER`/`SMS_PROVIDER`/
 * `EMAIL_PROVIDER` token later; no call site changes. See
 * docs/adr/0016-notifications-and-alerts.md.
 */
@Injectable()
export class NotConfiguredProvider implements NotificationChannelProvider {
  private readonly logger = new Logger(NotConfiguredProvider.name);

  async send(params: { to: string; title: string; body: string }): Promise<NotificationProviderResult> {
    this.logger.warn(
      `[NOT_CONFIGURED — no delivery attempted] Would have sent "${params.title}" to ${params.to}. ` +
        'No external notification provider is configured for this deployment.',
    );
    return { status: 'NOT_CONFIGURED', failureReason: 'No provider is configured for this channel.' };
  }
}
