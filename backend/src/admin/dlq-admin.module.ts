import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module';
import { WebhookOutbox } from '../longtask/contract/webhook-outbox.entity';
import { NotificationOutbox } from '../wechat/notification-outbox.entity';
import { DlqAdminController } from './dlq-admin.controller';

/** DLQ（死信）运维管理 */
@Module({
  imports: [
    AdminModule,
    TypeOrmModule.forFeature([WebhookOutbox, NotificationOutbox]),
  ],
  controllers: [DlqAdminController],
})
export class DlqAdminModule {}