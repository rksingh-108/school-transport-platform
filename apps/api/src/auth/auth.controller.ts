import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  staffLoginSchema,
  parentLoginSchema,
  changePasswordSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  type StaffLoginInput,
  type ParentLoginInput,
  type ChangePasswordInput,
  type PasswordResetRequestInput,
  type PasswordResetConfirmInput,
} from '@school-transport/shared-schemas';
import type { AuthPrincipalType } from '@prisma/client';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { Env } from '../config/env.schema';
import { AuthService, type RequestMeta } from './services/auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from './types/principal';

const STAFF_COOKIE = 'staff_refresh_token';
const PARENT_COOKIE = 'parent_refresh_token';
const COOKIE_PATH = '/api/v1/auth';

// Tighter than the app-wide default (100/min) for endpoints that are
// meaningfully abusable — credential guessing, refresh-token grinding,
// password-reset spam. See docs/security.md#8-rate-limiting. Tuned to not
// block a school's normal staff logging in each morning; revisit with real
// traffic data before launch.
const SENSITIVE_AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Throttle(SENSITIVE_AUTH_THROTTLE)
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  async staffLogin(
    @Body(new ZodValidationPipe(staffLoginSchema)) body: StaffLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginStaff(body.email, body.password, this.metaFrom(req));
    if (result.status === 'MFA_REQUIRED') {
      return { status: 'MFA_REQUIRED' as const };
    }
    this.setRefreshCookie(res, 'STAFF', result.refreshTokenRaw, result.refreshTokenExpiresAt);
    return {
      status: 'OK' as const,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      principal: result.principal,
    };
  }

  @Public()
  @Throttle(SENSITIVE_AUTH_THROTTLE)
  @Post('parent/login')
  @HttpCode(HttpStatus.OK)
  async parentLogin(
    @Body(new ZodValidationPipe(parentLoginSchema)) body: ParentLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginParent(body.phone, body.password, this.metaFrom(req));
    if (result.status === 'MFA_REQUIRED') {
      return { status: 'MFA_REQUIRED' as const };
    }
    this.setRefreshCookie(res, 'PARENT', result.refreshTokenRaw, result.refreshTokenExpiresAt);
    return {
      status: 'OK' as const,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      principal: result.principal,
    };
  }

  @Public()
  @Throttle(REFRESH_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[STAFF_COOKIE] ?? req.cookies?.[PARENT_COOKIE];
    if (!rawToken) {
      throw new UnauthorizedException('No refresh token present.');
    }

    const result = await this.authService.refresh(rawToken, this.metaFrom(req));
    this.setRefreshCookie(res, result.principal.type, result.refreshTokenRaw, result.refreshTokenExpiresAt);
    return {
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      principal: result.principal,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const staffToken = req.cookies?.[STAFF_COOKIE];
    const parentToken = req.cookies?.[PARENT_COOKIE];
    const rawToken = staffToken ?? parentToken;

    await this.authService.logout(rawToken, this.metaFrom(req));

    if (staffToken) this.clearRefreshCookie(res, 'STAFF');
    if (parentToken) this.clearRefreshCookie(res, 'PARENT');
    return { success: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(principal, this.metaFrom(req));
    this.clearRefreshCookie(res, principal.type);
    return { success: true };
  }

  @Get('me')
  async me(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.authService.buildMeResponse(principal.schoolId, principal.type, principal.id);
  }

  @Throttle(SENSITIVE_AUTH_THROTTLE)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ) {
    await this.authService.changePassword(principal, body.currentPassword, body.newPassword, this.metaFrom(req));
    return { success: true, message: 'Password changed. Please sign in again on all devices.' };
  }

  @Public()
  @Throttle(SENSITIVE_AUTH_THROTTLE)
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestInput,
    @Req() req: Request,
  ) {
    return this.authService.requestPasswordReset(body.audience as AuthPrincipalType, body.identifier, this.metaFrom(req));
  }

  @Public()
  @Throttle(SENSITIVE_AUTH_THROTTLE)
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirmInput,
    @Req() req: Request,
  ) {
    await this.authService.confirmPasswordReset(body.token, body.newPassword, this.metaFrom(req));
    return { success: true, message: 'Password reset. Please sign in with your new password.' };
  }

  private metaFrom(req: Request): RequestMeta {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    };
  }

  private setRefreshCookie(res: Response, audience: AuthPrincipalType, raw: string, expiresAt: Date) {
    res.cookie(audience === 'STAFF' ? STAFF_COOKIE : PARENT_COOKIE, raw, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(res: Response, audience: AuthPrincipalType) {
    res.clearCookie(audience === 'STAFF' ? STAFF_COOKIE : PARENT_COOKIE, { path: COOKIE_PATH });
  }
}
