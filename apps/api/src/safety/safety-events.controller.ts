import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createSafetyEventSchema,
  dismissSafetyEventSchema,
  resolveSafetyEventSchema,
  listSafetyEventsQuerySchema,
  type CreateSafetyEventInput,
  type DismissSafetyEventInput,
  type ResolveSafetyEventInput,
  type ListSafetyEventsQuery,
} from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireAudience } from '../auth/decorators/require-audience.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/types/principal';
import { SafetyEventsService } from './safety-events.service';

/**
 * Staff-only (`@RequireAudience('STAFF')`) — there is no parent audience on
 * this controller at all, by design (docs/privacy.md). `POST /safety-events`
 * is gated by the narrowest permission that every eligible role holds
 * (`safety_events.create` — DRIVER/BUS_ATTENDANT hold only this;
 * SCHOOL_ADMIN/PRINCIPAL/TRANSPORT_ADMIN/TRANSPORT_MANAGER hold this and
 * more), with the real authorization ("full tenant-wide creation" vs.
 * "own currently-assigned trip/bus only") resolved inside
 * SafetyEventsService — the identical pattern TripsController already uses
 * for `/start`/`/complete` (see that controller's own docstring). Every
 * triage transition (acknowledge/dismiss/escalate/resolve) requires the
 * stronger `safety_events.manage`, which DRIVER/BUS_ATTENDANT never hold.
 */
@RequireAudience('STAFF')
@Controller('safety-events')
export class SafetyEventsController {
  constructor(private readonly safetyEventsService: SafetyEventsService) {}

  @RequirePermission('safety_events.read')
  @Get()
  async list(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Query(new ZodValidationPipe(listSafetyEventsQuerySchema)) query: ListSafetyEventsQuery) {
    return this.safetyEventsService.list(principal, query);
  }

  @RequirePermission('safety_events.read')
  @Get(':id')
  async get(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string) {
    return this.safetyEventsService.get(principal, id);
  }

  @RequirePermission('safety_events.create')
  @Post()
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(createSafetyEventSchema)) body: CreateSafetyEventInput,
    @Req() req: Request,
  ) {
    return this.safetyEventsService.create(principal, body, this.metaFrom(req));
  }

  @RequirePermission('safety_events.manage')
  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  async acknowledge(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.safetyEventsService.acknowledge(principal, id, this.metaFrom(req));
  }

  @RequirePermission('safety_events.manage')
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dismissSafetyEventSchema)) body: DismissSafetyEventInput,
    @Req() req: Request,
  ) {
    return this.safetyEventsService.dismiss(principal, id, body, this.metaFrom(req));
  }

  @RequirePermission('safety_events.manage')
  @Post(':id/escalate')
  @HttpCode(HttpStatus.OK)
  async escalate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Param('id') id: string, @Req() req: Request) {
    return this.safetyEventsService.escalate(principal, id, this.metaFrom(req));
  }

  @RequirePermission('safety_events.manage')
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveSafetyEventSchema)) body: ResolveSafetyEventInput,
    @Req() req: Request,
  ) {
    return this.safetyEventsService.resolve(principal, id, body, this.metaFrom(req));
  }

  private metaFrom(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
  }
}
