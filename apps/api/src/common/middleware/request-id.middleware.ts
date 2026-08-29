import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

// The ambient-namespace-augmentation pattern is how @types/express itself
// (and the wider ecosystem — passport, multer, etc.) extends Request; there
// is no ES2015-module equivalent for augmenting a third-party global.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/**
 * Assigns a correlation ID to every request — reused from an inbound
 * X-Request-Id header when a caller (e.g. the web app, or another internal
 * service) already set one, otherwise generated fresh. Runs before the HTTP
 * logger so every log line for a request shares this ID, and the global
 * exception filter includes it in every error response. See
 * docs/architecture.md#3-cross-cutting-concerns and docs/api.md#1-conventions.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers[HEADER];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
