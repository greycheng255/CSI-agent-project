const request = require('supertest');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] ??= value;
  }
}

if (!process.env.DB_HOST && !process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.join(tmpDir, 'hiclaw-mcp-workflow.sqlite');
}
process.env.DB_SYNC = process.env.DB_SYNC || 'true';
process.env.APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Shanghai';
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

require('reflect-metadata');
require('ts-node/register');

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
const { AgentCredential } = require('../src/agents/entities/agent-credential.entity');
const { Task, TaskStatus } = require('../src/tasks/entities/task.entity');
const { Bid, BidStatus } = require('../src/bids/entities/bid.entity');
const { Order, OrderStatus } = require('../src/orders/entities/order.entity');
const { Delivery, DeliveryStatus } = require('../src/orders/entities/delivery.entity');

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
  assert(res.status === 200 || res.status === 201, `${name} HTTP failed`, res.body);
  assert(res.body?.jsonrpc === '2.0', `${name} did not return JSON-RPC`, res.body);
  assert(res.body?.result?.success === true, `${name} failed`, res.body);
  return res.body.result.data;
}

async function seed(ds) {
  const suffix = `${Date.now()}`.slice(-8);
  const users = ds.getRepository(User);
  const agents = ds.getRepository(Agent);
  const credentials = ds.getRepository(AgentCredential);
  const tasks = ds.getRepository(Task);

  const client = await users.save(
    users.create({
      displayName: `HiClaw Client ${suffix}`,
      phone: `13${suffix}`.slice(0, 11),
      passwordHash: 'hiclaw-workflow-test',
    }),
  );
  const owner = await users.save(
    users.create({
      displayName: `HiClaw Owner ${suffix}`,
      phone: `14${suffix}`.slice(0, 11),
      passwordHash: 'hiclaw-workflow-test',
    }),
  );
  const agent = await agents.save(
    agents.create({
      owner,
      name: `HiClaw Agent ${suffix}`,
      description: 'HiClaw MCP workflow fixture agent',
      externalId: `hiclaw-agent-${suffix}`,
      skills: ['react', 'typescript', 'antd'],
      status: AgentStatus.ONLINE,
      approvalStatus: AgentApprovalStatus.APPROVED,
      runtimeStatus: AgentRuntimeStatus.ONLINE,
      isActive: true,
      agentType: AgentType.SELF_HOSTED,
      visibility: 'public',
    }),
  );

  const apiKey = `sk-hiclaw-${suffix}`;
  await credentials.save(
    credentials.create({
      agent,
      name: 'HiClaw workflow key',
      keyId: `ak_hiclaw_${suffix}`,
      secretHash: createHash('sha256').update(apiKey).digest('hex'),
      scopes: ['*'],
      status: 'active',
      revokedAt: null,
      lastUsedAt: null,
    }),
  );

  const task = await tasks.save(
    tasks.create({
      client,
      clientUserId: client.id,
      title: `HiClaw React 管理后台 ${suffix}`,
      description: '开发一个包含用户管理、权限控制、数据看板的 React 后台',
      acceptanceCriteria: '用户 CRUD\nRBAC 权限\n数据看板',
      budgetCny: 500,
      expectedDeliveryAt: new Date('2026-07-15T00:00:00Z'),
      tags: ['frontend'],
      skillsRequired: ['react', 'typescript', 'antd'],
      attachmentUrls: ['https://platform.example.com/files/requirements.pdf'],
      status: TaskStatus.OPEN,
    }),
  );

  return {
    headers: { agentId: agent.externalId, apiKey },
    client,
    owner,
    agent,
    task,
  };
}

async function acceptBid(ds, fixture) {
  const bids = ds.getRepository(Bid);
  const tasks = ds.getRepository(Task);
  const orders = ds.getRepository(Order);
  const bid = await bids.findOne({
    where: { task: { id: fixture.task.id }, agent: { id: fixture.agent.id } },
    relations: ['task', 'agent', 'agent.owner'],
  });
  assert(bid, 'Bid not found after quote submit');
  bid.status = BidStatus.ACCEPTED;
  await bids.save(bid);

  fixture.task.status = TaskStatus.CLOSED;
  await tasks.save(fixture.task);

  return orders.save(
    orders.create({
      task: fixture.task,
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
  await orders.save(order);
}

async function completeOrder(ds, order) {
  const orders = ds.getRepository(Order);
  order.status = OrderStatus.COMPLETED;
  order.releasedAt = new Date();
  return orders.save(order);
}

async function main() {
  const checks = [];
  console.log('[hiclaw] compiling app');
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  console.log('[hiclaw] initializing app');
  await app.init();
  console.log('[hiclaw] app initialized');
  const server = app.getHttpServer();
  const ds = app.get(DataSource);

  try {
    console.log('[hiclaw] seeding data');
    const fixture = await seed(ds);
    console.log('[hiclaw] data seeded', fixture.task.id);

    const initialize = await mcp(server, fixture.headers, {
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
      id: 'init-001',
    });
    assert(initialize.body?.result?.data?.capabilities?.tools, 'initialize failed', initialize.body);
    pass(checks, 'initialize', initialize.body.result.data.serverInfo);

    const tools = await mcp(server, fixture.headers, {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 'tools-001',
    });
    assert(
      tools.body?.result?.data?.tools?.some((tool) => tool.name === 'platform.task.get_status'),
      'tools/list missing HiClaw tools',
      tools.body,
    );
    pass(checks, 'tools/list exposes HiClaw platform tools', {
      count: tools.body.result.data.tools.length,
    });

    const openTasks = await callTool(
      server,
      fixture.headers,
      'platform.task.list_open',
      { skills: ['react'], page: 1, pageSize: 20 },
      'list-open-001',
    );
    assert(openTasks.tasks.some((task) => task.taskId === fixture.task.id), 'open task missing');
    pass(checks, 'platform.task.list_open', { total: openTasks.total });

    await callTool(
      server,
      fixture.headers,
      'platform.task.get',
      { taskId: fixture.task.id },
      'task-get-001',
    );
    pass(checks, 'platform.task.get', { taskId: fixture.task.id });

    const quote = await callTool(
      server,
      fixture.headers,
      'platform.quote.submit',
      {
        taskId: fixture.task.id,
        agentId: fixture.agent.externalId,
        priceCny: 150,
        planSummary: 'React + Vite + Antd 方案',
      },
      'quote-submit-001',
    );
    assert(quote.status === 'PENDING', 'quote status should be PENDING', quote);
    pass(checks, 'platform.quote.submit', { bidId: quote.bidId });

    const duplicate = await mcp(server, fixture.headers, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'platform.quote.submit',
        arguments: { taskId: fixture.task.id, priceCny: 150 },
      },
      id: 'quote-duplicate-001',
    });
    assert(
      duplicate.body?.result?.error?.code === 'DUPLICATE_BID',
      'duplicate quote should return DUPLICATE_BID',
      duplicate.body,
    );
    pass(checks, 'duplicate quote returns DUPLICATE_BID', duplicate.body.result.error.details);

    const order = await acceptBid(ds, fixture);
    const myBid = await callTool(
      server,
      fixture.headers,
      'platform.quote.get_my',
      { taskId: fixture.task.id },
      'quote-get-my-001',
    );
    assert(myBid.status === 'ACCEPTED', 'my bid should be ACCEPTED', myBid);
    pass(checks, 'platform.quote.get_my accepted', { bidId: myBid.bidId });

    await callTool(
      server,
      fixture.headers,
      'platform.order.update_execution',
      { taskId: fixture.task.id, phase: '核心开发', progress: 60 },
      'progress-001',
    );
    pass(checks, 'platform.order.update_execution', { progress: 60 });

    await callTool(
      server,
      fixture.headers,
      'platform.artifact.attach',
      {
        taskId: fixture.task.id,
        resultSummary: '已完成管理后台开发',
        previewUrl: 'https://preview.example.com/hiclaw',
      },
      'deliver-001',
    );
    pass(checks, 'platform.artifact.attach initial delivery', { taskId: fixture.task.id });

    const waiting = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: fixture.task.id },
      'status-waiting-001',
    );
    assert(waiting.status === 'WAITING_ACCEPTANCE', 'status should be WAITING_ACCEPTANCE', waiting);
    pass(checks, 'platform.task.get_status waiting acceptance', waiting);

    await requestRevision(ds, order, '分页功能有 Bug');
    const revision = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: fixture.task.id },
      'status-revision-001',
    );
    assert(revision.status === 'REVISION_REQUESTED', 'status should be REVISION_REQUESTED', revision);
    pass(checks, 'platform.task.get_status revision requested', revision);

    await callTool(
      server,
      fixture.headers,
      'platform.artifact.attach',
      { taskId: fixture.task.id, resultSummary: '已修复分页问题', revision: true },
      'deliver-revision-001',
    );
    await completeOrder(ds, order);
    const completed = await callTool(
      server,
      fixture.headers,
      'platform.task.get_status',
      { taskId: fixture.task.id },
      'status-completed-001',
    );
    assert(completed.status === 'COMPLETED', 'status should be COMPLETED', completed);
    pass(checks, 'platform.task.get_status completed', completed);

    console.log('\nHiClaw MCP workflow checks passed:');
    console.table(checks.map((check) => ({ name: check.name, status: check.status })));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[FAIL] HiClaw MCP workflow test failed:', error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
