import { MarketplaceTasksController } from './marketplace-tasks.controller';
import { SelectionService } from '../marketplace-bids/selection.service';
import type { RequestWithUser } from '../../auth/auth.guard';

describe('MarketplaceTasksController 雇主选标/全部驳回（PRD §5.6.2/§5.6.3）', () => {
  const tasksService = {
    findById: jest.fn(),
  };
  const bidsService = {};
  const selectionService = {
    selectBid: jest.fn(),
    rejectAll: jest.fn(),
  };

  let controller: MarketplaceTasksController;
  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MarketplaceTasksController(
      tasksService as never,
      bidsService as never,
      selectionService as never,
    );
  });

  const task = {
    id: 'task-1',
    status: 'open',
    employerUserId: 'employer-1',
    bidRound: 1,
  };
  const reqEmployer = { user: { id: 'employer-1' } } as RequestWithUser;
  const reqOther = { user: { id: 'other-1' } } as RequestWithUser;

  it('任务发布者可选标 → 委托 selectionService', async () => {
    tasksService.findById.mockResolvedValueOnce(task);
    selectionService.selectBid.mockResolvedValueOnce({ id: 'order-1' });
    const order = await controller.selectBid('task-1', { bidId: 'bid-1' }, reqEmployer);
    expect(selectionService.selectBid).toHaveBeenCalledWith('task-1', 'bid-1');
    expect(order).toEqual({ id: 'order-1' });
  });

  it('非任务发布者选标 → 403 FORBIDDEN', async () => {
    tasksService.findById.mockResolvedValueOnce(task);
    await expect(
      controller.selectBid('task-1', { bidId: 'bid-1' }, reqOther),
    ).rejects.toMatchObject({ status: 403 });
    expect(selectionService.selectBid).not.toHaveBeenCalled();
  });

  it('bidId 缺失 → 400', async () => {
    tasksService.findById.mockResolvedValueOnce(task);
    await expect(
      controller.selectBid('task-1', {}, reqEmployer),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('任务不存在 → 404', async () => {
    tasksService.findById.mockResolvedValueOnce(null);
    await expect(
      controller.selectBid('task-1', { bidId: 'bid-1' }, reqEmployer),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('任务发布者可全部驳回 → 委托 selectionService', async () => {
    tasksService.findById.mockResolvedValueOnce(task);
    selectionService.rejectAll.mockResolvedValueOnce({ rejectedCount: 2 });
    const result = await controller.rejectAll('task-1', reqEmployer);
    expect(selectionService.rejectAll).toHaveBeenCalledWith('task-1');
    expect(result).toEqual({ rejectedCount: 2 });
  });

  it('非任务发布者全部驳回 → 403', async () => {
    tasksService.findById.mockResolvedValueOnce(task);
    await expect(controller.rejectAll('task-1', reqOther)).rejects.toMatchObject({
      status: 403,
    });
  });
});
