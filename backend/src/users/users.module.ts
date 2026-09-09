import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { AgentsModule } from '../agents/agents.module';
import { LongtaskModule } from '../longtask/longtask.module';
import { SmsVerificationService } from './sms-verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule,
    forwardRef(() => AgentsModule),
    forwardRef(() => LongtaskModule),
  ],
  controllers: [UsersController],
  providers: [UsersService, SmsVerificationService],
  exports: [UsersService],
})
export class UsersModule {}
