const request = require('supertest');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

if (!process.env.DB_HOST && !process.env.DATABASE_PATH) {
  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.DATABASE_PATH = path.join(
    tmpDir,
    `hiclaw-event-consumption-${Date.now()}.sqlite`,
  );
  process.env.DB_SYNC = 'true';
  process.env.DB_TYPE = 'sqlite';
}
process.env.APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Shanghai';
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

require('reflect-metadata');
require('ts-node/register');

const { Client } = require('pg');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('../src/app.module');
const { User } = require('../src/users/entities/user.entity');
const {
  Agent,
  AgentApprovalStatus,
  AgentRuntimeStatus,
  AgentStatus,
  AgentType,
} = require('../src/agents/entities/agent.entity');
const {
  AgentCredential,
} = require('../src/agents/entities/agent-credential.entity');
const { Task, TaskStatus } = require('../src/tasks/entities/task.entity');
const { Bid, BidStatus } = require('../src/bids/entities/bid.entity');
const { Order, OrderStatus } = require('../src/orders/entities/order.entity');
const {
  Delivery,
  DeliveryStatus,
} = require('../src/orders/entities/delivery.entity');
const {
  Arbitration,
  ArbitrationResolution,
  ArbitrationStatus,
} = require('../src/arbitrations/entities/arbitration.entity');
const {
  MCPAgentTaskEvent,
  MCPAgentTaskEventStatus,
  MCPAgentTaskEventType,
} = require('../src/mcp/entities/mcp-agent-task-event.entity');

async function ensurePostgresEventSchema() {
  if (!process.env.DB_HOST) return;
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
  console.log('[hiclaw-events] ensuring PostgreSQL event schema');
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_agent_task_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        agent_external_id VARCHAR,
        task_id UUID NOT NULL,
        order_id UUID,
        bid_id UUID,
        delivery_id UUID,
        arbitration_id UUID,
        event_type VARCHAR NOT NULL,
        event_key VARCHAR NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'PENDING',
        delivery_count INT NOT NULL DEFAULT 0,
        first_delivered_at TIMESTAMPTZ,
        last_delivered_at TIMESTAMPTZ,
        acked_at TIMESTAMPTZ,
        expired_at TIMESTAMPTZ,
        last_request_id VARCHAR,
        payload_json JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_agent_task_events_unique
      ON mcp_agent_task_events(agent_id, event_type, event_key)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mcp_agent_task_events_agent_status
      ON mcp_agent_task_events(agent_id, status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mcp_agent_task_events_task
      ON mcp_agent_task_events(task_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mcp_agent_task_events_order
      ON mcp_agent_task_events(order_id)
    `);
  } finally {
    await client.end();
  }
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function pass(checks, name, evidence) {
  checks.push({ name, status: 'PASS', evidence });
  console.log(`[PASS] ${name}`);
}

async function mcp(server, headers, payload) {
  return request(server)
    .post('/mcp')
    .set('X-SolForge-Agent-Id', headers.agentId)
    .set('X-SolForge-API-Key', headers.apiKey)
    .send(payload);
}

async function callTool(server, headers, name, args, id) {
  const res = await mcp(server, headers, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name, arguments: args },
    id,
  });
  assert(
    res.status === 200 || res.status === 201,
    `${name} HTTP failed`,
    res.body,
  );
  assert(
    res.body?.jsonrpc === '2.0',
    `${name} did not return JSON-RPC`,
    res.body,
  );
  assert(res.body?.result?.success === true, `${name} failed`, res.body);
  return res.body.result.data;
}

async function getMarketTask(server, taskId, statusGroup = 'all') {
  const res = await request(server)
    .get('/api/v1/tasks/market')
    .query({ statusGroup, limit: 100 });
  assert(res.status === 200, 'tasks market HTTP failed', res.body);
  const tasks = Array.isArray(res.body?.data) ? res.body.data : [];
  return tasks.find((item) => item.id === taskId);
}

async function assertMarketStatus(server, taskId, expected, statusGroup = 'all') {
  const item = await getMarketTask(server, taskId, statusGroup);
  assert(item, `market task missing for ${expected}`, { taskId, statusGroup });
  assert(item.marketStatus === expected, 'marketStatus mismatch', {
    taskId,
    expected,
    actual: item.marketStatus,
    item,
  });
  return item;
}

async function assertNotInListOpen(server, headers, taskId, id) {
  const openTasks = await callTool(
    server,
    headers,
    'platform.task.list_open',
    { skills: ['react'], page: 1, pageSize: 100 },
    id,
  );
  assert(
    !openTasks.tasks.some((item) => item.taskId === taskId),
    'non-open task should not be returned by platform.task.list_open',
    { taskId },
  );
}

function findEvent(events, type) {
  return (events || []).find((event) => event.eventType === type);
}

async function findPersistedEvent(repo, agentId, eventType, eventKey) {
  return repo.findOne({ where: { agentId, eventType, eventKey } });
}

async function assertPersistedEvent(
  repo,
  agentId,
  eventType,
  eventKey,
  status,
) {
  const event = await findPersistedEvent(repo, agentId, eventType, eventKey);
  assert(event, `missing persisted event ${eventType}`, {
    eventType,
    eventKey,
  });
  assert(event.status === status, `${eventType} status mismatch`, {
    expected: status,
    actual: event.status,
    event,
  });
  const count = await repo.count({ where: { agentId, eventType, eventKey } });
  assert(count === 1, `${eventType} should be unique`, { eventKey, count });
  return event;
}

async function seedBase(ds) {
  const suffix = `${Date.now()}`.slice(-8);
  const users = ds.getRepository(User);
  const agents = ds.getRepository(Agent);
  const credentials = ds.getRepository(AgentCredential);

  const client = await users.save(
    users.create({
      displayName: `HiClaw Event Client ${suffix}`,
      phone: `13${suffix}`.slice(0, 11),
      passwordHash: 'hiclaw-event-test',
    }),
  );
  const owner = await users.save(
    users.create({
      displayName: `HiClaw Event Owner ${suffix}`,
      phone: `14${suffix}`.slice(0, 11),
      passwordHash: 'hiclaw-event-test',
    }),
  );
  const agent = await agents.save(
    agents.create({
      owner,
      name: `HiClaw Event Agent ${suffix}`,
      description: 'HiClaw event consumption E2E fixture agent',
      externalId: `hiclaw-event-agent-${suffix}`,
      skills: ['react', 'typescript', 'antd'],
      status: AgentStatus.ONLINE,
      approvalStatus: AgentApprovalStatus.APPROVED,
      runtimeStatus: AgentRuntimeStatus.ONLINE,
      lastHeartbeatAt: new Date(),
      heartbeatIntervalMs: 60 * 60 * 1000,
      isActive: true,
      agentType: AgentType.SELF_HOSTED,
      visibility: 'public',
    }),
  );

  const apiKey = `sk-hiclaw-event-${suffix}`;
  await credentials.save(
    credentials.create({
      agent,
      name: 'HiClaw event test key',
      keyId: `ak_hiclaw_event_${suffix}`,
      secretHash: createHash('sha256').update(apiKey).digest('hex'),
      scopes: ['*'],
      status: 'active',
      revokedAt: null,
      lastUsedAt: null,
    }),
  );

  return {
    headers: { agentId: agent.externalId, apiKey },
    client,
    owner,
    agent,
    suffix,
    startedAt: new Date(),
    taskIds: [],
    bidIds: [],
    orderIds: [],
  };
}

async function createTask(ds, fixture, label) {
  const tasks = ds.getRepository(Task);
  const task = await tasks.save(
    tasks.create({
      client: fixture.client,
      clientUserId: fixture.client.id,
      title: `HiClaw ${label} ${fixture.suffix}`,
      description: `HiClaw event consumption ${label}`,
      acceptanceCriteria: '事件只消费一次\n状态真实落库',
      budgetCny: 500,
      expectedDeliveryAt: new Date('2026-07-15T00:00:00Z'),
      tags: ['frontend'],
      skillsRequired: ['react', 'typescript', 'antd'],
      attachmentUrls: ['https://platform.example.com/files/requirements.pdf'],
      status: TaskStatus.OPEN,
    }),
  );
  fixture.taskIds.push(task.id);
  return task;
}

async function acceptBid(ds, fixture, task) {
  const bids = ds.getRepository(Bid);
  const tasks = ds.getRepository(Task);
  const orders = ds.getRepository(Order);
  const bid = await bids.findOne({
    where: { task: { id: task.id }, agent: { id: fixture.agent.id } },
    relations: ['task', 'agent', 'agent.owner'],
  });
  assert(bid, 'Bid not found after quote submit', { taskId: task.id });
  if (!fixture.bidIds.includes(bid.id)) fixture.bidIds.push(bid.id);
  bid.status = BidStatus.ACCEPTED;
  await bids.save(bid);

  task.status = TaskStatus.CLOSED;
  await tasks.save(task);

  const order = await orders.save(
    orders.create({
      task,
      bid,
      client: fixture.client,
      clientUserId: fixture.client.id,
      owner: fixture.owner,
      ownerUserId: fixture.owner.id,
      amountCny: bid.priceCny,
      platformFeeRate: 0,
      platformFeeCny: 0,
      payoutCny: bid.priceCny,
      status: OrderStatus.IN_PROGRESS,
    }),
  );
  fixture.orderIds.push(order.id);
  return order;
}

async function createAcceptedOrder(ds, fixture, label, status) {
  const task = await createTask(ds, fixture, label);
  const bids = ds.getRepository(Bid);
  const orders = ds.getRepository(Order);
  const bid = await bids.save(
    bids.create({
      task,
      agent: fixture.agent,
      priceCny: 200,
      planSummary: `${label} accepted bid`,
      status: BidStatus.ACCEPTED,
      confidenceScore: 0.9,
      estimatedHours: 3,
    }),
  );
  fixture.bidIds.push(bid.id);
  task.status = TaskStatus.CLOSED;
  await ds.getRepository(Task).save(task);
  const order = await orders.save(
    orders.create({
      task,
      bid,
      client: fixture.client,
      clientUserId: fixture.client.id,
      owner: fixture.owner,
      ownerUserId: fixture.owner.id,
      amountCny: bid.priceCny,
      platformFeeRate: 0,
      platformFeeCny: 0,
      payoutCny: bid.priceCny,
      status,
      canceledAt: status === OrderStatus.CANCELED ? new Date() : null,
      refundedAt: status === OrderStatus.REFUNDED ? new Date() : null,
      disputeReason:
        status === OrderStatus.ARBITRATING ? `${label} dispute` : null,
    }),
  );
  fixture.orderIds.push(order.id);
  return { task, bid, order };
}

async function cleanup(ds, fixture) {
  if (!fixture || process.env.KEEP_HICLAW_EVENT_E2E_DATA === 'true') return;
  if (process.env.DB_HOST) {
    const orderIds = fixture.orderIds;
    const taskIds = fixture.taskIds;
    await ds.query('DELETE FROM mcp_agent_task_events WHERE agent_id = $1', [
      fixture.agent.id,
    ]);
    if (orderIds.length > 0) {
      await ds
        .query('DELETE FROM arbitrations WHERE order_id = ANY($1::uuid[])', [
          orderIds,
        ])
        .catch(() => undefined);
      await ds
        .query(
          'DELETE FROM delivery_revisions WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id = ANY($1::uuid[]))',
          [orderIds],
        )
        .catch(() => undefined);
      await ds
        .query('DELETE FROM deliveries WHERE order_id = ANY($1::uuid[])', [
          orderIds,
        ])
        .catch(() => undefined);
      await ds
        .query(
          'DELETE FROM acceptance_checklists WHERE order_id = ANY($1::uuid[])',
          [orderIds],
        )
        .catch(() => undefined);
      await ds
        .query(
          'DELETE FROM execution_traces WHERE order_id = ANY($1::uuid[])',
          [orderIds],
        )
        .catch(() => undefined);
      await ds
        .query(
          'DELETE FROM execution_sub_tasks WHERE phase_id IN (SELECT id FROM execution_phases WHERE order_id = ANY($1::uuid[]))',
          [orderIds],
        )
        .catch(() => undefined);
      await ds
        .query(
          'DELETE FROM execution_phases WHERE order_id = ANY($1::uuid[])',
          [orderIds],
        )
        .catch(() => undefined);
      await ds
        .query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds])
        .catch(() => undefined);
    }
    if (taskIds.length > 0) {
      await ds
        .query('DELETE FROM bids WHERE task_id = ANY($1::uuid[])', [taskIds])
        .catch(() => undefined);
      await ds
        .query(
          'DELETE FROM webhook_deliveries WHERE task_id = ANY($1::uuid[])',
          [taskIds],
        )
        .catch(() => undefined);
      await ds
        .query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds])
        .catch(() => undefined);
    }
    await ds.query('DELETE FROM agent_credentials WHERE agent_id = $1', [
      fixture.agent.id,
    ]);
    await ds.query('DELETE FROM agents WHERE id = $1', [fixture.agent.id]);
    await ds.query('DELETE FROM users WHERE id IN ($1, $2)', [
      fixture.client.id,
      fixture.owner.id,
    ]);
    return;
  }

  await ds
    .getRepository(MCPAgentTaskEvent)
    .delete({ agentId: fixture.agent.id });
}

async function requestRevision(ds, order, reason) {
  const orders = ds.getRepository(Order);
  const deliveries = ds.getRepository(Delivery);
  const delivery = await deliveries.findOne({ where: { orderId: order.id } });
  assert(delivery, 'Delivery not found before revision request');
  delivery.status = DeliveryStatus.REJECTED;
  delivery.rejectionReason = reason;
  delivery.rejectedAt = new Date();
  await deliveries.save(delivery);

  order.status = OrderStatus.IN_PROGRESS;
  order.disputeReason = reason;
  order.currentDeliveryId = delivery.id;
  await orders.save(order);
  return delivery;
}

async function completeOrder(ds, order) {
  const orders = ds.getRepository(Order);
  const deliveries = ds.getRepository(Delivery);
  const delivery = await deliveries.findOne({ where: { orderId: order.id } });
  assert(delivery, 'Delivery not found before completion');
  delivery.status = DeliveryStatus.ACCEPTED;
  delivery.acceptedAt = new Date();
  await deliveries.save(delivery);

  order.status = OrderStatus.COMPLETED;
  order.releasedAt = new Date();
  return orders.save(order);
}

async function main() {
  const checks = [];
  let fixture;
  await ensurePostgresEventSchema();
  console.log('[hiclaw-events] compiling Nest app');
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  console.log('[hiclaw-events] initializing Nest app');
  const app = moduleFixture.createNestApplication();
  await app.init();
  console.log('[hiclaw-events] app initialized');
  const server = app.getHttpServer();
  const ds = app.get(DataSource);
  const eventsRepo = ds.getRepository(MCPAgentTaskEvent);

  try {
    console.log('[hiclaw-events] seeding fixture data');
    fixture = await seedBase(ds);
    const task = await createTask(ds, fixture, 'main-flow');

    const tools = await mcp(server, fixture.headers, {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 'tools-001',
    });
    const toolNames =
      tools.body?.result?.data?.tools?.map((tool) => tool.name) || [];
    assert(
      toolNames.includes('platform.event.ack'),
      'tools/list missing platform.event.ack',
    );
    assert(
      toolNames.includes('platform.event.list_my'),
      'tools/list missing platform.event.list_my',
    );
    pass(checks, 'MCP tools expose event APIs', {
      eventTools: toolNames.filter((name) =>
        name.startsWith('platform.event.'),
      ),
    });

    const openTasks = await callTool(
      server,
      fixture.headers,
      'platform.task.list_open',
      { skills: ['react'], page: 1, pageSize: 20 },
      'list-open-001',
    );
    const openTask = openTasks.tasks.find((item) => item.taskId === task.id);
    assert(openTask, 'open task missing from list_open');
    const openMarketTask = await assertMarketStatus(
      server,
      task.id,
      'OPEN_FOR_BIDDING',
      'bidding',
    );
    assert(
      openMarketTask.isAcceptingBids === true,
      'open market task should accept bids',
      openMarketTask,
    );
    const recommendedEvent = findEvent(
      openTask.events,
      MCPAgentTaskEventType.TASK_RECOMMENDED,
    );
    assert(
      recommendedEvent?.shouldAct === true,
      'TASK_RECOMMENDED shouldAct should be true',
    );
    const recommendedKey = `${MCPAgentTaskEventType.TASK_RECOMMENDED}:${task.id}:${fixture.agent.id}`;
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.TASK_RECOMMENDED,
      recommendedKey,
      MCPAgentTaskEventStatus.DELIVERED,
    );
    const repeatedOpenTasks = await callTool(
      server,
      fixture.headers,
      'platform.task.list_open',
      { skills: ['react'], page: 1, pageSize: 20 },
      'list-open-002',
    );
    const repeatedRecommendedEvent = findEvent(
      repeatedOpenTasks.tasks.find((item) => item.taskId === task.id).events,
      MCPAgentTaskEventType.TASK_RECOMMENDED,
    );
    assert(
      repeatedRecommendedEvent?.shouldAct === false,
      'TASK_RECOMMENDED repeated shouldAct should be false',
    );
    pass(
      checks,
      'published task is shown as bidding and scanned by list_open once',
      {
        eventKey: recommendedKey,
        marketStatus: openMarketTask.marketStatus,
      },
    );

    await callTool(
      server,
      fixture.headers,
      'platform.quote.submit',
      {
        taskId: task.id,
        agentId: fixture.agent.externalId,
        priceCny: 150,
        planSummary: 'React + Vite + Antd 方案',
      },
      'quote-submit-001',
    );
    const pendingBid = await callTool(
      server,
      fixture.headers,
      'platform.quote.get_my',
      { taskId: task.id },
      'quote-my-001',
    );
    const bidSubmittedEvent = findEvent(
      pendingBid.events,
      MCPAgentTaskEventType.BID_SUBMITTED,
    );
    const quotedMarketTask = await assertMarketStatus(
      server,
      task.id,
      'OPEN_FOR_BIDDING',
      'bidding',
    );
    assert(
      quotedMarketTask.bidsCount >= 1,
      'market bidding quote count should increase',
      quotedMarketTask,
    );
    assert(
      bidSubmittedEvent?.shouldAct === true,
      'BID_SUBMITTED shouldAct should be true',
    );
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.BID_SUBMITTED,
      bidSubmittedEvent.eventKey,
      MCPAgentTaskEventStatus.DELIVERED,
    );
    pass(checks, 'BID_SUBMITTED is created by quote status polling', {
      eventKey: bidSubmittedEvent.eventKey,
      bidsCount: quotedMarketTask.bidsCount,
    });

    const pendingPayment = await createAcceptedOrder(
      ds,
      fixture,
      'pending-payment-order',
      OrderStatus.PENDING_PAYMENT,
    );
    const pendingPaymentMarketTask = await assertMarketStatus(
      server,
      pendingPayment.task.id,
      'AWARDED_PENDING_PAYMENT',
      'executing',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      pendingPayment.task.id,
      'list-open-pending-payment-001',
    );
    pass(
      checks,
      'accepted pending-payment task remains in market and is not rescanned',
      {
        taskId: pendingPayment.task.id,
        marketStatus: pendingPaymentMarketTask.marketStatus,
      },
    );

    const order = await acceptBid(ds, fixture, task);
    const inProgressMarketTask = await assertMarketStatus(
      server,
      task.id,
      'IN_PROGRESS',
      'executing',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      task.id,
      'list-open-in-progress-001',
    );
    pass(checks, 'in-progress task remains in market and is not rescanned', {
      taskId: task.id,
      marketStatus: inProgressMarketTask.marketStatus,
    });

    const acceptedBid = await callTool(
      server,
      fixture.headers,
      'platform.quote.get_my',
      { taskId: task.id },
      'quote-my-accepted-001',
    );
    const bidAcceptedEvent = findEvent(
      acceptedBid.events,
      MCPAgentTaskEventType.BID_ACCEPTED,
    );
    assert(
      bidAcceptedEvent?.shouldAct === true,
      'BID_ACCEPTED shouldAct should be true',
    );
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.BID_ACCEPTED,
      bidAcceptedEvent.eventKey,
      MCPAgentTaskEventStatus.DELIVERED,
    );

    const listMy = await callTool(
      server,
      fixture.headers,
      'platform.order.list_my',
      {},
      'orders-my-001',
    );
    const mainOrderItem = listMy.tasks.find(
      (item) => item.orderId === order.id,
    );
    assert(mainOrderItem, 'accepted order missing from list_my');
    const repeatedBidAccepted = findEvent(
      mainOrderItem.events,
      MCPAgentTaskEventType.BID_ACCEPTED,
    );
    const orderStartedEvent = findEvent(
      mainOrderItem.events,
      MCPAgentTaskEventType.ORDER_STARTED,
    );
    assert(
      repeatedBidAccepted?.shouldAct === false,
      'BID_ACCEPTED repeated shouldAct should be false',
    );
    assert(
      orderStartedEvent?.shouldAct === true,
      'ORDER_STARTED shouldAct should be true',
    );
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.ORDER_STARTED,
      orderStartedEvent.eventKey,
      MCPAgentTaskEventStatus.DELIVERED,
    );
    pass(
      checks,
      'BID_ACCEPTED is not redelivered and ORDER_STARTED is delivered once',
      {
        bidAcceptedKey: bidAcceptedEvent.eventKey,
        orderStartedKey: orderStartedEvent.eventKey,
      },
    );

    const acked = await callTool(
      server,
      fixture.headers,
      'platform.event.ack',
      {
        eventId: bidAcceptedEvent.eventId,
        taskId: task.id,
        orderId: order.id,
        idempotency_key: `hiclaw-event-ack-${bidAcceptedEvent.eventId}`,
      },
      'event-ack-001',
    );
    assert(
      acked.noticeStatus === MCPAgentTaskEventStatus.ACKED,
      'ack should mark BID_ACCEPTED ACKED',
    );
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.BID_ACCEPTED,
      bidAcceptedEvent.eventKey,
      MCPAgentTaskEventStatus.ACKED,
    );
    pass(checks, 'platform.event.ack updates event row to ACKED', {
      eventId: bidAcceptedEvent.eventId,
    });

    await callTool(
      server,
      fixture.headers,
      'platform.order.update_execution',
      { taskId: task.id, phase: 'core-dev', progress: 60 },
      'execution-001',
    );
    await callTool(
      server,
      fixture.headers,
      'platform.artifact.attach',
      {
        taskId: task.id,
        resultSummary: '已完成管理后台开发',
        previewUrl: 'https://preview.example.com/hiclaw',
      },
      'delivery-001',
    );
    const waiting = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: task.id },
      'status-waiting-001',
    );
    assert(
      waiting.status === 'WAITING_ACCEPTANCE',
      'WAITING_ACCEPTANCE status mismatch',
      waiting,
    );
    const deliveredMarketTask = await assertMarketStatus(
      server,
      task.id,
      'WAITING_ACCEPTANCE',
      'executing',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      task.id,
      'list-open-delivered-001',
    );
    pass(checks, 'delivered task remains in market and is not rescanned', {
      taskId: task.id,
      marketStatus: deliveredMarketTask.marketStatus,
    });

    const rejectedDelivery = await requestRevision(ds, order, '分页功能有 Bug');
    const revision = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: task.id },
      'status-revision-001',
    );
    const revisionEvent = findEvent(
      revision.events,
      MCPAgentTaskEventType.REVISION_REQUESTED,
    );
    assert(
      revisionEvent?.shouldAct === true,
      'REVISION_REQUESTED shouldAct should be true',
    );
    assert(
      revisionEvent.eventKey ===
        `${MCPAgentTaskEventType.REVISION_REQUESTED}:${order.id}:${rejectedDelivery.id}`,
      'REVISION_REQUESTED eventKey should include deliveryId',
      revisionEvent,
    );
    const repeatedRevision = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: task.id },
      'status-revision-002',
    );
    assert(
      findEvent(
        repeatedRevision.events,
        MCPAgentTaskEventType.REVISION_REQUESTED,
      )?.shouldAct === false,
      'REVISION_REQUESTED repeated shouldAct should be false',
    );
    pass(checks, 'REVISION_REQUESTED is keyed by delivery and consumed once', {
      eventKey: revisionEvent.eventKey,
    });

    await callTool(
      server,
      fixture.headers,
      'platform.artifact.attach',
      { taskId: task.id, resultSummary: '已修复分页问题', revision: true },
      'delivery-revision-001',
    );
    await completeOrder(ds, order);
    const completed = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: task.id },
      'status-completed-001',
    );
    const completedEvent = findEvent(
      completed.events,
      MCPAgentTaskEventType.ORDER_COMPLETED,
    );
    const deliveryAcceptedEvent = findEvent(
      completed.events,
      MCPAgentTaskEventType.DELIVERY_ACCEPTED,
    );
    assert(
      completedEvent?.shouldAct === true,
      'ORDER_COMPLETED shouldAct should be true',
    );
    assert(
      deliveryAcceptedEvent?.shouldAct === true,
      'DELIVERY_ACCEPTED shouldAct should be true',
    );
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.ORDER_COMPLETED,
      completedEvent.eventKey,
      MCPAgentTaskEventStatus.DELIVERED,
    );
    await assertPersistedEvent(
      eventsRepo,
      fixture.agent.id,
      MCPAgentTaskEventType.DELIVERY_ACCEPTED,
      deliveryAcceptedEvent.eventKey,
      MCPAgentTaskEventStatus.DELIVERED,
    );
    const completedMarketTask = await assertMarketStatus(
      server,
      task.id,
      'COMPLETED',
      'completed',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      task.id,
      'list-open-completed-001',
    );
    pass(checks, 'DELIVERY_ACCEPTED and ORDER_COMPLETED are persisted once', {
      deliveryAcceptedKey: deliveryAcceptedEvent.eventKey,
      completedKey: completedEvent.eventKey,
      marketStatus: completedMarketTask.marketStatus,
    });

    const rejectedTask = await createTask(ds, fixture, 'rejected-bid');
    await callTool(
      server,
      fixture.headers,
      'platform.quote.submit',
      { taskId: rejectedTask.id, priceCny: 180, planSummary: '报价失败测试' },
      'quote-rejected-submit-001',
    );
    const rejectedBid = await ds.getRepository(Bid).findOne({
      where: { task: { id: rejectedTask.id }, agent: { id: fixture.agent.id } },
      relations: ['task', 'agent'],
    });
    if (!fixture.bidIds.includes(rejectedBid.id))
      fixture.bidIds.push(rejectedBid.id);
    rejectedBid.status = BidStatus.REJECTED;
    await ds.getRepository(Bid).save(rejectedBid);
    const rejectedBidStatus = await callTool(
      server,
      fixture.headers,
      'platform.quote.get_my',
      { taskId: rejectedTask.id },
      'quote-rejected-my-001',
    );
    const bidRejectedEvent = findEvent(
      rejectedBidStatus.events,
      MCPAgentTaskEventType.BID_REJECTED,
    );
    assert(
      bidRejectedEvent?.shouldAct === true,
      'BID_REJECTED shouldAct should be true',
    );
    pass(checks, 'BID_REJECTED is generated for rejected bid state', {
      eventKey: bidRejectedEvent.eventKey,
    });

    const cancelled = await createAcceptedOrder(
      ds,
      fixture,
      'cancelled-order',
      OrderStatus.CANCELED,
    );
    const refunded = await createAcceptedOrder(
      ds,
      fixture,
      'refunded-order',
      OrderStatus.REFUNDED,
    );
    const dispute = await createAcceptedOrder(
      ds,
      fixture,
      'dispute-order',
      OrderStatus.ARBITRATING,
    );
    const arbitration = await ds.getRepository(Arbitration).save(
      ds.getRepository(Arbitration).create({
        order: dispute.order,
        reason: '质量争议',
        status: ArbitrationStatus.IN_PROGRESS,
      }),
    );
    const abnormalOrders = await callTool(
      server,
      fixture.headers,
      'platform.order.list_my',
      {},
      'orders-abnormal-001',
    );
    const cancelledEvent = findEvent(
      abnormalOrders.tasks.find((item) => item.orderId === cancelled.order.id)
        .events,
      MCPAgentTaskEventType.ORDER_CANCELLED,
    );
    const refundedEvent = findEvent(
      abnormalOrders.tasks.find((item) => item.orderId === refunded.order.id)
        .events,
      MCPAgentTaskEventType.ORDER_REFUNDED,
    );
    const disputeOpenedEvent = findEvent(
      abnormalOrders.tasks.find((item) => item.orderId === dispute.order.id)
        .events,
      MCPAgentTaskEventType.DISPUTE_OPENED,
    );
    assert(
      cancelledEvent?.shouldAct === true,
      'ORDER_CANCELLED shouldAct should be true',
    );
    assert(
      refundedEvent?.shouldAct === true,
      'ORDER_REFUNDED shouldAct should be true',
    );
    assert(
      disputeOpenedEvent?.shouldAct === true,
      'DISPUTE_OPENED shouldAct should be true',
    );
    const cancelledMarketTask = await assertMarketStatus(
      server,
      cancelled.task.id,
      'CANCELED',
      'abnormal',
    );
    const refundedMarketTask = await assertMarketStatus(
      server,
      refunded.task.id,
      'REFUNDED',
      'abnormal',
    );
    const disputeMarketTask = await assertMarketStatus(
      server,
      dispute.task.id,
      'ARBITRATING',
      'abnormal',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      cancelled.task.id,
      'list-open-cancelled-001',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      refunded.task.id,
      'list-open-refunded-001',
    );
    await assertNotInListOpen(
      server,
      fixture.headers,
      dispute.task.id,
      'list-open-arbitrating-001',
    );

    arbitration.status = ArbitrationStatus.RESOLVED;
    arbitration.resolution = ArbitrationResolution.REFUND;
    arbitration.resolvedAt = new Date();
    await ds.getRepository(Arbitration).save(arbitration);
    dispute.order.status = OrderStatus.REFUNDED;
    dispute.order.refundedAt = new Date();
    await ds.getRepository(Order).save(dispute.order);
    const resolvedOrders = await callTool(
      server,
      fixture.headers,
      'platform.order.list_my',
      {},
      'orders-dispute-resolved-001',
    );
    const resolvedDisputeItem = resolvedOrders.tasks.find(
      (item) => item.orderId === dispute.order.id,
    );
    const disputeResolvedEvent = findEvent(
      resolvedDisputeItem.events,
      MCPAgentTaskEventType.DISPUTE_RESOLVED,
    );
    assert(
      disputeResolvedEvent?.shouldAct === true,
      'DISPUTE_RESOLVED shouldAct should be true',
    );
    pass(checks, 'cancel/refund/dispute events are generated and persisted', {
      cancelledKey: cancelledEvent.eventKey,
      refundedKey: refundedEvent.eventKey,
      disputeOpenedKey: disputeOpenedEvent.eventKey,
      disputeResolvedKey: disputeResolvedEvent.eventKey,
      marketStatuses: [
        cancelledMarketTask.marketStatus,
        refundedMarketTask.marketStatus,
        disputeMarketTask.marketStatus,
      ],
    });

    const eventList = await callTool(
      server,
      fixture.headers,
      'platform.event.list_my',
      { status: ['PENDING', 'DELIVERED'], limit: 100 },
      'event-list-001',
    );
    assert(
      eventList.events.length >= 10,
      'event.list_my should return generated events',
      eventList,
    );
    assert(
      eventList.events.every((event) => event.shouldAct === false),
      'already delivered event.list_my entries should not become actionable again',
      eventList.events,
    );
    pass(
      checks,
      'platform.event.list_my returns persisted events without reactivating delivered ones',
      {
        count: eventList.events.length,
      },
    );

    const countsByType = await eventsRepo
      .createQueryBuilder('event')
      .select('event.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('event.agentId = :agentId', { agentId: fixture.agent.id })
      .groupBy('event.eventType')
      .getRawMany();
    console.log('\nHiClaw event consumption E2E checks passed:');
    console.table(
      checks.map((check) => ({ name: check.name, status: check.status })),
    );
    console.log(
      JSON.stringify(
        { countsByType, database: process.env.DATABASE_PATH },
        null,
        2,
      ),
    );
  } finally {
    console.log('[hiclaw-events] cleanup');
    await cleanup(ds, fixture);
    await app.close();
    console.log('[hiclaw-events] app closed');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[FAIL] HiClaw event consumption E2E failed:', error.message);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exit(1);
  });
