import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring a valid access token. Used ONLY for the
 * handful of auth endpoints that inherently can't require one yet (login,
 * refresh — which validates its own opaque refresh cookie instead — and
 * password-reset request/confirm). Every other endpoint in the application
 * is authenticated by default; this is an opt-out, not the default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
