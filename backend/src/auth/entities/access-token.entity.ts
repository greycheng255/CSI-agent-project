import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

const isSqlite = process.env.DB_TYPE === 'sqlite';

@Entity('access_tokens')
export class AccessToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash: string;

  @Column({
    name: 'expires_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({
    name: 'revoked_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  revokedAt: Date | null;

  @Column({
    name: 'last_used_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
