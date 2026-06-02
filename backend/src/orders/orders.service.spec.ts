import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { Delivery } from './entities/delivery.entity';
import { Arbitration } from '../arbitrations/entities/arbitration.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { UserPaymentCode } from '../payment/entities/user-payment-code.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BalanceService } from '../payment/balance.service';

describe('OrdersService', () => {
  let service: OrdersService;

  const mockOrdersRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockDeliveriesRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockArbitrationsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockAuditLogsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockUserPaymentCodeRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockWebhooksService = {
    notifyOrderPaid: jest.fn(),
    notifyOrderDelivered: jest.fn(),
    notifyOrderAccepted: jest.fn(),
    notifyOrderCompleted: jest.fn(),
  };

  const mockBalanceService = {
    addBalance: jest.fn(),
    deductBalance: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrdersRepository,
        },
        {
          provide: getRepositoryToken(Delivery),
          useValue: mockDeliveriesRepository,
        },
        {
          provide: getRepositoryToken(Arbitration),
          useValue: mockArbitrationsRepository,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogsRepository,
        },
        {
          provide: getRepositoryToken(UserPaymentCode),
          useValue: mockUserPaymentCodeRepository,
        },
        {
          provide: WebhooksService,
          useValue: mockWebhooksService,
        },
        {
          provide: BalanceService,
          useValue: mockBalanceService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
