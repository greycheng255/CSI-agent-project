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

  async syncUser(user: User, plainPassword?: string): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const body = {
        owner: this.org,
        type: 'normal-user',
        name: user.phone,
        displayName: user.displayName || user.phone,
        // 注册时同步用户真实密码，使 Casdoor SSO 与平台密码一致；
        // 缺省回退初始密码（存量导入口径）
        password: plainPassword || this.initialPassword,
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
        // 存量账号：补一次密码对齐（注册密码可能晚于导入）
        if (plainPassword) {
          await this.syncPasswordHash(user);
        }
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

  /**
   * 平台改密后同步 Casdoor 密码（SSO 口径一致性）。
   * 通过 update-user API 写入平台 bcrypt hash：Casdoor UpdateUser 原样保存 password 字段，
   * 登录时 bcrypt.compare(输入, hash) 直接兼容（$2a$/$2b$ 前缀均可）。
   * 失败只记日志，不阻断平台改密主流程。
   */
  async syncPasswordHash(user: User): Promise<void> {
    if (!this.isConfigured() || !user.passwordHash || !user.phone) return;
    try {
      const id = `${this.org}/${user.phone}`;
      // 1. 拉取现有用户对象（update-user 为全量覆盖，需基于最新对象改字段）
      const getRes = await fetch(
        `${this.endpoint}/api/get-user?id=${encodeURIComponent(id)}`,
        { headers: { Authorization: this.basicAuth } },
      );
      const getJson = (await getRes.json()) as {
        status?: string;
        msg?: string;
        data?: Record<string, unknown> | null;
      };
      if (getJson.status !== 'ok' || !getJson.data) {
        this.logger.warn(
          `casdoor password sync skipped (user missing): ${id} -> ${String(getJson.msg ?? '')}`,
        );
        return;
      }
      // 2. 仅改 password，其余字段原样保留
      const payload = {
        ...getJson.data,
        password: user.passwordHash,
      };
      const res = await fetch(
        `${this.endpoint}/api/update-user?id=${encodeURIComponent(id)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.basicAuth,
          },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json()) as {
        status?: string;
        msg?: string;
        data?: unknown;
      };
      if (json.status === 'ok' && (json.data === true || json.data === 'Affected')) {
        this.logger.log(`casdoor password synced: ${id}`);
      } else {
        this.logger.error(
          `casdoor password sync failed: ${id} -> ${String(json.msg ?? json.data)}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `casdoor password sync error: ${user.phone} -> ${String(
          (err as Error).message,
        )}`,
      );
    }
  }
}
