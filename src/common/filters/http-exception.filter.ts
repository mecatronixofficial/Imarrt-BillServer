import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message } = this.mapException(exception);

    const responseMessage =
      typeof message === 'string' ? message : (message as any).message ?? message;
    const logMessage = `${request.method} ${request.url} -> ${status} ${this.formatMessage(responseMessage)}`;

    // Authentication failures and other expected client errors are concise
    // operational events. Only unexpected server failures need stack traces.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      this.logger.warn(logMessage);
    } else {
      this.logger.log(logMessage);
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message: responseMessage,
      requestId: (request as Request & { id?: string }).id,
    });
  }

  private mapException(exception: unknown): { status: number; message: unknown } {
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), message: exception.getResponse() };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { status: HttpStatus.CONFLICT, message: 'A record with these values already exists' };
      }
      if (exception.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
      }
      if (exception.code === 'P2003') {
        return { status: HttpStatus.CONFLICT, message: 'This record is still referenced by other data' };
      }
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }

  private formatMessage(message: unknown): string {
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return 'Request failed';
    }
  }
}
