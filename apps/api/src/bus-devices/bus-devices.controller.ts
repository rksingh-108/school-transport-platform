import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createDeviceSchema,
  updateDeviceSchema,
  type CreateDeviceInput,
  type UpdateDeviceInput,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { BusDevicesService } from './bus-devices.service';

/**
 * Two route shapes on one controller — `/buses/:busId/devices` (nested,
 * bus-scoped list/create) and `/devices/:id` (flat, addressed by the
 * device's own id) — same pattern as ParentStudentLinksController in the
 * school/student/parent domain. Device operations are gated by
 * `buses.read`/`buses.manage` rather than a separate `devices.*`
 * permission: a device has no lifecycle independent of the bus it's
 * attached to (see docs/security.md#device-authorization).
 */
@RequireAudience('STAFF')
@Controller()
export class BusDevicesController {
  constructor(private readonly busDevicesService: BusDevicesService) {}

  @RequirePermission('buses.read')
  @Get('buses/:busId/devices')
  async listForBus(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('busId') busId: string) {
    return this.busDevicesService.listForBus(principal, busId);
  }

  @RequirePermission('buses.manage')
  @Post('buses/:busId/devices')
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('busId') busId: string,
    @Body(new ZodValidationPipe(createDeviceSchema)) body: CreateDeviceInput,
    @Req() req: Request,
  ) {
    return this.busDevicesService.create(principal, busId, body, this.metaFrom(req));
  }

  @RequirePermission('buses.read')
  @Get('devices/:id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.busDevicesService.get(principal, id);
  }

  @RequirePermission('buses.manage')
  @Patch('devices/:id')
  async update(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDeviceSchema)) body: UpdateDeviceInput,
    @Req() req: Request,
  ) {
    return this.busDevicesService.update(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('buses.manage')
  @Post('devices/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.busDevicesService.deactivate(principal, id, this.metaFrom(req));
  }

  /**
   * Issues/rotates this device's GPS-ingestion bearer credential (Phase 1
   * Step 7). Gated by `buses.manage` — same reasoning as every other device
   * lifecycle action on this controller (docs/security.md#5.2). The
   * response is the only place the raw token is ever returned.
   */
  @RequirePermission('buses.manage')
  @Post('devices/:id/credential')
  @HttpCode(HttpStatus.OK)
  async rotateCredential(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.busDevicesService.rotateCredential(principal, id, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
