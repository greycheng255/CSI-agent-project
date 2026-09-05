import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { AccessToken } from './entities/access-token.entity';
import { User } from '../users/entities/user.entity';

export type IssueTokenOptions = {
  name?: string | null;
  clientId?: string | null;
  expiresAt?: Date | null;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AccessToken)
    private accessTokensRepository: Repository<AccessToken>,
  ) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueUserToken(user: User, options: IssueTokenOptions = {}) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);

    await this.accessTokensRepository.save(
      this.accessTokensRepository.create({
        user,
        tokenHash,
        name: options.name ?? null,
        clientId: options.clientId ?? null,
        expiresAt: options.expiresAt ?? null,
        revokedAt: null,
        lastUsedAt: null,
      }),
    );

    return token;
  }

  /**
   * 签发个人访问令牌（PAT），供 CLI / Agent 等无人值守场景使用
   */
  async issuePersonalAccessToken(
    user: User,
    name: string,
    expiresInDays?: number,
  ) {
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const token = await this.issueUserToken(user, {
      name,
      clientId: 'pat',
      expiresAt,
    });

    return { token, expiresAt };
  }

  /** 列出当前用户的 PAT 元数据（不含 token 值） */
  async listPersonalAccessTokens(userId: string) {
    return this.accessTokensRepository.find({
      where: { user: { id: userId }, clientId: 'pat' },
      order: { createdAt: 'DESC' },
    });
  }

  /** 撤销指定 PAT（仅限本人） */
  async revokePersonalAccessToken(userId: string, tokenId: string) {
    const row = await this.accessTokensRepository.findOne({
      where: { id: tokenId, user: { id: userId }, clientId: 'pat' },
    });
    if (!row || row.revokedAt) return false;
    row.revokedAt = new Date();
    await this.accessTokensRepository.save(row);
    return true;
  }

  /**
   * SSO 单点登出：撤销用户全部有效令牌；
   * 传入 clientId 时仅撤销该接入方签发的令牌。
   * 全局登出不动 PAT（clientId 为 'pat'），避免误伤无人值守客户端。
   */
  async revokeAllUserTokens(userId: string, clientId?: string) {
    const now = new Date();
    const rows = await this.accessTokensRepository.find({
      where: [
        { user: { id: userId }, revokedAt: IsNull() },
      ],
    });

    const targets = rows.filter((row) => {
      if (row.revokedAt) return false;
      if (clientId) return row.clientId === clientId;
      return row.clientId !== 'pat';
    });

    for (const row of targets) {
      row.revokedAt = now;
    }
    if (targets.length > 0) {
      await this.accessTokensRepository.save(targets);
    }
    return targets.length;
  }

  async revokeToken(token: string) {
    const tokenHash = this.hashToken(token);
    const row = await this.accessTokensRepository.findOne({
      where: { tokenHash },
      relations: ['user'],
    });
    if (!row || row.revokedAt) return;
    row.revokedAt = new Date();
    await this.accessTokensRepository.save(row);
  }

  async validateUserToken(token: string) {
    const tokenHash = this.hashToken(token);
    const row = await this.accessTokensRepository.findOne({
      where: { tokenHash },
      relations: ['user'],
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

    row.lastUsedAt = new Date();
    await this.accessTokensRepository.save(row);
    return row.user || null;
  }
}
