import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { acceptInvitationSchema, type AcceptInvitationInput } from '@school-transport/shared-schemas';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { InvitationsService } from './invitations.service';

/**
 * The one genuinely audience-agnostic invitation endpoint — accepting an
 * invite is neither a staff nor a parent action until AFTER it succeeds, so
 * it can't live under either audience's namespace. Every other invitation
 * action (issue, resend, revoke) is staff-permission-gated and lives on the
 * resource it creates (UsersController for staff, ParentsController for
 * parents) — see docs/api.md#invitations.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() req: Request,
  ) {
    const result = await this.invitationsService.accept(body.token, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    });
    return {
      success: true,
      principalType: result.principalType,
      message: 'Account activated. Please sign in with your new password.',
    };
  }
}
