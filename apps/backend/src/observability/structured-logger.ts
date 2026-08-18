import {
  ConsoleLogger,
  type LoggerService,
  type LogLevel,
} from '@nestjs/common';
import { currentContext } from './request-context';

/**
 * Fields that must never reach the log, even if someone includes them
 * without thinking. Matched by substring and case-insensitively, to catch
 * variations like `jwtSecret`, `steam_api_key` or `sharedSecret`.
 */
const SECRETS = [
  'senha',
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
];

/**
 * JSON logging, with the request identifier on every line.
 *
 * Plain text forces you to read line by line; in JSON you can filter by
 * user, by request or by level — which is what you want at two in the
 * morning with someone complaining.
 *
 * It does not replace the audit trail: this is for debugging technical
 * problems and disappears when the container restarts. What answers "what
 * happened to this person" is the AuditLog, which lives in the database
 * and cannot be altered.
 */
export class StructuredLogger implements LoggerService {
  private readonly console = new ConsoleLogger();

  constructor(private readonly json: boolean) {}

  log(message: unknown, context?: string): void {
    this.emit('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.emit('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context);
  }

  private emit(
    level: LogLevel | 'info',
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    if (!this.json) {
      // In development, readability beats structure.
      this.console.setContext(context ?? 'App');
      const ctx = currentContext();
      const prefix = ctx ? `[${ctx.requestId.slice(0, 8)}] ` : '';
      const text = `${prefix}${this.text(message)}`;

      if (level === 'error') this.console.error(text, trace);
      else if (level === 'warn') this.console.warn(text);
      else if (level === 'debug') this.console.debug(text);
      else this.console.log(text);

      return;
    }

    const ctx = currentContext();

    const line = {
      ts: new Date().toISOString(),
      level,
      ctx: context,
      msg: this.text(message),
      requestId: ctx?.requestId,
      userId: ctx?.userId,
      ip: ctx?.ip,
      method: ctx?.method,
      path: ctx?.path,
      trace,
    };

    // One line per event: the shape log aggregators expect.
    process.stdout.write(`${JSON.stringify(sanitize(line))}\n`);
  }

  private text(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof Error) return message.message;

    try {
      return JSON.stringify(sanitize(message));
    } catch {
      return '[unserializable message]';
    }
  }
}

/**
 * Drops empty fields and masks whatever looks like a secret.
 *
 * The mask is a safety net, not permission to log credentials: the right
 * thing is still not to pass them along. But dumping a whole object into
 * an error log is a common accident, and the cost of guarding is low.
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) {
    return value ?? undefined;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, depth + 1));
  }

  if (typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};

  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) {
      continue;
    }

    const name = key.toLowerCase();

    if (SECRETS.some((s) => name.includes(s))) {
      out[key] = '[hidden]';
      continue;
    }

    out[key] = sanitize(v, depth + 1);
  }

  return out;
}
