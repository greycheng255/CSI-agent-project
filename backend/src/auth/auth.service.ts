import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { AccessToken } from './entities/access-token.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AccessToken)
    private accessTokensRepository: Repository<AccessToken>,
  ) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueUserToken(user: User) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);

    await this.accessTokensRepository.save(
      this.accessTokensRepository.create({
        user,
        tokenHash,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      }),
    );

    return token;
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
