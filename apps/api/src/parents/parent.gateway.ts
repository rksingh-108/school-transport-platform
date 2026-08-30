import { OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type {
  ParentChildTransportUpdatedEvent,
  ParentTripStatus,
  ParentAttendanceStatus,
  NotificationDto,
} from '@school-transport/shared-types';
import { TokenService } from '../auth/services/token.service';
import { AuthService } from '../auth/services/auth.service';
import { ParentAccessService } from '../auth/services/parent-access.service';
import { PrismaService } from '../database/prisma.service';
import { GpsGateway, type GpsLocationUpdate } from '../gps/gps.gateway';

// See the identical note in gps.gateway.ts — decorator options are resolved
// before Nest's DI container exists.
const CORS_ORIGIN = process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';

/**
 * Realtime, child-scoped transport updates for parents (Phase 1 Step 8) —
 * a completely separate namespace/room space from `GpsGateway`'s
 * `/realtime/fleet`, not an extension of it. A parent socket never joins
 * `school:{id}:fleet` or `school:{id}:bus:{busId}` — it only ever joins
 * `parent:child:{studentId}` rooms, one per verified linked child, computed
 * entirely server-side from the authenticated parent's own
 * `ParentAccessService.getVerifiedChildIds` — there is no code path where a
 * client can request or discover a room name (same "eliminate the input"
 * technique as GpsGateway's own room design).
 *
 * Triggered by `GpsGateway.onLocationUpdate` (an in-process EventEmitter,
 * not a new room subscription) rather than duplicating the
 * current-location/monotonic-timestamp pipeline. This means the realtime
 * push is GPS-triggered: a boarding/drop-off event with no GPS fix arriving
 * in between it and the next one won't independently trigger a push in this
 * phase. This is an accepted simplification — a trip that's `IN_PROGRESS`
 * normally has frequent GPS pings anyway, so a boarding event is picked up
 * within seconds by the next tick, and the REST endpoint
 * (`GET /parent/children/:studentId/transport`) always reflects the true
 * current state on load/reconnect regardless. See
 * docs/adr/0015-parent-transport-tracking.md.
 */
@WebSocketGateway({ namespace: '/realtime/parent', cors: { origin: CORS_ORIGIN, credentials: true } })
export class ParentGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() private server!: Server;

  constructor(
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly parentAccessService: ParentAccessService,
    private readonly prisma: PrismaService,
    private readonly gpsGateway: GpsGateway,
  ) {}

  onModuleInit(): void {
    this.gpsGateway.onLocationUpdate((update) => {
      this.handleLocationUpdate(update).catch(() => {
        // Best-effort fan-out — a failure here must never affect ingestion
        // or the staff-facing realtime path, which has already succeeded by
        // the time this listener runs.
      });
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.['token'] as string | undefined;
      if (!token) throw new Error('missing token');

      const claims = this.tokenService.verifyAccessToken(token);
      if (claims.type !== 'PARENT') throw new Error('only parents may join this namespace');

      const principal = await this.authService.loadAuthenticatedPrincipal(claims.schoolId, claims.type, claims.sub);
      if (!principal) throw new Error('account no longer active');

      const childIds = await this.parentAccessService.getVerifiedChildIds(principal.schoolId, principal.id);
      await Promise.all(childIds.map((studentId) => client.join(this.childRoom(studentId))));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // No per-connection state to clean up beyond what Socket.IO already does on disconnect.
  }

  private async handleLocationUpdate({ schoolId, busId, payload }: GpsLocationUpdate): Promise<void> {
    if (!payload.tripId) return; // no trip context — nothing to attribute to a child

    const rows = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.tripStudent.findMany({
        where: { tripId: payload.tripId!, membershipStatus: { not: 'REMOVED' } },
        select: {
          studentId: true,
          currentStatus: true,
          trip: { select: { status: true } },
        },
      }),
    );
    if (rows.length === 0) return;

    const bus = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.bus.findFirst({ where: { id: busId }, select: { registrationNumber: true, fleetNumber: true } }),
    );
    const busDisplayName = bus ? (bus.fleetNumber ? `Bus ${bus.fleetNumber}` : bus.registrationNumber) : 'Bus';

    for (const row of rows) {
      const event: ParentChildTransportUpdatedEvent = {
        childId: row.studentId,
        tripStatus: row.trip.status as ParentTripStatus,
        attendanceStatus: row.currentStatus as ParentAttendanceStatus,
        busDisplayName,
        location: {
          latitude: payload.latitude,
          longitude: payload.longitude,
          speedKmh: payload.speedKmh,
          heading: payload.heading,
          freshness: payload.freshness,
        },
        lastUpdatedAt: payload.recordedAt,
      };
      this.server.to(this.childRoom(row.studentId)).emit('parent.child.transport.updated', event);
    }
  }

  /**
   * Called by NotificationsService (Phase 1 Step 9) right after a
   * `CHILD_BOARDED`/`CHILD_DROPPED_OFF` notification is durably created —
   * pushed into the same child room the live transport updates already
   * use, not a second namespace. Only these two child-specific event types
   * push in realtime this phase; trip-level (cancelled/no-show) and staff
   * notifications are in-app + REST poll only — see
   * docs/adr/0016-notifications-and-alerts.md for why that's an accepted
   * scope cut, not an oversight.
   */
  emitNotificationToChild(studentId: string, notification: NotificationDto): void {
    this.server.to(this.childRoom(studentId)).emit('parent.notification.created', notification);
  }

  private childRoom(studentId: string): string {
    return `parent:child:${studentId}`;
  }
}
