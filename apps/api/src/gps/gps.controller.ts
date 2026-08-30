import { Controller, Get, Param, Query } from '@nestjs/common';
import { gpsHistoryQuerySchema, type GpsHistoryQuery } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { GpsService } from './gps.service';

/**
 * Staff-facing GPS reads (Phase 1 Step 7) — current location, fleet
 * overview, and bounded history. All gated by the existing `gps.read`
 * permission (no new permission introduced); DRIVER/BUS_ATTENDANT are
 * scoped to their own currently-assigned bus inside GpsService, matching
 * docs/security.md §2.3's "own bus only" row. Nested under `buses/`/`trips/`
 * for the per-resource reads (same cross-module nested-route convention as
 * TripStudentsController living in the trips module) and under `gps/` for
 * the fleet-wide overview, which belongs to neither.
 */
@RequireAudience('STAFF')
@RequirePermission('gps.read')
@Controller()
export class GpsController {
  constructor(private readonly gpsService: GpsService) {}

  @Get('gps/fleet')
  async fleet(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.gpsService.getFleetLocations(principal);
  }

  @Get('buses/:busId/location')
  async currentLocation(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('busId') busId: string) {
    return this.gpsService.getCurrentLocation(principal, busId);
  }

  @Get('buses/:busId/telemetry')
  async busHistory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('busId') busId: string,
    @Query(new ZodValidationPipe(gpsHistoryQuerySchema)) query: GpsHistoryQuery,
  ) {
    return this.gpsService.getBusHistory(principal, busId, query);
  }

  @Get('trips/:tripId/telemetry')
  async tripHistory(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tripId') tripId: string,
    @Query(new ZodValidationPipe(gpsHistoryQuerySchema)) query: GpsHistoryQuery,
  ) {
    return this.gpsService.getTripHistory(principal, tripId, query);
  }
}
