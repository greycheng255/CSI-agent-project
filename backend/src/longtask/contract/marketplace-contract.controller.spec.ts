import { MarketplaceContractController } from './marketplace-contract.controller';
import { MarketplaceBidsService } from '../marketplace-bids/marketplace-bids.service';
import { CancelSkeletonService } from '../marketplace-orders/cancel-skeleton.service';
import { DeliveryContractService } from '../marketplace-orders/delivery-contract.service';
import { MarketplaceOrdersService } from '../marketplace-orders/marketplace-orders.service';
import { RevisionNegotiationService } from '../marketplace-orders/revision-negotiation.service';
import { SpecContractService } from '../marketplace-orders/spec-contract.service';
import { SpecChangeService } from '../marketplace-orders/spec-change.service';
import { MarketplaceTasksService } from '../marketplace-tasks/marketplace-tasks.service';
import { DisputesService } from '../disputes/disputes.service';
import { SettlementsService } from '../settlements/settlements.service';

/**
 * C→M 契约控制器 smoke 测试：验证参数转换与 service 委托。
 * HMAC 验签在运行时由守卫执行，单元测试直接调用控制器方法。
 */
describe('MarketplaceContractController（场景一~八端点）', () => {
  let controller: MarketplaceContractController;

  const tasks = { findOpen: jest.fn(), findById: jest.fn() };
  const bids = { submit: jest.fn() };
  const orders = {
    applyProjectId: jest.fn(),
    orderStatus: jest.fn(),
    listByWorkspace: jest.fn(),
  };
  const spec = { receiveEmployerMention: jest.fn(), submitSpec: jest.fn() };
  const cancel = {
    respond: jest.fn(),
    autoResolve: jest.fn(),
    finalize: jest.fn(),
    toDispute: jest.fn(),
  };
  const delivery = { submitDeliverable: jest.fn() };
  const negotiation = { start: jest.fn(), decide: jest.fn() };
  const specChange = {
    classify: jest.fn(),
    propose: jest.fn(),
    confirm: jest.fn(),
    reject: jest.fn(),
  };
  const settlements = { trigger: jest.fn(), getByOrder: jest.fn(), listByWorkspace: jest.fn() };
  const disputes = { submitEvidence: jest.fn(), acknowledge: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MarketplaceContractController(
      tasks as unknown as MarketplaceTasksService,
      bids as unknown as MarketplaceBidsService,
      orders as unknown as MarketplaceOrdersService,
      spec as unknown as SpecContractService,
      cancel as unknown as CancelSkeletonService,
      delivery as unknown as DeliveryContractService,
      negotiation as unknown as RevisionNegotiationService,
      specChange as unknown as SpecChangeService,
      settlements as unknown as SettlementsService,
      disputes as unknown as DisputesService,
    );
  });

  it('GET /tasks 委托 findOpen', () => {
    controller.listTasks();
    expect(tasks.findOpen).toHaveBeenCalled();
  });

  it('POST /tasks/:id/bids 转换 snake_case → service 入参', () => {
    bids.submit.mockResolvedValue({ ok: 1 });
    controller.submitBid('t1', {
      workspace_id: 'ws-1',
      price_cny: 1000,
      plan_summary: '方案',
      source: 'push',
    });
    expect(bids.submit).toHaveBeenCalledWith({
      taskId: 't1',
      workspaceId: 'ws-1',
      priceCny: 1000,
      planSummary: '方案',
      estimatedDeliveryAt: undefined,
      source: 'push',
    });
  });

  it('POST bids 缺 workspace_id → 抛错', () => {
    expect(() =>
      controller.submitBid('t1', { price_cny: 100 }),
    ).toThrow('workspace_id is required');
  });

  it('PATCH /orders/:id 委托 applyProjectId', () => {
    controller.patchOrder('o1', { project_id: 'p-1' });
    expect(orders.applyProjectId).toHaveBeenCalledWith('o1', 'p-1');
  });

  it('GET 对账端点委托对应 service', () => {
    controller.orderStatus('o1');
    expect(orders.orderStatus).toHaveBeenCalledWith('o1');

    controller.workspaceOrders('ws-1');
    expect(orders.listByWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('POST /orders/:id/employer-mentions 委托 spec service', () => {
    controller.employerMentions('o1', { body: '请澄清' });
    expect(spec.receiveEmployerMention).toHaveBeenCalledWith('o1', {
      body: '请澄清',
    });
  });

  it('POST /orders/:id/spec 转换 spec_content/spec_hash/milestones', () => {
    controller.submitSpec('o1', {
      spec_content: { raw: 'x' },
      spec_hash: 'h1',
      milestones: [{ key: 'm1', weight: 1 }],
    });
    expect(spec.submitSpec).toHaveBeenCalledWith('o1', {
      specContent: { raw: 'x' },
      specHash: 'h1',
      milestones: [{ key: 'm1', weight: 1 }],
    });
  });

  it('场景八 respond/auto-resolve 参数校验与委托', () => {
    controller.cancelRespond('cr-1', { response: 'accept' });
    expect(cancel.respond).toHaveBeenCalledWith('cr-1', 'accept');

    controller.cancelAutoResolve('cr-1', {
      outcome: 'accept_partial_settlement',
    });
    expect(cancel.autoResolve).toHaveBeenCalledWith(
      'cr-1',
      'accept_partial_settlement',
    );

    controller.cancelFinalize('cr-1');
    expect(cancel.finalize).toHaveBeenCalledWith('cr-1');

    controller.cancelToDispute('cr-1');
    expect(cancel.toDispute).toHaveBeenCalledWith('cr-1');
  });

  it('场景八 respond 非法值 → 抛错', () => {
    expect(() => controller.cancelRespond('cr-1', { response: 'foo' })).toThrow(
      'response must be accept/reject/counter_proposal',
    );
  });

  it('场景五 deliverables 委托并转换参数', () => {
    controller.submitDeliverables('o1', {
      metadata: { summary: 'x' },
      artifact_urls: ['u1'],
      submission_seq: 2,
    });
    expect(delivery.submitDeliverable).toHaveBeenCalledWith('o1', {
      metadata: { summary: 'x' },
      artifactUrls: ['u1'],
      submissionSeq: 2,
    });
  });

  it('场景六 start/decide 参数校验与委托', () => {
    controller.startNegotiation({ order_id: 'o1', reason: 'r' });
    expect(negotiation.start).toHaveBeenCalledWith('o1', 'r');

    controller.decideNegotiation('n1', { decision: 'C' });
    expect(negotiation.decide).toHaveBeenCalledWith('n1', 'C');

    expect(() => controller.decideNegotiation('n1', { decision: 'X' })).toThrow(
      'decision must be A/B/C/D',
    );
  });

  it('场景七 classify/propose/confirm/reject 委托', () => {
    controller.classifyRevision('c1', { classification: 'new_requirement' });
    expect(specChange.classify).toHaveBeenCalledWith('c1', 'new_requirement');

    controller.proposeSpecChange({ order_id: 'o1', change_seq: 3, payload: {} });
    expect(specChange.propose).toHaveBeenCalledWith('o1', 3, { payload: {} });

    controller.confirmSpecChange('c1');
    expect(specChange.confirm).toHaveBeenCalledWith('c1');

    controller.rejectSpecChange('c1');
    expect(specChange.reject).toHaveBeenCalledWith('c1');
  });

  it('场景九/十与对账端点委托', () => {
    controller.triggerSettlement({ order_id: 'o1' });
    expect(settlements.trigger).toHaveBeenCalledWith('o1');

    controller.orderSettlement('o1');
    expect(settlements.getByOrder).toHaveBeenCalledWith('o1');

    controller.workspaceSettlements('ws-1');
    expect(settlements.listByWorkspace).toHaveBeenCalledWith('ws-1');

    controller.disputeEvidence('d1', { files: [] });
    expect(disputes.submitEvidence).toHaveBeenCalledWith('d1', { files: [] });

    controller.disputeAcknowledge('d1');
    expect(disputes.acknowledge).toHaveBeenCalledWith('d1');
  });
});