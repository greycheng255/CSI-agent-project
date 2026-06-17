import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ArbitrationResolution,
  ArbitrationStatus,
} from './entities/arbitration.entity';
import { ArbitrationsService } from './arbitrations.service';
import { OrdersService } from '../orders/orders.service';
import type { RequestWithUser } from '../auth/auth.guard';
import { AdminPermissionGuard } from '../admin/admin.guard';
import { RequirePermission } from '../admin/admin-permission.decorator';
import { ADMIN_PERMISSIONS } from '../admin/admin-permissions';

type ResolveBody = {
  resolution?: unknown;
};

@Controller('api/v1/admin/arbitrations')
@UseGuards(AdminPermissionGuard)
export class ArbitrationsController {
  constructor(
    private readonly arbitrationsService: ArbitrationsService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get()
  @RequirePermission(ADMIN_PERMISSIONS.ARBITRATION_VIEW)
  list(@Query('status') statusRaw?: string) {
    const status = statusRaw as ArbitrationStatus | undefined;
    if (status && !Object.values(ArbitrationStatus).includes(status)) {
      throw new BadRequestException('invalid status');
    }
    return this.arbitrationsService.list(status);
  }

  @Post(':orderId/start')
  @RequirePermission(ADMIN_PERMISSIONS.ARBITRATION_RESOLVE)
  async start(
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.ordersService.startArbitration(orderId, req.user?.id || '');
  }

  @Post(':orderId/resolve')
  @RequirePermission(ADMIN_PERMISSIONS.ARBITRATION_RESOLVE)
  async resolve(
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Body() body: ResolveBody,
    @Req() req: RequestWithUser,
  ) {
    const resolutionRaw = body.resolution;
    if (
      resolutionRaw !== ArbitrationResolution.REFUND &&
      resolutionRaw !== ArbitrationResolution.PAYOUT
    ) {
      throw new BadRequestException('resolution must be REFUND or PAYOUT');
    }

    return this.ordersService.resolveArbitration({
      orderId,
      adminUserId: req.user?.id || '',
      resolution: resolutionRaw,
    });
  }
}
