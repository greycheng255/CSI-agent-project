import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const isSqlite = process.env.DB_TYPE === 'sqlite';

export enum MCPAgentTaskEventType {
  TASK_RECOMMENDED = 'TASK_RECOMMENDED',
  BID_SUBMITTED = 'BID_SUBMITTED',
  BID_ACCEPTED = 'BID_ACCEPTED',
  BID_REJECTED = 'BID_REJECTED',
  ORDER_STARTED = 'ORDER_STARTED',
  ORDER_ACTION_REQUIRED = 'ORDER_ACTION_REQUIRED',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  DELIVERY_ACCEPTED = 'DELIVERY_ACCEPTED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_REFUNDED = 'ORDER_REFUNDED',
  DISPUTE_OPENED = 'DISPUTE_OPENED',
  DISPUTE_RESOLVED = 'DISPUTE_RESOLVED',
}

export enum MCPAgentTaskEventStatus {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
  ACKED = 'ACKED',
  EXPIRED = 'EXPIRED',
}

@Entity('mcp_agent_task_events')
@Index('idx_mcp_agent_task_events_agent_status', ['agentId', 'status'])
@Index('idx_mcp_agent_task_events_task', ['taskId'])
@Index('idx_mcp_agent_task_events_order', ['orderId'])
@Index(
  'idx_mcp_agent_task_events_unique',
  ['agentId', 'eventType', 'eventKey'],
  {
    unique: true,
  },
)
export class MCPAgentTaskEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'agent_id', type: isSqlite ? 'text' : 'uuid' })
  agentId: string;

  @Column({ name: 'agent_external_id', type: 'varchar', nullable: true })
  agentExternalId: string | null;

  @Column({ name: 'task_id', type: isSqlite ? 'text' : 'uuid' })
  taskId: string;

  @Column({
    name: 'order_id',
    type: isSqlite ? 'text' : 'uuid',
    nullable: true,
  })
  orderId: string | null;

  @Column({ name: 'bid_id', type: isSqlite ? 'text' : 'uuid', nullable: true })
  bidId: string | null;

  @Column({
    name: 'delivery_id',
    type: isSqlite ? 'text' : 'uuid',
    nullable: true,
  })
  deliveryId: string | null;

  @Column({
    name: 'arbitration_id',
    type: isSqlite ? 'text' : 'uuid',
    nullable: true,
  })
  arbitrationId: string | null;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: MCPAgentTaskEventType;

  @Column({ name: 'event_key', type: 'varchar' })
  eventKey: string;

  @Column({ type: 'varchar', default: MCPAgentTaskEventStatus.PENDING })
  status: MCPAgentTaskEventStatus;

  @Column({ name: 'delivery_count', type: 'int', default: 0 })
  deliveryCount: number;

  @Column({
    name: 'first_delivered_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  firstDeliveredAt: Date | null;

  @Column({
    name: 'last_delivered_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  lastDeliveredAt: Date | null;

  @Column({
    name: 'acked_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  ackedAt: Date | null;

  @Column({
    name: 'expired_at',
    type: isSqlite ? 'datetime' : 'timestamp with time zone',
    nullable: true,
  })
  expiredAt: Date | null;

  @Column({ name: 'last_request_id', type: 'varchar', nullable: true })
  lastRequestId: string | null;

  @Column({
    name: 'payload_json',
    type: isSqlite ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  payloadJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
