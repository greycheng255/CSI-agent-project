import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MCPAppCapabilityType {
  WORKFLOW = 'workflow',
  MODEL = 'model',
  SKILL = 'skill',
}

@Entity('mcp_app_capabilities')
@Index('idx_mcp_app_capabilities_app_type_code', ['appId', 'capabilityType', 'code'], {
  unique: true,
})
export class MCPAppCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'app_id', type: 'uuid' })
  appId: string;

  @Column({ name: 'capability_type', type: 'varchar' })
  capabilityType: MCPAppCapabilityType;

  @Column({ type: 'varchar' })
  code: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'schema_json',
    type: 'jsonb',
    nullable: true,
  })
  schemaJson: Record<string, unknown> | null;

  @Column({
    name: 'raw_json',
    type: 'jsonb',
    nullable: true,
  })
  rawJson: Record<string, unknown> | null;

  @Column({ type: 'bool', default: true })
  enabled: boolean;

  @Column({
    name: 'last_synced_at',
    type: 'timestamp',
    nullable: true,
  })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
