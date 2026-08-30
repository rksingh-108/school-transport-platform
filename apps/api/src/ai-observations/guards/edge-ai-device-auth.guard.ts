import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AiObservationsService } from '../ai-observations.service';

/**
 * The device-facing analogue of JwtAuthGuard for edge-AI controllers —
 * verifies an EDGE_COMPUTER device's opaque bearer credential (never a
 * staff/parent JWT, never a camera or GPS device's credential) and
 * populates `request.edgeAiDevice`. Its own guard rather than a shared
 * cross-domain one, for the identical reason ADR 0018 Decision 2 gives for
 * Camera's own guard: a GPS tracker's or camera controller's credential
 * must never authenticate an edge-AI submission, or vice versa.
 */
@Injectable()
export class EdgeAiDeviceAuthGuard implements CanActivate {
  constructor(private readonly aiObservationsService: AiObservationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing device credential.');
    }

    const device = await this.aiObservationsService.resolveDeviceByCredential(authHeader.slice('Bearer '.length));
    if (!device) {
      throw new UnauthorizedException('Invalid device credential.');
    }

    request.edgeAiDevice = device;
    return true;
  }
}
