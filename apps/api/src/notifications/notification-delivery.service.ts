import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { Env } from '../config/env.schema';
import type { NotificationContent } from './notification-templates';
import {
  EMAIL_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  type NotificationChannelProvider,
  type NotificationProviderResult,
} from './providers/notification-provider.interface';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attempts delivery of one already-created `NotificationDelivery` row over
 * its external channel (PUSH/SMS/EMAIL — IN_APP has no delivery row at all,
 * see NotificationsService) with a bounded, synchronous retry.
 *
 * **Deliberate simplification**: retry happens entirely within this one
 * call — there is no background job/queue that re-attempts a `FAILED`
 * delivery later. This phase has no real external provider that could
 * produce a genuine async transient failure to retry in the first place
 * (`NotConfiguredProvider` returns a terminal `NOT_CONFIGURED` immediately,
 * never `FAILED`); building a job scheduler solely to retry a provider that
 * doesn't exist yet would be exactly the over-engineering this phase's
 * instructions warn against. A future real provider integration can layer
 * async requeue on top of the same `attempts`/`lastAttemptAt` columns
 * without a model change. See docs/adr/0016-notifications-and-alerts.md.
 */
@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: NotificationChannelProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationChannelProvider,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: NotificationChannelProvider,
  ) {}

  private providerFor(channel: NotificationChannel): NotificationChannelProvider {
    if (channel === 'PUSH') return this.pushProvider;
    if (channel === 'SMS') return this.smsProvider;
    return this.emailProvider;
  }

  async deliver(schoolId: string, deliveryId: string, channel: NotificationChannel, to: string, content: NotificationContent): Promise<void> {
    const provider = this.providerFor(channel);
    const maxAttempts = this.config.get('NOTIFICATION_MAX_DELIVERY_ATTEMPTS', { infer: true });
    const backoffMs = this.config.get('NOTIFICATION_RETRY_BACKOFF_MS', { infer: true });

    let result: NotificationProviderResult | null = null;
    let attempts = 0;

    await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.notificationDelivery.update({ where: { id: deliveryId }, data: { status: 'PROCESSING' } }),
    );

    while (attempts < maxAttempts) {
      attempts += 1;
      result = await provider.send({ to, title: content.title, body: content.body });
      const shouldRetry = result.status === 'FAILED' && result.retryable && attempts < maxAttempts;
      if (!shouldRetry) break;
      await sleep(backoffMs);
    }

    const now = new Date();
    await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts,
          lastAttemptAt: now,
          status: result?.status ?? 'FAILED',
          providerMessageId: result?.providerMessageId,
          failureReason: result?.failureReason,
          deliveredAt: result?.status === 'SENT' ? now : undefined,
          failedAt: result?.status === 'FAILED' ? now : undefined,
        },
      }),
    );
  }
}
