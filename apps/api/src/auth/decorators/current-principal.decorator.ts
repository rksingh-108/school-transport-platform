import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../types/principal';

/** `@CurrentPrincipal() principal: AuthenticatedPrincipal` in a controller method. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.principal) {
    throw new Error('CurrentPrincipal used on a route without JwtAuthGuard — request.principal is not set.');
  }
  return request.principal;
});
