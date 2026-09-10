import { MarketplaceTasksController } from './marketplace-tasks.controller';
import { SelectionService } from '../marketplace-bids/selection.service';
import { ContractError } from '../contract/errors';
import type { RequestWithUser } from '../../auth/auth.guard';

describe('MarketplaceTasksController 雇主选标/驳回/取消（PRD §5.6.2/§5.6.3）', () => {
  const tasksService = {
    findById: jest.fn(),
    claimEmployer: jest.fn(),
    cancel: jest.fn(),
    listByEmployer: jest.fn(),
  };
  const bidsService = {};
  const selectionService = {
    selectBid: jest.fn(),
    rejectAll: jest.fn(),
  };
  const ordersService = {
    listByTaskIds: jest.fn().mockResolvedValue([]),
  };

  let controller: MarketplaceTasksController;
  beforeEach(() => {
    jest.clearAllMocks();
    ordersService.listByTaskIds.mockResolvedValue([]);
    controller = new MarketplaceTasksController(
      tasksService as never,
      bidsService as never,
      selectionService as never,
      ordersService as never,
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
    tasksService.claimEmployer.mockResolvedValueOnce(task);
    selectionService.selectBid.mockResolvedValueOnce({ id: 'order-1' });
    const order = await controller.selectBid('task-1', { bidId: 'bid-1' }, reqEmployer);
    expect(selectionService.selectBid).toHaveBeenCalledWith('task-1', 'bid-1');
    expect(order).toEqual({ id: 'order-1' });
  });

  it('非任务发布者选标 → 403 FORBIDDEN', async () => {
    tasksService.claimEmployer.mockRejectedValueOnce(
      new ContractError(403, 'CONFLICT_DUPLICATE', 'task already has a different employer'),
    );
    await expect(
      controller.selectBid('task-1', { bidId: 'bid-1' }, reqOther),
    ).rejects.toMatchObject({ status: 403 });
    expect(selectionService.selectBid).not.toHaveBeenCalled();
  });

  it('无主任务（employerUserId 为空）→ claimEmployer 认领后可操作', async () => {
    tasksService.claimEmployer.mockResolvedValueOnce({
      ...task,
      employerUserId: 'other-1',
    });
    selectionService.selectBid.mockResolvedValueOnce({ id: 'order-2' });
    const order = await controller.selectBid('task-1', { bidId: 'bid-2' }, reqOther);
    expect(tasksService.claimEmployer).toHaveBeenCalledWith('task-1', 'other-1');
    expect(order).toEqual({ id: 'order-2' });
  });

  it('未登录（无 userId）→ 403，且不做认领', async () => {
    await expect(
      controller.selectBid('task-1', { bidId: 'bid-1' }, { user: undefined } as RequestWithUser),
    ).rejects.toMatchObject({ status: 403 });
    expect(tasksService.claimEmployer).not.toHaveBeenCalled();
  });

  it('bidId 缺失 → 400', async () => {
    tasksService.claimEmployer.mockResolvedValueOnce(task);
    await expect(
      controller.selectBid('task-1', {}, reqEmployer),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('任务不存在 → 404', async () => {
    tasksService.claimEmployer.mockRejectedValueOnce(
      new ContractError(404, 'CONFLICT_DUPLICATE', 'marketplace task not found'),
    );
    await expect(
      controller.selectBid('task-1', { bidId: 'bid-1' }, reqEmployer),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('任务发布者可全部驳回 → 委托 selectionService', async () => {
    tasksService.claimEmployer.mockResolvedValueOnce(task);
    selectionService.rejectAll.mockResolvedValueOnce({ rejectedCount: 2 });
    const result = await controller.rejectAll('task-1', reqEmployer);
    expect(selectionService.rejectAll).toHaveBeenCalledWith('task-1');
    expect(result).toEqual({ rejectedCount: 2 });
  });

  it('非任务发布者全部驳回 → 403', async () => {
    tasksService.claimEmployer.mockRejectedValueOnce(
      new ContractError(403, 'CONFLICT_DUPLICATE', 'forbidden'),
    );
    await expect(controller.rejectAll('task-1', reqOther)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('任务发布者可取消任务（selected → cancelled）', async () => {
    tasksService.claimEmployer.mockResolvedValueOnce(task);
    tasksService.cancel.mockResolvedValueOnce({ id: 'task-1', status: 'cancelled' });
    const result = await controller.cancel('task-1', reqEmployer);
    expect(tasksService.cancel).toHaveBeenCalledWith('task-1');
    expect(result).toEqual({ id: 'task-1', status: 'cancelled' });
  });

  it('非任务发布者取消 → 403，且不调用 cancel', async () => {
    tasksService.claimEmployer.mockRejectedValueOnce(
      new ContractError(403, 'CONFLICT_DUPLICATE', 'forbidden'),
    );
    await expect(controller.cancel('task-1', reqOther)).rejects.toMatchObject({
      status: 403,
    });
    expect(tasksService.cancel).not.toHaveBeenCalled();
  });
});
