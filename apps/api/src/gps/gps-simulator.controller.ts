import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { gpsTelemetrySchema, type GpsTelemetryInput } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { GpsService } from './gps.service';

/**
 * Development/test-only GPS simulator (Phase 1 Step 7, item 36 of the
 * spec) — lets a staff member push one synthetic telemetry fix for a bus
 * without real hardware, for manual verification and e2e tests. This is
 * NOT a production feature: `GpsService.simulateIngest` refuses outside
 * `NODE_ENV=development|test` regardless of who calls it, so this
 * controller staying wired up in a production build is inert, not a
 * security hole. Still gated by staff auth + `buses.manage` as defense in
 * depth, not as the primary safeguard.
 */
@RequireAudience('STAFF')
@RequirePermission('buses.manage')
@Controller('dev/gps-simulator')
export class GpsSimulatorController {
  constructor(private readonly gpsService: GpsService) {}

  @Post('buses/:busId/tick')
  @HttpCode(HttpStatus.OK)
  async tick(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('busId') busId: string,
    @Body(new ZodValidationPipe(gpsTelemetrySchema)) body: GpsTelemetryInput,
  ) {
    return this.gpsService.simulateIngest(principal, busId, body);
  }
}
