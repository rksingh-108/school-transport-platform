import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createCameraSchema,
  updateCameraSchema,
  listCamerasQuerySchema,
  type CreateCameraInput,
  type UpdateCameraInput,
  type ListCamerasQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { CamerasService } from './cameras.service';

/**
 * Two route shapes — `/buses/:busId/cameras` (nested, bus-scoped list/
 * create) and `/cameras/:id` (flat, addressed by the camera's own id, plus
 * a school-wide `/cameras` list) — same pattern as BusDevicesController.
 * Gated by `camera.read`/`camera.manage`, never `buses.read`/`buses.manage`
 * — cameras are a deliberately narrower-access domain than generic fleet
 * devices (see docs/adr/0018-camera-device-management-foundation.md and
 * packages/shared-types/src/rbac.ts: DRIVER/BUS_ATTENDANT are never granted
 * either camera permission, unlike buses.read).
 *
 * Parents have no access to any route on this controller — there is no
 * parent-audience camera endpoint anywhere in this codebase, by design.
 */
@RequireAudience('STAFF')
@Controller()
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @RequirePermission('camera.read')
  @Get('buses/:busId/cameras')
  async listForBus(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('busId') busId: string) {
    return this.camerasService.listForBus(principal, busId);
  }

  @RequirePermission('camera.manage')
  @Post('buses/:busId/cameras')
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('busId') busId: string,
    @Body(new ZodValidationPipe(createCameraSchema)) body: CreateCameraInput,
    @Req() req: Request,
  ) {
    return this.camerasService.create(principal, busId, body, this.metaFrom(req));
  }

  @RequirePermission('camera.read')
  @Get('cameras')
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listCamerasQuerySchema)) query: ListCamerasQuery) {
    return this.camerasService.list(principal, query);
  }

  @RequirePermission('camera.read')
  @Get('cameras/:id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.camerasService.get(principal, id);
  }

  @RequirePermission('camera.manage')
  @Patch('cameras/:id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCameraSchema)) body: UpdateCameraInput,
    @Req() req: Request,
  ) {
    return this.camerasService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('camera.manage')
  @Post('cameras/:id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.camerasService.archive(principal, id, this.metaFrom(req));
  }

  /**
   * Issues/rotates this camera's device heartbeat credential. The response
   * is the only place the raw token is ever returned — see
   * BusDevicesService.rotateCredential.
   */
  @RequirePermission('camera.manage')
  @Post('cameras/:id/credential')
  @HttpCode(HttpStatus.OK)
  async rotateCredential(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.camerasService.rotateCredential(principal, id, this.metaFrom(req));
  }

  /**
   * Never returns a real playback URL, vendor token, or raw stream
   * credential — see docs/adr/0018-camera-device-management-foundation.md.
   * Gated by the same `camera.read` as viewing camera details: this phase
   * never returns anything more sensitive than "not configured"/"simulated".
   */
  @RequirePermission('camera.read')
  @Get('cameras/:id/stream')
  async getStream(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.camerasService.getStreamAvailability(principal, id);
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
