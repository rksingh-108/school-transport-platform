import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { gpsTelemetrySchema, type GpsTelemetryInput } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { GpsService } from './gps.service';
import { DeviceAuthGuard } from './guards/device-auth.guard';

// Configurable via env (read directly — see the note in gps.gateway.ts for
// why decorator metadata can't go through ConfigService). Generous enough
// for a device reporting every few seconds without allowing unbounded
// flooding; revisit with real device fleet traffic before launch, same
// caveat as auth.controller.ts's SENSITIVE_AUTH_THROTTLE.
const GPS_INGEST_THROTTLE = {
  default: { limit: Number(process.env['GPS_INGEST_RATE_LIMIT_PER_MINUTE'] ?? 120), ttl: 60_000 },
};

/**
 * The device-facing GPS ingestion boundary (Phase 1 Step 7). `@Public()` so
 * the global JwtAuthGuard no-ops here — this endpoint is authenticated by
 * DeviceAuthGuard (an opaque device bearer credential), never a staff/parent
 * access token. The payload carries no `schoolId`/`busId`/`deviceId`/
 * `tripId` at all — those are always resolved server-side from the
 * authenticated device identity, closing an entire IDOR class by
 * construction. See docs/adr/0014-gps-telemetry-and-realtime-tracking.md.
 */
@Public()
@UseGuards(DeviceAuthGuard)
@Controller('telemetry')
export class GpsIngestionController {
  constructor(private readonly gpsService: GpsService) {}

  @Throttle(GPS_INGEST_THROTTLE)
  @Post('gps')
  async ingest(@Body(new ZodValidationPipe(gpsTelemetrySchema)) body: GpsTelemetryInput, @Req() req: Request) {
    const device = req.device!;
    return this.gpsService.ingest(device, body);
  }
}
