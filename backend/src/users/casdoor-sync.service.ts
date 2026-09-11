import { Injectable, Logger } from '@nestjs/common';
import { User } from './entities/user.entity';

/**
 * 新注册用户 → Casdoor 增量同步。
 * - 与存量导入口径一致：name=手机号；email 缺省用占位；phone 置空（Casdoor 校验绕不过），
 *   原 phone 落 property.genesis_phone；计费主体键 org_id 落 property.org_id。
 * - 未配置 CASDOOR_ENDPOINT 时静默跳过（本地/测试环境无 Casdoor）。
 * - 同步失败只记日志，绝不阻断平台注册主流程；"already exist" 视为已同步（幂等）。
 */
@Injectable()
export class CasdoorSyncService {
  private readonly logger = new Logger(CasdoorSyncService.name);

  private get endpoint(): string {
    return process.env.CASDOOR_ENDPOINT?.trim().replace(/\/$/, '') ?? '';
  }
  private get org(): string {
    return process.env.CASDOOR_ORG?.trim() || 'csi';
  }
  private get basicAuth(): string {
    const id = process.env.CASDOOR_CLIENT_ID?.trim() ?? '';
    const secret = process.env.CASDOOR_CLIENT_SECRET?.trim() ?? '';
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }
  private get initialPassword(): string {
    return process.env.CASDOOR_INITIAL_PASSWORD?.trim() || 'Csi#2026Genesis';
  }

  isConfigured(): boolean {
    const id = process.env.CASDOOR_CLIENT_ID?.trim() ?? '';
    const secret = process.env.CASDOOR_CLIENT_SECRET?.trim() ?? '';
    return !!(this.endpoint && id && secret);
  }

  async syncUser(user: User): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const body = {
        owner: this.org,
        type: 'normal-user',
        name: user.phone,
        displayName: user.displayName || user.phone,
        password: this.initialPassword,
        // 平台手机号注册通常无 email；Casdoor email 需非空，用占位域名兜底
        email: user.email || `${user.id.slice(0, 12)}@noop.csi.shopping`,
        phone: '',
        region: '',
        // 注意：Casdoor 4.3.0 的字段名是 properties（复数）；property（单数）会被 API 静默丢弃
        properties: {
          org_id: user.orgId ?? '',
          genesis_user_id: user.id,
          genesis_phone: user.phone ?? '',
        },
        signupApplication: 'genesis-console',
        isConfirmed: true,
      };
      const res = await fetch(`${this.endpoint}/api/add-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.basicAuth,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { status?: string; msg?: string };
      if (json.status === 'ok') {
        this.logger.log(
          `casdoor user synced: ${user.phone} -> ${this.org}/${user.phone}`,
        );
      } else if (String(json.msg ?? '').includes('already exist')) {
        this.logger.log(
          `casdoor user already exists (skip): ${this.org}/${user.phone}`,
        );
      } else {
        this.logger.error(
          `casdoor user sync failed: ${user.phone} -> ${String(json.msg)}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `casdoor user sync error: ${user.phone} -> ${String(
          (err as Error).message,
        )}`,
      );
    }
  }
}
