import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus } from './entities/order.entity';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrdersService } from './orders.service';
import { AdminGuard } from '../admin/admin.guard';

type PayBody = {
  userId?: unknown;
};

type DeliverBody = {
  userId?: unknown;
  deliverySummary?: unknown;
  deliveryUrl?: unknown;
};

type AcceptBody = {
  userId?: unknown;
};

type RejectBody = {
  userId?: unknown;
  reason?: unknown;
};

type ReleaseBody = {
  adminUserId?: unknown;
  transactionId?: unknown;
  notes?: unknown;
  reason?: unknown;
};

type CancelBody = {
  userId?: unknown;
};

@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@Query('status') status?: OrderStatus) {
    return this.ordersService.findAll(status);
  }

  @Get('client/:userId')
  findByClient(@Param('userId') userId: string) {
    return this.ordersService.findByClient(userId);
  }

  @Get('owner/:userId')
  findByOwner(@Param('userId') userId: string) {
    return this.ordersService.findByOwner(userId);
  }

  @Get('agent/:agentId')
  findByAgent(@Param('agentId') agentId: string) {
    return this.ordersService.findByAgent(agentId);
  }

  @Get('task/:taskId')
  findByTask(@Param('taskId') taskId: string) {
    return this.ordersService.findByTask(taskId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Get(':id/deliveries')
  listDeliveries(@Param('id') id: string) {
    return this.ordersService.listDeliveries(id);
  }

  @Post(':id/pay')
  async pay(@Param('id') id: string, @Body() body: PayBody) {
    const payerUserId = body.userId;
    if (typeof payerUserId !== 'string' || payerUserId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(payerUserId, {
      type: 'body',
      metatype: String,
      data: 'userId',
    });
    return this.ordersService.pay(id, payerUserId);
  }

  @Post(':id/deliver')
  async deliver(@Param('id') id: string, @Body() body: DeliverBody) {
    const ownerUserId = body.userId;
    if (typeof ownerUserId !== 'string' || ownerUserId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(ownerUserId, {
      type: 'body',
      metatype: String,
      data: 'userId',
    });

    const deliverySummary =
      typeof body.deliverySummary === 'string'
        ? body.deliverySummary
        : undefined;
    const deliveryUrl =
      typeof body.deliveryUrl === 'string' ? body.deliveryUrl : undefined;

    return this.ordersService.deliver(id, ownerUserId, {
      deliverySummary,
      deliveryUrl,
    });
  }

  @Post(':id/accept')
  async accept(@Param('id') id: string, @Body() body: AcceptBody) {
    const clientUserId = body.userId;
    if (typeof clientUserId !== 'string' || clientUserId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(clientUserId, {
      type: 'body',
      metatype: String,
      data: 'userId',
    });
    return this.ordersService.accept(id, clientUserId);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: RejectBody) {
    const clientUserId = body.userId;
    if (typeof clientUserId !== 'string' || clientUserId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(clientUserId, {
      type: 'body',
      metatype: String,
      data: 'userId',
    });
    const reason = typeof body.reason === 'string' ? body.reason : undefined;
    return this.ordersService.reject(id, clientUserId, { reason });
  }

  @Post(':id/release')
  @UseGuards(AdminGuard)
  async release(@Param('id') id: string, @Body() body: ReleaseBody) {
    const adminUserId = body.adminUserId;
    if (typeof adminUserId !== 'string' || adminUserId.trim().length === 0) {
      throw new BadRequestException('adminUserId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(adminUserId, {
      type: 'body',
      metatype: String,
      data: 'adminUserId',
    });
    const transactionId =
      typeof body.transactionId === 'string' ? body.transactionId : undefined;
    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    return this.ordersService.release(id, adminUserId, {
      transactionId,
      notes,
    });
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() body: CancelBody) {
    const clientUserId = body.userId;
    if (typeof clientUserId !== 'string' || clientUserId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }
    await new ParseUUIDPipe({ version: '4' }).transform(clientUserId, {
      type: 'body',
      metatype: String,
      data: 'userId',
    });
    return this.ordersService.cancel(id, clientUserId);
  }

  @Post(':id/payment-proof')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPaymentProof(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { platformCodeId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.ordersService.uploadPaymentProof(id, file, body.platformCodeId);
  }
}
