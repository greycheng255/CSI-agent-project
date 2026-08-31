import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketplaceContractController } from './contract/marketplace-contract.controller';
import { Rfc7807Filter } from './contract/rfc7807.filter';
import { WebhookDispatcherService } from './contract/webhook-dispatcher.service';
import { WebhookInboundEvent } from './contract/webhook-inbound.entity';
import { WebhookOutbox } from './contract/webhook-outbox.entity';
import { TimeoutScannerService } from './contract/timeout-scanner.service';
import { MarketplaceDispute } from './disputes/dispute.entity';
import { DisputesService } from './disputes/disputes.service';
import { MarketplaceSettlement } from './settlements/settlement.entity';
import { SettlementsService } from './settlements/settlements.service';
import { MarketplaceBid } from './marketplace-bids/marketplace-bid.entity';
import { MarketplaceBidsService } from './marketplace-bids/marketplace-bids.service';
import { SelectionService } from './marketplace-bids/selection.service';
import { MarketplaceCancelRequest } from './marketplace-orders/cancel-request.entity';
import { CancelSkeletonService } from './marketplace-orders/cancel-skeleton.service';
import { MarketplaceDelivery } from './marketplace-orders/delivery.entity';
import { DeliveryContractService } from './marketplace-orders/delivery-contract.service';
import { MarketplaceOrder } from './marketplace-orders/marketplace-order.entity';
import { MarketplaceOrdersService } from './marketplace-orders/marketplace-orders.service';
import { MarketplaceRevisionNegotiation } from './marketplace-orders/negotiation.entity';
import { RevisionNegotiationService } from './marketplace-orders/revision-negotiation.service';
import { SpecContractService } from './marketplace-orders/spec-contract.service';
import { MarketplaceSpecChange } from './marketplace-orders/spec-change.entity';
import { SpecChangeService } from './marketplace-orders/spec-change.service';
import { MarketplaceTask } from './marketplace-tasks/marketplace-task.entity';
import { MarketplaceTasksController } from './marketplace-tasks/marketplace-tasks.controller';
import { MarketplaceTasksService } from './marketplace-tasks/marketplace-tasks.service';
import { OpportunityDispatch } from './marketplace-tasks/opportunity-dispatch.entity';
import { OpportunityPushService } from './marketplace-tasks/opportunity-push.service';
import { Workspace } from './workspaces/workspace.entity';
import { WorkspacesController } from './workspaces/workspaces.controller';
import { WorkspacesService } from './workspaces/workspaces.service';

/**
 * 长任务域模块（阶段一 + 阶段二）。
 * 底座（HMAC/RFC7807/outbox/超时注册表）+ Workspace + 任务大厅 + 席位竞标 + 订单。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workspace,
      MarketplaceTask,
      OpportunityDispatch,
      MarketplaceBid,
      MarketplaceOrder,
      MarketplaceCancelRequest,
      MarketplaceDelivery,
      MarketplaceRevisionNegotiation,
      MarketplaceSpecChange,
      MarketplaceSettlement,
      MarketplaceDispute,
      WebhookOutbox,
      WebhookInboundEvent,
    ]),
  ],
  controllers: [
    WorkspacesController,
    MarketplaceTasksController,
    MarketplaceContractController,
  ],
  providers: [
    WorkspacesService,
    MarketplaceTasksService,
    OpportunityPushService,
    MarketplaceBidsService,
    SelectionService,
    MarketplaceOrdersService,
    SpecContractService,
    CancelSkeletonService,
    DeliveryContractService,
    RevisionNegotiationService,
    SpecChangeService,
    SettlementsService,
    DisputesService,
    WebhookDispatcherService,
    TimeoutScannerService,
    { provide: APP_FILTER, useClass: Rfc7807Filter },
  ],
  exports: [
    WorkspacesService,
    MarketplaceTasksService,
    OpportunityPushService,
    MarketplaceBidsService,
    SelectionService,
    MarketplaceOrdersService,
    SpecContractService,
    CancelSkeletonService,
    DeliveryContractService,
    RevisionNegotiationService,
    SpecChangeService,
    SettlementsService,
    DisputesService,
    WebhookDispatcherService,
    TimeoutScannerService,
  ],
})
export class LongtaskModule {}