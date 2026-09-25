import { EmployerMarketplaceOrdersController } from './employer-marketplace-orders.controller';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { SpecContractService } from './spec-contract.service';
import { DeliveryContractService } from './delivery-contract.service';
import { CancelSkeletonService } from './cancel-skeleton.service';
import { SpecChangeService } from './spec-change.service';
import { DisputesService } from '../disputes/disputes.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

/**
 * 雇主侧订单控制器 smoke 测试：验证参数转换与 service 委托。
 * 鉴权（AuthGuard）与归属校验（claimEmployer）在运行时执行，
 * 单元测试直接调用控制器方法并 mock 掉归属校验依赖。
 */
describe('EmployerMarketplaceOrdersController（雇主沟通端点）', () => {
  let controller: EmployerMarketplaceOrdersController;

  const orders = {
    listByEmployer: jest.fn(),
    claimEmployer: jest.fn().mockResolvedValue({ id: 'o1' }),
    latestCancelRequest: jest.fn(),
  };
  const spec = {
    listEmployerMentions: jest.fn(),
    employerReplyMention: jest.fn(),
    listEmployerThread: jest.fn(),
    sendEmployerMessage: jest.fn(),
  };
  const delivery = { listByOrder: jest.fn() };
  const cancel = { initiateCancel: jest.fn() };
  const specChange = { listByOrder: jest.fn() };
  const disputes = { findLatestByOrder: jest.fn() };
  const tasks = { findById: jest.fn() };
  const workspaces = { findById: jest.fn() };

  const req = { user: { id: 'emp-1', displayName: '用户24565' } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    orders.claimEmployer.mockResolvedValue({ id: 'o1' });
    controller = new EmployerMarketplaceOrdersController(
      orders as unknown as MarketplaceOrdersService,
      spec as unknown as SpecContractService,
      delivery as unknown as DeliveryContractService,
      cancel as unknown as CancelSkeletonService,
      specChange as unknown as SpecChangeService,
      disputes as unknown as DisputesService,
      tasks as unknown as MarketplaceTasksService,
      workspaces as unknown as WorkspacesService,
    );
  });

  it('GET /:id/messages 委托 listEmployerThread 并包装为 { items }', async () => {
    spec.listEmployerThread.mockResolvedValueOnce([
      { id: 'm1', kind: 'question' },
    ]);

    const res = await controller.listMessages('o1', req);

    expect(spec.listEmployerThread).toHaveBeenCalledWith('o1');
    expect(res).toEqual({ items: [{ id: 'm1', kind: 'question' }] });
  });

  it('POST /:id/messages 委托 sendEmployerMessage（带上雇主身份与 client_message_id）', async () => {
    spec.sendEmployerMessage.mockResolvedValueOnce({
      id: 'msg-1',
      duplicate: false,
    });

    await controller.sendMessage(
      'o1',
      {
        text: '请补充导出格式',
        client_message_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3309',
      },
      req,
    );

    expect(spec.sendEmployerMessage).toHaveBeenCalledWith('o1', {
      text: '请补充导出格式',
      attachments: undefined,
      clientMessageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3309',
      fromId: 'emp-1',
      fromDisplayName: '用户24565',
    });
  });

  it('POST /:id/messages 非字符串 text 归一为空串（由 service 返回 400）', async () => {
    spec.sendEmployerMessage.mockResolvedValueOnce({
      id: 'msg-1',
      duplicate: false,
    });

    await controller.sendMessage('o1', { text: 123 }, req);

    expect(spec.sendEmployerMessage).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ text: '', clientMessageId: null }),
    );
  });

  it('POST /:id/mentions/:mentionId/replies 委托 employerReplyMention', async () => {
    spec.employerReplyMention.mockResolvedValueOnce({
      id: 'row-1',
      status: 'replied',
    });

    await controller.replyMention(
      'o1',
      'row-1',
      { text: '需要支持微信登录' },
      req,
    );

    expect(spec.employerReplyMention).toHaveBeenCalledWith('o1', 'row-1', {
      text: '需要支持微信登录',
      attachments: [],
      fromId: 'emp-1',
      fromDisplayName: '用户24565',
    });
  });

  it('未登录 → 403 FORBIDDEN（雇主动作要求本人身份）', async () => {
    await expect(
      controller.sendMessage('o1', { text: 'hi' }, {
        user: undefined,
      } as never),
    ).rejects.toMatchObject({ status: 403, errorCode: 'FORBIDDEN' });
    expect(spec.sendEmployerMessage).not.toHaveBeenCalled();
  });
});
