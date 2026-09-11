import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationOutbox } from './notification-outbox.entity';
import { WechatTokenService } from './wechat-token.service';
import { WechatTemplateService } from './wechat-template.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationDispatcherCron } from './notification-dispatcher.cron';
import { NotificationDeliveryService } from './notification-delivery.service';
import { WechatBindController } from './wechat-bind.controller';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../longtask/workspaces/workspace.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationOutbox, User, Workspace]),
    AuthModule, // AuthGuard 依赖 AuthService
  ],
  providers: [
    WechatTokenService,
    WechatTemplateService,
    NotificationDispatcherService,
    NotificationDispatcherCron,
    NotificationDeliveryService,
  ],
  controllers: [WechatBindController],
  exports: [
    NotificationDeliveryService,
    NotificationDispatcherService,
    WechatTokenService,
  ],
})
export class WechatModule {}