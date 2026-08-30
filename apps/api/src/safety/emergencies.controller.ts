import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  triggerEmergencySchema,
  addEmergencyActionSchema,
  resolveEmergencySchema,
  cancelEmergencySchema,
  listEmergenciesQuerySchema,
  type TriggerEmergencyInput,
  type AddEmergencyActionInput,
  type ResolveEmergencyInput,
  type CancelEmergencyInput,
  type ListEmergenciesQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { EmergenciesService } from './emergencies.service';

/**
 * Staff-only. `POST /emergencies` (the button) is gated by `emergency.create`
 * — held by DRIVER/BUS_ATTENDANT (own trip/bus only, enforced in
 * EmergenciesService) and by every school-operational staff role (any
 * bus/trip in their own tenant, or none at all). Every lifecycle transition
 * requires `emergency.manage`, which DRIVER/BUS_ATTENDANT never hold — see
 * docs/adr/0019-safety-events-and-emergency-management.md for why a driver
 * who triggers an emergency does not also get to acknowledge/resolve it.
 */
@RequireAudience('STAFF')
@Controller('emergencies')
export class EmergenciesController {
  constructor(private readonly emergenciesService: EmergenciesService) {}

  @RequirePermission('emergency.read')
  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listEmergenciesQuerySchema)) query: ListEmergenciesQuery) {
    return this.emergenciesService.list(principal, query);
  }

  @RequirePermission('emergency.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.emergenciesService.get(principal, id);
  }

  @RequirePermission('emergency.create')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(triggerEmergencySchema)) body: TriggerEmergencyInput,
    @Req() req: Request,
  ) {
    return this.emergenciesService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('emergency.manage')
  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  async acknowledge(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.emergenciesService.acknowledge(principal, id, this.metaFrom(req));
  }

  @RequirePermission('emergency.manage')
  @Post(':id/actions')
  async addAction(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addEmergencyActionSchema)) body: AddEmergencyActionInput,
    @Req() req: Request,
  ) {
    return this.emergenciesService.addAction(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('emergency.manage')
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveEmergencySchema)) body: ResolveEmergencyInput,
    @Req() req: Request,
  ) {
    return this.emergenciesService.resolve(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('emergency.manage')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelEmergencySchema)) body: CancelEmergencyInput,
    @Req() req: Request,
  ) {
    return this.emergenciesService.cancel(principal, id, body, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
