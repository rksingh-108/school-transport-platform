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
    this.emit('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.emit('error', message, context, trace);
  }

  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.emit('trace', message, context);
  }

  /**
   * A non-string `message` is spread into the log record's own top-level
   * fields (not pre-serialized into the `msg` string) — pino's `redact`
   * config above only inspects the structured record, never substrings
   * inside an already-stringified message. Serializing first (the previous
   * implementation) silently defeated every redact path for any call site
   * that ever logs an object; this keeps that safety net actually able to
   * fire if one does.
   */
  private emit(level: 'info' | 'warn' | 'error' | 'debug' | 'trace', message: unknown, context?: string, trace?: string): void {
    if (typeof message === 'string') {
      this.logger[level]({ context, trace }, message);
    } else {
      this.logger[level]({ ...(message as object), context, trace }, '');
    }
  }
}
