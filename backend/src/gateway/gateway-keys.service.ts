import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractError } from '../longtask/contract/errors';
import { GatewayApiKey } from './gateway-key.entity';

/** 每个状态查询的 workspace 单活跃 key */
const ACTIVE = 'active';

function encryptionKey(): Buffer {
  const secret =
    process.env.LONGTASK_INBOUND_TOKEN ?? process.env.LONGTASK_SERVICE_TOKEN ?? 'csi-gateway-dev';
  return createHash('sha256').update(`${secret}|gateway-key-enc`).digest();
}

/** AES-256-GCM 加密（iv 12B + tag 16B + cipher），base64 单串存储 */
export function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptKey(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(buf.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}

export interface IssuedKey {
  key_id: string;
  workspace_id: string;
  key_prefix: string;
  key: string;
  existing: boolean;
  status: string;
}

@Injectable()
export class GatewayKeysService {
  constructor(
    @InjectRepository(GatewayApiKey)
    private readonly keysRepo: Repository<GatewayApiKey>,
  ) {}

  /**
   * K1 签发（幂等）：workspace 已有 active key → 解密原样返回（existing=true）；
   * 无则生成 `sk-csi-<base64url>`。明文仅此响应出现一次落 daemon 内存。
   */
  async issue(orgId: string, workspaceId: string): Promise<IssuedKey> {
    const existing = await this.keysRepo.findOne({
      where: { workspaceId, status: ACTIVE },
    });
    if (existing) {
      return {
        key_id: existing.keyId,
        workspace_id: existing.workspaceId,
        key_prefix: existing.keyPrefix,
        key: decryptKey(existing.keyCiphertext),
        existing: true,
        status: existing.status,
      };
    }
    const plain = `sk-csi-${randomBytes(24).toString('base64url')}`;
    const row = await this.keysRepo.save({
      orgId,
      workspaceId,
      keyId: `wk_${randomBytes(4).toString('hex')}`,
      keyPrefix: plain.slice(0, 12),
      keyHash: createHash('sha256').update(plain).digest('hex'),
      keyCiphertext: encryptKey(plain),
      status: ACTIVE,
    } as GatewayApiKey);
    return {
      key_id: row.keyId,
      workspace_id: row.workspaceId,
      key_prefix: row.keyPrefix,
      key: plain,
      existing: false,
      status: row.status,
    };
  }

  /** K4 轮换：新 key 上线、旧 key 置 rotated（daemon 24h 顺带轮换语义） */
  async rotate(keyId: string): Promise<IssuedKey> {
    const old = await this.keysRepo.findOne({ where: { keyId } });
    if (!old) throw new ContractError(404, 'NOT_FOUND', `key not found: ${keyId}`);
    if (old.status !== ACTIVE) {
      throw new ContractError(422, 'STATE_INVALID_TRANSITION', `key ${keyId} is ${old.status}`);
    }
    const plain = `sk-csi-${randomBytes(24).toString('base64url')}`;
    old.status = 'rotated';
    await this.keysRepo.save(old);
    const row = await this.keysRepo.save({
      orgId: old.orgId,
      workspaceId: old.workspaceId,
      keyId: `wk_${randomBytes(4).toString('hex')}`,
      keyPrefix: plain.slice(0, 12),
      keyHash: createHash('sha256').update(plain).digest('hex'),
      keyCiphertext: encryptKey(plain),
      status: ACTIVE,
      rotatedFromId: old.keyId,
    } as GatewayApiKey);
    return {
      key_id: row.keyId,
      workspace_id: row.workspaceId,
      key_prefix: row.keyPrefix,
      key: plain,
      existing: false,
      status: row.status,
    };
  }

  /** K3 吊销：销毁/滥用即时失效（daemon 401 后重取走 rotate 链路） */
  async revoke(keyId: string): Promise<{ key_id: string; status: string }> {
    const row = await this.keysRepo.findOne({ where: { keyId } });
    if (!row) throw new ContractError(404, 'NOT_FOUND', `key not found: ${keyId}`);
    if (row.status === ACTIVE) {
      row.status = 'revoked';
      row.revokedAt = new Date();
      await this.keysRepo.save(row);
    }
    return { key_id: row.keyId, status: row.status };
  }

  /**
   * K2 验签注入：daemon 本地代理用 key 换取 workspace/org 归集头
   * （TenantID=workspace_id 口径，计量归集键）。无效/吊销 → valid=false。
   */
  async validate(key: string): Promise<{
    valid: boolean;
    workspace_id?: string;
    org_id?: string;
    key_id?: string;
  }> {
    if (!key) return { valid: false };
    const row = await this.keysRepo.findOne({
      where: { keyHash: createHash('sha256').update(key).digest('hex') },
    });
    if (!row || row.status !== ACTIVE) return { valid: false };
    return {
      valid: true,
      workspace_id: row.workspaceId,
      org_id: row.orgId,
      key_id: row.keyId,
    };
  }

  async list(workspaceId: string): Promise<GatewayApiKey[]> {
    return this.keysRepo.find({
      where: { workspaceId },
      order: { issuedAt: 'DESC' },
    });
  }
}
