import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AdminGuard } from '../admin/admin.guard';

describe('OrdersController', () => {
  let controller: OrdersController;

  const mockOrdersService = {
    findByUser: jest.fn(),
    findOne: jest.fn(),
    pay: jest.fn(),
    deliver: jest.fn(),
    accept: jest.fn(),
    complete: jest.fn(),
    reject: jest.fn(),
    requestArbitration: jest.fn(),
    resolveArbitration: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
