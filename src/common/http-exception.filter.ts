import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

// Every hand-written endpoint in this API returns {status, message, data?} -
// this makes thrown/unhandled errors match that same envelope instead of
// Nest's default {statusCode, message, error} shape.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : undefined;
    const message =
      typeof body === 'string'
        ? body
        : ((body as { message?: string | string[] })?.message ?? (exception as Error)?.message ?? 'Internal server error');

    if (!isHttp) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    res.status(statusCode).json({ status: false, message: Array.isArray(message) ? message.join(', ') : message });
  }
}
