import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { edgeAiHeartbeatSchema, submitAiObservationSchema, type EdgeAiHeartbeatInput, type SubmitAiObservationInput } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { AiObservationsService } from './ai-observations.service';
import { EdgeAiDeviceAuthGuard } from './guards/edge-ai-device-auth.guard';

// Same rationale/shape as GPS_INGEST_THROTTLE/CAMERA_HEARTBEAT_THROTTLE:
// decorator metadata is evaluated before ConfigService exists, so this reads
// process.env directly.
const AI_OBSERVATION_INGEST_THROTTLE = {
  default: { limit: Number(process.env['AI_OBSERVATION_INGEST_RATE_LIMIT_PER_MINUTE'] ?? 120), ttl: 60_000 },
};
const AI_EDGE_HEARTBEAT_THROTTLE = {
  default: { limit: Number(process.env['AI_EDGE_HEARTBEAT_RATE_LIMIT_PER_MINUTE'] ?? 20), ttl: 60_000 },
};

/**
 * The device-facing edge-AI boundary (Phase 3 Step 14). `@Public()` so the
 * global JwtAuthGuard no-ops here — authenticated only by
 * EdgeAiDeviceAuthGuard (an opaque device bearer credential), never a
 * staff/parent access token. No `schoolId`/`busId`/`tripId`/`edgeDeviceId`
 * field exists on either payload — identity is always resolved server-side
 * from the authenticated device credential, the same IDOR-by-construction
 * pattern as GPS ingestion and camera heartbeats. See
 * docs/adr/0021-edge-ai-computer-vision-pipeline-foundation.md.
 */
@Public()
@UseGuards(EdgeAiDeviceAuthGuard)
@Controller('edge-ai')
export class EdgeAiController {
  constructor(private readonly aiObservationsService: AiObservationsService) {}

  @Throttle(AI_OBSERVATION_INGEST_THROTTLE)
  @Post('observations')
  async submit(@Body(new ZodValidationPipe(submitAiObservationSchema)) body: SubmitAiObservationInput, @Req() req: Request) {
    const device = req.edgeAiDevice!;
    return this.aiObservationsService.ingest(device, body);
  }

  @Throttle(AI_EDGE_HEARTBEAT_THROTTLE)
  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Body(new ZodValidationPipe(edgeAiHeartbeatSchema)) body: EdgeAiHeartbeatInput, @Req() req: Request) {
    const device = req.edgeAiDevice!;
    await this.aiObservationsService.heartbeat(device, body);
    return { ok: true };
  }
}
