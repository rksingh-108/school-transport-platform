import { WebSocketGateway, WebSocketServer, type OnGatewayConnection, type OnGatewayDisconnect } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AIObservationDto } from '@school-transport/shared-types';
import { TokenService } from '../auth/services/token.service';
import { AuthService } from '../auth/services/auth.service';
import { RbacService } from '../auth/services/rbac.service';

// See gps.gateway.ts's identical constant/comment — @WebSocketGateway's
// options are resolved before Nest's DI container exists.
const CORS_ORIGIN = process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';

/**
 * Realtime AI-observation fan-out (Phase 3 Step 14). STAFF-only, same
 * posture/shape as SafetyGateway (`/realtime/safety`) — a parent token is
 * rejected exactly like an unauthenticated connection, there is no
 * `@SubscribeMessage` handler anywhere on this class (no mechanism for a
 * client to join, request, or discover any room), and room membership is a
 * single whole-school room (`school:{id}:ai-observations`) gated by
 * `ai_events.read` — the same permission that gates the REST list/detail
 * endpoints. Only emits AFTER `AiObservationsService.ingest()` has already
 * deduplicated/aggregated a raw detection into a candidate observation —
 * never once per raw inference frame (see the ADR's "realtime" decision).
 */
@WebSocketGateway({ namespace: '/realtime/ai-observations', cors: { origin: CORS_ORIGIN, credentials: true } })
export class AiObservationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
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
      if (claims.type !== 'STAFF') throw new Error('only staff may join the ai-observations namespace');

      const principal = await this.authService.loadAuthenticatedPrincipal(claims.schoolId, claims.type, claims.sub);
      if (!principal) throw new Error('account no longer active');

      const canRead = await this.rbacService.hasPermission(principal.schoolId, principal.id, 'ai_events.read');
      if (!canRead) throw new Error('insufficient permission');

      await client.join(this.room(principal.schoolId));
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // No per-connection state to clean up beyond what Socket.IO already does on disconnect.
  }

  emitObservationCreated(schoolId: string, observation: AIObservationDto): void {
    this.server.to(this.room(schoolId)).emit('ai.observation.created', observation);
  }

  emitObservationUpdated(schoolId: string, observation: AIObservationDto): void {
    this.server.to(this.room(schoolId)).emit('ai.observation.updated', observation);
  }

  private room(schoolId: string): string {
    return `school:${schoolId}:ai-observations`;
  }
}
