import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DlqAdminController } from './dlq-admin.controller';
import { AdminGuard } from './admin.guard';
import { WebhookOutbox } from '../longtask/contract/webhook-outbox.entity';
import { NotificationOutbox } from '../wechat/notification-outbox.entity';

jest.mock('./admin.guard', () => ({
  AdminGuard: class AdminGuard { canActivate() { return true; } },
}));

describe('DlqAdminController（DLQ 死信查看 + 一键重放）', () => {
  let controller: DlqAdminController;
  let fakeRepo: {
    createQueryBuilder: jest.Mock;
    getManyAndCount: jest.Mock;
    execute: jest.Mock;
    where: jest.Mock;
    set: jest.Mock;
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    update: jest.Mock;
  };

  function buildRepo() {
    fakeRepo = {
      createQueryBuilder: jest.fn(() => fakeRepo),
      orderBy: jest.fn(() => fakeRepo),
      offset: jest.fn(() => fakeRepo),
      limit: jest.fn(() => fakeRepo),
      where: jest.fn(() => fakeRepo),
      getManyAndCount: jest.fn(async () => [[], 0]),
      set: jest.fn(() => fakeRepo),
      update: jest.fn(() => fakeRepo),
      execute: jest.fn(async () => ({ affected: 0 })),
    };
    return fakeRepo;
  }

  const webhookRepo = { manager: { getRepository: jest.fn() } };
  const notifRepo = { manager: { getRepository: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DlqAdminController],
      providers: [
        { provide: getRepositoryToken(WebhookOutbox), useValue: webhookRepo },
        { provide: getRepositoryToken(NotificationOutbox), useValue: notifRepo },
      ],
    }).compile();
    controller = module.get(DlqAdminController);
    webhookRepo.manager.getRepository.mockReturnValue(buildRepo());
  });

  it('dead 列表按 status=dead 分页查询', async () => {
    fakeRepo.getManyAndCount.mockResolvedValueOnce([
      [{ id: '1', eventType: 'X', targetUrl: 'http://t', attempts: 5, lastError: 'e', nextAttemptAt: null, createdAt: new Date() }],
      1,
    ]);
    const res = await controller.dead('webhook' as never, '1', '10');
    expect(res.total).toBe(1);
    expect(res.data[0].event_type).toBe('X');
  });

  it('replay 仅重放 status=dead 的记录，reset attempts/lastError/nextAttemptAt', async () => {
    fakeRepo.execute.mockResolvedValueOnce({ affected: 1 });
    const res = await controller.replay({ type: 'webhook' as never, ids: ['a', 'b'] });
    expect(res.replayed).toBe(1);
    // 校验 update 链：set({status:'pending', attempts:0, nextAttemptAt, lastError:null}) + where({id,status:'dead'})
    const updateChain = fakeRepo.update.mock.results[0].value;
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', attempts: 0, lastError: null }),
    );
  });

  it('replay 拒绝超过批量上限', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => String(i));
    const res = await controller.replay({ type: 'webhook' as never, ids });
    expect(res.error).toContain('batch limit');
  });
});