import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan } from 'typeorm';
import { deriveRawPayload, isTimestampFresh, parseSignature, verifySignature } from './hmac-sign';
import { HmacNonce } from './hmac-nonce.entity';

const MAX_DRIFT_SECONDS = 300;
/** nonce 保留时长：≥2×时间窗漂移（5min），窗口外时间戳已先被拒，无重放意义 */
const NONCE_TTL_MS = 10 * 60 * 1000;

/**
 * HMAC-SHA256 服务级签名守卫（对接指南 §3.1）。
 * 校验顺序：Bearer 比对 → timestamp 偏差 ≤ 5min → nonce 唯一 → HMAC-SHA256(body 原文 + ts) 重算。
 * 注意：payload 派生见 deriveRawPayload——rawBody 真原文优先（main.ts verify 捕获），
 * 无 body 请求（GET/DELETE）= 空串；仅当无 rawBody 且解析出的 JSON body 非空时才回退 re-serialization。
 * nonce 取通用请求头 X-Request-Id（§3.1），落 hmac_nonces 去重表防窗口内重放。
 */
@Injectable()
export class HmacGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // C→M 入站方向密钥（Console 清单 C2：按方向分离；未设时回落统一 token）
    const secret = process.env.LONGTASK_INBOUND_TOKEN ?? process.env.LONGTASK_SERVICE_TOKEN;
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

    // §3.1 第 3 步：nonce 唯一（X-Request-Id），重复请求视为重放
    const nonce = ((req.headers?.['x-request-id'] ?? '') as string).trim();
    if (!nonce || nonce.length > 64) {
      throw new UnauthorizedException('AUTH_NONCE_MISSING');
    }
    await this.claimNonce(nonce);

    const raw = deriveRawPayload({ rawBody: req.rawBody, body: req.body });
    if (!verifySignature(raw, sig.ts, sig.v1, secret)) {
      throw new UnauthorizedException('AUTH_HMAC_SIGNATURE_MISMATCH');
    }

    return true;
  }

  /** 先清理过期 nonce，再占位；主键冲突 = 同 nonce 重放 */
  private async claimNonce(nonce: string): Promise<void> {
    const repo = this.dataSource.getRepository(HmacNonce);
    await repo.delete({ expiresAt: LessThan(new Date()) });
    try {
      await repo.insert({
        nonce,
        expiresAt: new Date(Date.now() + NONCE_TTL_MS),
      });
    } catch (err) {
      if (HmacGuard.isUniqueViolation(err)) {
        throw new UnauthorizedException('AUTH_NONCE_DUPLICATE');
      }
      throw err;
    }
  }

  /** PG 23505 / SQLite SQLITE_CONSTRAINT 统一判定 */
  private static isUniqueViolation(err: unknown): boolean {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      return true;
    }
    return /unique constraint|duplicate key/i.test(
      String((err as Error | null)?.message ?? ''),
    );
  }
}
