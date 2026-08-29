import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

/**
 * Structured JSON logging (pino) wired into Nest's LoggerService interface, so
 * `Logger.log/warn/error(...)` calls throughout the app produce structured
 * output instead of Nest's default pretty-printed console logger — required
 * for log aggregation in any real deployment. See
 * docs/architecture.md#3-cross-cutting-concerns.
 *
 * Never log secrets: the `redact` list below covers known-sensitive field
 * names per docs/security.md's logging rules. Call sites must still avoid
 * passing raw sensitive objects as log messages.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'password',
          'passwordHash',
          'password_hash',
          'token',
          'accessToken',
          'refreshToken',
          'mfaSecret',
          'mfa_secret_encrypted',
          '*.password',
          '*.passwordHash',
          '*.token',
        ],
        censor: '[REDACTED]',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
    });
  }

  log(message: unknown, context?: string) {
    this.logger.info({ context }, this.stringify(message));
  }

  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, this.stringify(message));
  }

  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, this.stringify(message));
  }

  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, this.stringify(message));
  }

  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, this.stringify(message));
  }

  private stringify(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}
