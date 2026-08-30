import { forwardRef, Inject } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { BusLocationUpdatedEvent } from '@school-transport/shared-types';
import { TokenService } from '../auth/services/token.service';
import { AuthService } from '../auth/services/auth.service';
import { RbacService } from '../auth/services/rbac.service';
import { GpsService } from './gps.service';

// @WebSocketGateway's options are resolved at class-decoration time, before
// Nest's DI container exists — the same reason auth.controller.ts reads
// throttle limits from a module-level constant rather than ConfigService.
// Reading process.env directly here mirrors that.
const CORS_ORIGIN = process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';

/**
 * Realtime fleet-location fan-out (Phase 1 Step 7). STAFF-only in this
 * phase — parents get no live tracking at all yet (that's Step 8), so a
 * parent token is rejected here exactly like an unauthenticated connection,
 * not merely "given no rooms."
 *
 * Room granularity mirrors the REST scoping in GpsService.resolveGpsScope:
 * unscoped staff (SCHOOL_ADMIN/TRANSPORT_ADMIN/TRANSPORT_MANAGER/PRINCIPAL/
 * SECURITY) join the whole-school `school:{id}:fleet` room; DRIVER/
 * BUS_ATTENDANT join only `school:{id}:bus:{busId}` for their own current
 * trip's bus (or no room at all if they have no current trip — they simply
 * receive nothing, which is the safe default). The client never supplies a
 * room name — every join target is computed server-side from the verified
 * principal, closing the "arbitrary room" IDOR class by construction.
 *
 * No client-provided busId/schoolId/room name is ever trusted for
 * authorization purposes.
 *
 * Deliberately no Redis adapter yet, despite ADR 0005 committing to one "for
 * horizontal scaling from day one" — this MVP runs a single API instance,
 * and adding the Redis pub/sub adapter now (a separate, non-multiplexing
 * Redis connection pair) is exactly the kind of upfront complexity this
 * phase's instructions say to avoid until a real multi-instance deployment
 * exists to validate it against. Swapping in `@socket.io/redis-adapter`
 * later touches only this gateway's bootstrap, not the event contract or
 * any call site — tracked in docs/roadmap.md.
 */
@WebSocketGateway({ namespace: '/realtime/fleet', cors: { origin: CORS_ORIGIN, credentials: true } })
export class GpsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;

  constructor(
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly rbacService: RbacService,
    @Inject(forwardRef(() => GpsService)) private readonly gpsService: GpsService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.['token'] as string | undefined;
      if (!token) throw new Error('missing token');

      const claims = this.tokenService.verifyAccessToken(token);
      if (claims.type !== 'STAFF') throw new Error('parents have no fleet-tracking access in this phase');

      const principal = await this.authService.loadAuthenticatedPrincipal(claims.schoolId, claims.type, claims.sub);
      if (!principal) throw new Error('account no longer active');

      const granted = await this.rbacService.hasPermission(principal.schoolId, principal.id, 'gps.read');
      if (!granted) throw new Error('insufficient permission');

      const scope = await this.gpsService.resolveGpsScope(principal);
      if (scope.scope === 'ALL') {
        await client.join(this.fleetRoom(principal.schoolId));
      } else if (scope.busId) {
        await client.join(this.busRoom(principal.schoolId, scope.busId));
      }
      // else: a driver/attendant profile with no current in-progress trip —
      // joins nothing, so they simply receive no events, which is correct.
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // No per-connection state to clean up beyond what Socket.IO already does on disconnect.
  }

  /** Called by GpsService after a fresh, monotonically-newer fix is accepted. Never called with any other tenant's data. */
  emitLocationUpdate(schoolId: string, busId: string, payload: BusLocationUpdatedEvent): void {
    this.server.to(this.fleetRoom(schoolId)).to(this.busRoom(schoolId, busId)).emit('bus.location.updated', payload);
  }

  private fleetRoom(schoolId: string): string {
    return `school:${schoolId}:fleet`;
  }

  private busRoom(schoolId: string, busId: string): string {
    return `school:${schoolId}:bus:${busId}`;
  }
}
