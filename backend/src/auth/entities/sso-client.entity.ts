import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * SSO 接入方（OAuth2 Client）
 * redirectUris 存 JSON 数组字符串；secret 为空表示公开客户端（仅允许 PKCE）
 */
@Entity('sso_clients')
export class SsoClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'text', unique: true })
  clientId: string;

  @Column({ name: 'client_secret_hash', type: 'text', nullable: true })
  clientSecretHash: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'redirect_uris', type: 'text', default: '[]' })
  redirectUris: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  getRedirectUris(): string[] {
    try {
      const parsed = JSON.parse(this.redirectUris);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
