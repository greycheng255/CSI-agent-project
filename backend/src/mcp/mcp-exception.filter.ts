import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class MCPExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus?.() || HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json({
      jsonrpc: '2.0',
      error: {
        code: exception instanceof UnauthorizedException ? 'UNAUTHORIZED' : 'INVALID_PARAMS',
        message: exception.message,
      },
      id: this.requestId(request),
    });
  }

  private requestId(request: Request) {
    const body = request.body as { id?: string | number | null } | undefined;
    return body?.id ?? null;
  }
}
