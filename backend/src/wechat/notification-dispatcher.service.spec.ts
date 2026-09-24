import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationOutbox } from './notification-outbox.entity';
import { User } from '../users/entities/user.entity';

describe('NotificationDispatcherService（微信公众号通知调度）', () => {
  let service: NotificationDispatcherService;

  const mockOutboxRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
  };
  const mockUsersRepo = {
    findOne: jest.fn(),
  };

  function dueRow(overrides: Partial<NotificationOutbox> = {}) {
    return {
      id: 'outbox-1',
      noKey: 'evt:1',
      userId: 'user-1',
      eventType: 'bid.won',
      channel: 'wechat',
      payload: { openid: 'openid-1', orderId: 'o1' },
      templateId: 'tmpl-1',
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: new Date('2026-01-01T00:00:00Z'),
      lastError: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatcherService,
        {
          provide: getRepositoryToken(NotificationOutbox),
          useValue: mockOutboxRepo,
        },
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
      ],
    }).compile();
    service = module.get(NotificationDispatcherService);
  });

  describe('enqueue', () => {
    const input = {
      noKey: 'bid.won:o1',
      userId: 'user-1',
      eventType: 'bid.won',
      templateId: 'tmpl-1',
      data: { orderId: 'o1' },
    };

    it('用户未绑定 openid → 落 skipped 审计且不重试', async () => {
      mockUsersRepo.findOne.mockResolvedValue({ id: 'user-1', wechatOpenid: null });
      await service.enqueue(input);
      const saved = mockOutboxRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('skipped');
      expect(saved.channel).toBe('wechat');
      expect(mockOutboxRepo.save).toHaveBeenCalledTimes(1);
    });

    it('用户已绑定 openid → 落 pending，payload 带 openid', async () => {
      mockUsersRepo.findOne.mockResolvedValue({
        id: 'user-1',
        wechatOpenid: 'openid-1',
      });
      mockOutboxRepo.findOne.mockResolvedValue(null);
      await service.enqueue(input);
      const saved = mockOutboxRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('pending');
      expect(saved.payload.openid).toBe('openid-1');
      expect(saved.noKey).toBe('bid.won:o1');
    });

    it('同一 noKey 已存在 → 幂等直接返回，不重复写入', async () => {
      mockUsersRepo.findOne.mockResolvedValue({
        id: 'user-1',
        wechatOpenid: 'openid-1',
      });
      mockOutboxRepo.findOne.mockResolvedValue({ id: 'existing' });
      await service.enqueue(input);
      expect(mockOutboxRepo.save).not.toHaveBeenCalled();
    });

    it('data 含嵌套对象/数组 → 阻断并落 skipped invalid-template-fields', async () => {
      mockUsersRepo.findOne.mockResolvedValue({
        id: 'user-1',
        wechatOpenid: 'openid-1',
      });
      await service.enqueue({
        ...input,
        data: { orderId: 'o1', nested: { a: 1 } },
      });
      const saved = mockOutboxRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('skipped');
      expect(saved.lastError).toContain('invalid-template-fields');
      expect(saved.lastError).toContain('nested');
    });

    it('已知事件缺必需字段 → 仅告警不阻断，仍落 pending', async () => {
      mockUsersRepo.findOne.mockResolvedValue({
        id: 'user-1',
        wechatOpenid: 'openid-1',
      });
      mockOutboxRepo.findOne.mockResolvedValue(null);
      // 竞标/催办等已知事件不传命名为 taskTitle 的必需字段，只发告警
      await service.enqueue(input);
      const saved = mockOutboxRepo.save.mock.calls[0][0];
      expect(saved.status).toBe('pending');
    });
  });

  describe('processDue', () => {
    it('成功送达 → 置 success', async () => {
      const row = dueRow();
      mockOutboxRepo.find.mockResolvedValue([row]);
      const sendFn = jest.fn().mockResolvedValue({
        done: true,
        delivered: true,
        retryable: false,
      });
      const result = await service.processDue(new Date(), sendFn);
      expect(result.sent).toBe(1);
      expect(row.status).toBe('success');
      expect(row.lastError).toBeNull();
    });

    it('终态错误（如 invalid openid）→ 进死信', async () => {
      const row = dueRow();
      mockOutboxRepo.find.mockResolvedValue([row]);
      const sendFn = jest.fn().mockResolvedValue({
        done: true,
        delivered: false,
        retryable: false,
        error: 'errcode=40003',
      });
      const result = await service.processDue(new Date(), sendFn);
      expect(result.dead).toBe(1);
      expect(row.status).toBe('dead');
      expect(row.lastError).toBe('errcode=40003');
    });

    it('可恢复错误 → 退避重试（attempts 递增、nextAttemptAt 延后）', async () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const row = dueRow();
      mockOutboxRepo.find.mockResolvedValue([row]);
      const sendFn = jest.fn().mockResolvedValue({
        done: false,
        delivered: false,
        retryable: true,
        error: 'network:boom',
      });
      const result = await service.processDue(now, sendFn);
      expect(result.retried).toBe(1);
      expect(row.attempts).toBe(1);
      expect(row.status).toBe('pending');
      expect(row.nextAttemptAt!.getTime()).toBe(
        now.getTime() + 5_000, // backoff[0] = 5s
      );
    });

    it('重试次数耗尽 → 转 dead', async () => {
      const row = dueRow({ attempts: 4 });
      mockOutboxRepo.find.mockResolvedValue([row]);
      const sendFn = jest.fn().mockResolvedValue({
        done: false,
        delivered: false,
        retryable: true,
        error: 'attempts-exhausted',
      });
      const result = await service.processDue(new Date(), sendFn);
      expect(result.dead).toBe(1);
      expect(row.status).toBe('dead');
      expect(row.nextAttemptAt).toBeNull();
    });
  });
});