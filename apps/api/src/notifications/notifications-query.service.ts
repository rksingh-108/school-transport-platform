import { Injectable, NotFoundException } from '@nestjs/common';
import type { RecipientType } from '@prisma/client';
import type { CursorPage, NotificationDto, UnreadCountDto } from '@school-transport/shared-types';
import type { ListNotificationsQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import { toCursorPage } from '../common/pagination';

type NotificationRow = {
  id: string;
  eventType: string;
  title: string;
  body: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Shared read/mark-read logic for both notification audiences (parent and
 * staff) — the query shape is identical either way, only which
 * `(recipientType, recipientId)` pair scopes it differs, and that's
 * resolved by each controller from its own authenticated principal, never
 * from a client-supplied value (Phase 1 Step 9). See
 * docs/adr/0016-notifications-and-alerts.md and
 * docs/security.md#5.8-notification-authorization.
 */
@Injectable()
export class NotificationsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    schoolId: string,
    recipientType: RecipientType,
    recipientId: string,
    query: ListNotificationsQuery,
  ): Promise<CursorPage<NotificationDto>> {
    const rows = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.notification.findMany({
        where: { recipientType, recipientId },
        orderBy: { createdAt: 'desc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );
    const page = toCursorPage(rows, query.limit);
    return { ...page, data: page.data.map((r) => this.toDto(r)) };
  }

  /** One indexed COUNT query — see the `(schoolId, recipientType, recipientId, readAt)` index. Never scans the full notification list. */
  async unreadCount(schoolId: string, recipientType: RecipientType, recipientId: string): Promise<UnreadCountDto> {
    const count = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.notification.count({ where: { recipientType, recipientId, readAt: null } }),
    );
    return { count };
  }

  async markRead(schoolId: string, recipientType: RecipientType, recipientId: string, id: string): Promise<NotificationDto> {
    const updated = await this.prisma.runInTenantContext(schoolId, async (tx) => {
      const existing = await tx.notification.findFirst({ where: { id, recipientType, recipientId } });
      if (!existing) throw new NotFoundException();
      if (existing.readAt) return existing;
      return tx.notification.update({ where: { id }, data: { readAt: new Date() } });
    });
    return this.toDto(updated);
  }

  async markAllRead(schoolId: string, recipientType: RecipientType, recipientId: string): Promise<{ updated: number }> {
    const result = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.notification.updateMany({ where: { recipientType, recipientId, readAt: null }, data: { readAt: new Date() } }),
    );
    return { updated: result.count };
  }

  private toDto(row: NotificationRow): NotificationDto {
    return {
      id: row.id,
      eventType: row.eventType as NotificationDto['eventType'],
      title: row.title,
      body: row.body,
      payload: (row.payload as Record<string, string> | null) ?? null,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
