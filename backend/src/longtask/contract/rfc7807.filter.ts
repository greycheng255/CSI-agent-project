import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ContractError } from './errors';

/**
 * RFC 7807 错误过滤器（对接指南 §3.1）：
 * type/title/status/detail/instance/request_id/error_code/details/retry_after_seconds
 */
@Catch(ContractError)
export class Rfc7807Filter implements ExceptionFilter {
  catch(exception: ContractError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body: Record<string, unknown> = {
      type: 'about:blank',
      title: exception.message,
      status: exception.status,
      detail: exception.message,
      instance: request.url,
      request_id: request.headers['x-request-id'] ?? null,
      error_code: exception.errorCode,
    };
    if (exception.details !== undefined) body.details = exception.details;
    if (exception.retryAfterSeconds !== undefined) {
      body.retry_after_seconds = exception.retryAfterSeconds;
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    response.status(exception.status).json(body);
  }
}