import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../longtask/workspaces/workspace.entity';

describe('NotificationDeliveryService（业务通知入口 → enqueue）', () => {
  let service: NotificationDeliveryService;

  const mockUsersRepo = { findOne: jest.fn(), save: jest.fn() };
  const mockWorkspacesRepo = { findOne: jest.fn() };
  const mockDispatcher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getRepositoryToken(Workspace), useValue: mockWorkspacesRepo },
        {
          provide: NotificationDispatcherService,
          useValue: mockDispatcher,
        },
      ],
    }).compile();
    service = module.get(NotificationDeliveryService);
  });

  it('notifyBidWon → 按 workspace.ownerUserId enqueue bid.won 模板', async () => {
    mockWorkspacesRepo.findOne.mockResolvedValue({ id: 'ws-1', ownerUserId: 'user-1' });
    await service.notifyBidWon('ws-1', 'mt-1', 'o1', '中标标题');
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith({
      noKey: 'bid.won:o1',
      userId: 'user-1',
      eventType: 'bid.won',
      templateId: (process.env.WECHAT_TMPL_BID_WON ?? null),
      data: { taskTitle: '中标标题', orderId: 'o1', marketplaceTaskId: 'mt-1' },
    });
  });

  it('notifyEscrowPaid → enqueue escrow.paid 模板', async () => {
    mockWorkspacesRepo.findOne.mockResolvedValue({ id: 'ws-1', ownerUserId: 'user-1' });
    await service.notifyEscrowPaid('ws-1', 'o1', 100);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith({
      noKey: 'escrow.paid:o1',
      userId: 'user-1',
      eventType: 'escrow.paid',
      templateId: (process.env.WECHAT_TMPL_ESCROW ?? null),
      data: { orderId: 'o1', amountCny: 100 },
    });
  });

  it('notifySettlement → enqueue settlement.completed 模板', async () => {
    mockWorkspacesRepo.findOne.mockResolvedValue({ id: 'ws-1', ownerUserId: 'user-1' });
    await service.notifySettlement('ws-1', 'o1', 200);
    expect(mockDispatcher.enqueue).toHaveBeenCalledWith({
      noKey: 'settlement.completed:o1',
      userId: 'user-1',
      eventType: 'settlement.completed',
      templateId: (process.env.WECHAT_TMPL_SETTLEMENT ?? null),
      data: { orderId: 'o1', amountCny: 200 },
    });
  });

  it('找不到 workspace（owner 缺失）→ 不 enqueue', async () => {
    mockWorkspacesRepo.findOne.mockResolvedValue(null);
    await service.notifyBidWon('ws-missing', 'mt-1', 'o1');
    expect(mockDispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('bindOpenid → 写回 user.wechatOpenid', async () => {
    const user = { id: 'user-1', wechatOpenid: null };
    mockUsersRepo.findOne.mockResolvedValue(user);
    const ok = await service.bindOpenid('user-1', 'openid-x');
    expect(ok).toBe(true);
    expect(user.wechatOpenid).toBe('openid-x');
    expect(mockUsersRepo.save).toHaveBeenCalledWith(user);
  });
});