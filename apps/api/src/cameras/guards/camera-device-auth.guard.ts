import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CamerasService } from '../cameras.service';

/**
 * The device-facing analogue of JwtAuthGuard for camera controllers — verifies
 * a camera controller's opaque bearer credential (never a staff/parent JWT)
 * and populates `request.cameraDevice`. Applied only to the camera heartbeat
 * route, which is also marked `@Public()` so the global JwtAuthGuard no-ops
 * on it. Deliberately its own guard rather than reusing GPS's DeviceAuthGuard
 * — that guard resolves credentials filtered to deviceType GPS_TRACKER only,
 * and sharing it would either weaken that filter or require threading a
 * deviceType parameter through a guard's constructor, more coupling than the
 * ~10 lines this duplicates. See
 * docs/adr/0018-camera-device-management-foundation.md.
 */
@Injectable()
export class CameraDeviceAuthGuard implements CanActivate {
  constructor(private readonly camerasService: CamerasService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing device credential.');
    }

    const device = await this.camerasService.resolveDeviceByCredential(authHeader.slice('Bearer '.length));
    if (!device) {
      throw new UnauthorizedException('Invalid device credential.');
    }

    request.cameraDevice = device;
    return true;
  }
}
