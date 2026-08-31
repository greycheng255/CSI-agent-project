import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isTimestampFresh, parseSignature, verifySignature } from './hmac-sign';

const MAX_DRIFT_SECONDS = 300;

/**
 * HMAC-SHA256 服务级签名守卫（对接指南 §3.1）。
 * 校验顺序：Bearer 比对 → timestamp 偏差 → HMAC-SHA256(body 原文 + ts) 重算。
 * 注意：body 原文优先取 req.rawBody（需上层 raw-body 捕获），否则退化用 JSON 序列化。
 */
@Injectable()
export class HmacGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = process.env.LONGTASK_SERVICE_TOKEN;
    if (!secret) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    }

    const bearer = (req.headers?.['authorization'] ?? '') as string;
    const token = bearer.replace(/^Bearer\s+/i, '').trim();
    if (token !== secret) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID');
    }

    const sig = parseSignature(req.headers?.['x-signature']);
    if (!sig) {
      throw new UnauthorizedException('AUTH_HMAC_SIGNATURE_MISMATCH');
    }

    if (
      !isTimestampFresh(
        sig.ts,
        Math.floor(Date.now() / 1000),
        MAX_DRIFT_SECONDS,
      )
    ) {
      throw new UnauthorizedException('AUTH_TIMESTAMP_EXPIRED');
    }

    const raw =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : JSON.stringify(req.body ?? {});
    if (!verifySignature(raw, sig.ts, sig.v1, secret)) {
      throw new UnauthorizedException('AUTH_HMAC_SIGNATURE_MISMATCH');
    }

    return true;
  }
}