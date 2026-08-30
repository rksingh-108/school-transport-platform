import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { GpsService } from '../gps.service';

/**
 * The device-facing analogue of JwtAuthGuard — verifies a device's opaque
 * bearer credential (never a staff/parent JWT) and populates
 * `request.device`. Applied only to the GPS ingestion route, which is also
 * marked `@Public()` so the global JwtAuthGuard no-ops on it instead of
 * demanding a staff/parent access token. See
 * docs/adr/0014-gps-telemetry-and-realtime-tracking.md and
 * docs/security.md#5.1-device-security.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly gpsService: GpsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing device credential.');
    }

    const device = await this.gpsService.resolveDeviceByCredential(authHeader.slice('Bearer '.length));
    if (!device) {
      throw new UnauthorizedException('Invalid device credential.');
    }

    request.device = device;
    return true;
  }
}
