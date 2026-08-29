import { Injectable, Logger } from '@nestjs/common';
import type { AuthNotificationAdapter } from './notification-adapter.interface';

/**
 * Development-only stand-in for a real email/SMS provider. It does NOT
 * pretend to deliver anything — it logs the reset link clearly labeled as a
 * local-dev mechanism, so a developer can complete the password-reset flow
 * without a real mailbox. This must never be the adapter used in production;
 * see docs/roadmap.md for when a real provider adapter is built.
 */
@Injectable()
export class ConsoleNotificationAdapter implements AuthNotificationAdapter {
  private readonly logger = new Logger(ConsoleNotificationAdapter.name);

  async sendPasswordResetLink(params: {
    to: { email?: string | null; phone?: string | null };
    principalType: 'STAFF' | 'PARENT';
    resetToken: string;
  }): Promise<void> {
    this.logger.warn(
      `[DEV-ONLY, NOT REAL DELIVERY] Password reset requested for ${params.principalType} ` +
        `(${params.to.email ?? params.to.phone ?? 'unknown'}). Reset token: ${params.resetToken}`,
    );
  }
}
