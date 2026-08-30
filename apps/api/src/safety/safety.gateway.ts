import { WebSocketGateway, WebSocketServer, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { EmergencyDto, SafetyEventDto } from '@school-transport/shared-types';
import { TokenService } from '../auth/services/token.service';
import { AuthService } from '../auth/services/auth.service';
import { RbacService } from '../auth/services/rbac.service';

// See gps.gateway.ts's identical constant/comment — @WebSocketGateway's
// options are resolved before Nest's DI container exists.
const CORS_ORIGIN = process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';

/**
 * Realtime safety-event/emergency fan-out (Phase 2 Step 12). STAFF-only,
 * same posture as GpsGateway (`/realtime/fleet`) — a parent token is
 * rejected exactly like an unauthenticated connection, and there is no
 * `@SubscribeMessage` handler anywhere on this class, so there is no
 * mechanism at all for a client to join, request, or discover any room.
 * Room membership is a single whole-school room
 * (`school:{id}:safety`) — no per-bus/per-trip granularity is needed here
 * (unlike GPS's fleet-vs-bus split): every role that can see the safety/
 * emergency dashboard at all is meant to see every event in their school,
 * not a bus-scoped subset. DRIVER/BUS_ATTENDANT never connect here at all —
 * neither `safety_events.read` nor `emergency.read` is ever granted to
 * either role (see packages/shared-types/src/rbac.ts), so the permission
 * check below rejects them the same way it rejects a parent.
 *
 * No Redis adapter — same single-instance-MVP reasoning as GpsGateway.
 */
@WebSocketGateway({ namespace: '/realtime/safety', cors: { origin: CORS_ORIGIN, credentials: true } })
export class SafetyGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;

  constructor(
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly rbacService: RbacService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.['token'] as string | undefined;
      if (!token) throw new Error('missing token');

      const claims = this.tokenService.verifyAccessToken(token);
      if (claims.type !== 'STAFF') throw new Error('only staff may join the safety namespace');

      const principal = await this.authService.loadAuthenticatedPrincipal(claims.schoolId, claims.type, claims.sub);
      if (!principal) throw new Error('account no longer active');

      const [canReadSafety, canReadEmergency] = await Promise.all([
        this.rbacService.hasPermission(principal.schoolId, principal.id, 'safety_events.read'),
        this.rbacService.hasPermission(principal.schoolId, principal.id, 'emergency.read'),
      ]);
      if (!canReadSafety && !canReadEmergency) throw new Error('insufficient permission');

      await client.join(this.safetyRoom(principal.schoolId));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // No per-connection state to clean up beyond what Socket.IO already does on disconnect.
  }

  emitSafetyEventCreated(schoolId: string, event: SafetyEventDto): void {
    this.server.to(this.safetyRoom(schoolId)).emit('safety.event.created', event);
  }

  emitSafetyEventUpdated(schoolId: string, event: SafetyEventDto): void {
    this.server.to(this.safetyRoom(schoolId)).emit('safety.event.updated', event);
  }

  emitEmergencyCreated(schoolId: string, emergency: EmergencyDto): void {
    this.server.to(this.safetyRoom(schoolId)).emit('emergency.created', emergency);
  }

  emitEmergencyUpdated(schoolId: string, emergency: EmergencyDto): void {
    this.server.to(this.safetyRoom(schoolId)).emit('emergency.updated', emergency);
  }

  private safetyRoom(schoolId: string): string {
    return `school:${schoolId}:safety`;
  }
}
