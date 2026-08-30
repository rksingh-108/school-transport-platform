import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { cameraHeartbeatSchema, type CameraHeartbeatInput } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { CamerasService } from './cameras.service';
import { CameraDeviceAuthGuard } from './guards/camera-device-auth.guard';

// Same rationale/shape as GPS_INGEST_THROTTLE (gps-ingestion.controller.ts):
// decorator metadata is evaluated before ConfigService exists, so this reads
// process.env directly. A camera controller's realistic heartbeat cadence is
// far lower than a GPS tracker's, hence the much lower default.
const CAMERA_HEARTBEAT_THROTTLE = {
  default: { limit: Number(process.env['CAMERA_HEARTBEAT_RATE_LIMIT_PER_MINUTE'] ?? 20), ttl: 60_000 },
};

/**
 * The device-facing camera heartbeat boundary (Phase 2 Step 11). `@Public()`
 * so the global JwtAuthGuard no-ops here — this endpoint is authenticated by
 * CameraDeviceAuthGuard (an opaque device bearer credential), never a
 * staff/parent access token. No `schoolId`/`busId`/`cameraId` field exists on
 * the payload at all — identity is always resolved server-side from the
 * authenticated device credential, the same IDOR-by-construction pattern as
 * GPS ingestion. See docs/adr/0018-camera-device-management-foundation.md.
 */
@Public()
@UseGuards(CameraDeviceAuthGuard)
@Controller('camera-devices')
export class CameraDevicesController {
  constructor(private readonly camerasService: CamerasService) {}

  @Throttle(CAMERA_HEARTBEAT_THROTTLE)
  @Post('heartbeat')
  async heartbeat(@Body(new ZodValidationPipe(cameraHeartbeatSchema)) body: CameraHeartbeatInput, @Req() req: Request) {
    const device = req.cameraDevice!;
    await this.camerasService.heartbeat(device, body);
    return { ok: true };
  }
}
