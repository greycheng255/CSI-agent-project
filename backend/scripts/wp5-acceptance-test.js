const request = require('supertest');

process.env.MCP_SERVER_TOKEN = process.env.MCP_SERVER_TOKEN || 'wp5-acceptance-token';
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
const { AgentCapability } = require('../src/agents/entities/agent-capability.entity');
const { AgentTag } = require('../src/agents/entities/agent-tag.entity');
const { AgentCard } = require('../src/agents/entities/agent-card.entity');
const { Task, TaskStatus } = require('../src/tasks/entities/task.entity');
const { Bid, BidStatus } = require('../src/bids/entities/bid.entity');
const { MCPToolInvocation } = require('../src/mcp/entities/mcp-tool-invocation.entity');

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

async function mcp(server, payload, token = process.env.MCP_SERVER_TOKEN) {
  const req = request(server).post('/mcp').send(payload);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

async function expectMcpSuccess(server, name, args, id) {
  const res = await mcp(server, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name, arguments: args },
    id,
  });
  assert([200, 201].includes(res.status), `${name} HTTP status failed`, res.body);
  assert(res.body?.jsonrpc === '2.0', `${name} did not return JSON-RPC 2.0`, res.body);
  assert(res.body?.result?.success === true, `${name} result failed`, res.body);
  return res.body.result.data;
}

async function seed(ds) {
  const users = ds.getRepository(User);
  const agents = ds.getRepository(Agent);
  const capabilities = ds.getRepository(AgentCapability);
  const tags = ds.getRepository(AgentTag);
  const cards = ds.getRepository(AgentCard);
  const tasks = ds.getRepository(Task);
  const bids = ds.getRepository(Bid);

  const suffix = `${Date.now()}`;
  const client = await users.save(users.create({
    displayName: `WP5 acceptance client ${suffix}`,
    phone: `15${suffix.slice(-9)}`.slice(0, 11),
    passwordHash: 'wp5-acceptance-test',
  }));
  const owner = await users.save(users.create({
    displayName: `WP5 acceptance owner ${suffix}`,
    phone: `14${suffix.slice(-9)}`.slice(0, 11),
    passwordHash: 'wp5-acceptance-test',
  }));

  const agent = await agents.save(agents.create({
    owner,
    name: `WP5 Carbon Agent ${suffix}`,
    description: 'WP5 MCP acceptance seeded Agent',
    webhookUrl: 'https://agent.example.com/webhook',
    skills: ['carbon', 'report'],
    status: AgentStatus.ONLINE,
    approvalStatus: AgentApprovalStatus.APPROVED,
    runtimeStatus: AgentRuntimeStatus.ONLINE,
    isActive: true,
    agentType: AgentType.SELF_HOSTED,
    agentMode: 'external',
    endpointUrl: 'https://agent.example.com/a2a/tasks',
    healthUrl: 'https://agent.example.com/health',
    authType: 'bearer',
    pricingModel: 'quote',
    basePrice: 100,
    currency: 'CNY',
    reputationScore: 5,
    visibility: 'public',
    approvedAt: new Date(),
    lastHeartbeatAt: new Date(),
  }));

  await capabilities.save([
    capabilities.create({ agent, capabilityType: 'domain', name: 'carbon' }),
    capabilities.create({ agent, capabilityType: 'skill', name: 'report' }),
  ]);
  await tags.save([
    tags.create({ agent, tag: 'wp5-acceptance', tagType: 'custom' }),
    tags.create({ agent, tag: 'carbon', tagType: 'domain' }),
  ]);
  await cards.save(cards.create({
    agent,
    schemaVersion: '1.0',
    version: '1.0.0',
    cardJson: {
      schema_version: '1.0',
      name: agent.name,
      description: agent.description,
      version: '1.0.0',
      endpoints: { task: agent.endpointUrl, health: agent.healthUrl },
      auth: { type: 'bearer' },
      capabilities: { domains: ['carbon'], skills: ['report'] },
      pricing: { model: 'quote', currency: 'CNY', minimum_price: 100 },
    },
    contentHash: `wp5-acceptance-${suffix}`,
    source: 'manual',
    isActive: true,
  }));

  const openTask = await tasks.save(tasks.create({
    client,
    clientUserId: client.id,
    title: `WP5 Open Task ${suffix}`,
    description: 'Open task for list/read MCP acceptance',
    acceptanceCriteria: 'Return a markdown report',
    budgetCny: 500,
    tags: ['wp5-acceptance'],
    skillsRequired: ['report'],
    attachmentUrls: ['https://files.example.com/input.pdf'],
    status: TaskStatus.OPEN,
  }));

  const orderTask = await tasks.save(tasks.create({
    client,
    clientUserId: client.id,
    title: `WP5 Order Task ${suffix}`,
    description: 'Task used by platform.order.create',
    acceptanceCriteria: 'Attach artifact URL',
    budgetCny: 800,
    tags: ['wp5-acceptance'],
    skillsRequired: ['report'],
    status: TaskStatus.OPEN,
  }));

  const quoteTask = await tasks.save(tasks.create({
    client,
    clientUserId: client.id,
    title: `WP5 Quote Task ${suffix}`,
    description: 'Task used by platform.quote.submit',
    acceptanceCriteria: 'Submit quote',
    budgetCny: 1200,
    status: TaskStatus.OPEN,
  }));

  const bid = await bids.save(bids.create({
    task: orderTask,
    agent,
    priceCny: 300,
    planSummary: 'Seeded bid for order create',
    pricingModel: 'quote',
    status: BidStatus.SUBMITTED,
    confidenceScore: 0.9,
    estimatedHours: 8,
    expiresAt: new Date(Date.now() + 86400000),
  }));

  return { client, owner, agent, openTask, orderTask, quoteTask, bid, suffix };
}

async function cleanup(ds, ids, requestPrefix) {
  const q = (sql, params = []) =>
    ds.query(sql, params).catch((error) =>
      console.warn('[cleanup]', error.message, sql),
    );

  if (requestPrefix) {
    await q(
      'DELETE FROM mcp_tool_invocations WHERE request_id LIKE $1 OR idempotency_key LIKE $1',
      [`${requestPrefix}%`],
    );
  }
  if (ids.orderId) {
    await q('DELETE FROM delivery_revisions WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id = $1)', [ids.orderId]);
    await q('DELETE FROM deliveries WHERE order_id = $1', [ids.orderId]);
    await q('DELETE FROM execution_traces WHERE order_id = $1', [ids.orderId]);
    await q('DELETE FROM execution_sub_tasks WHERE phase_id IN (SELECT id FROM execution_phases WHERE order_id = $1)', [ids.orderId]);
    await q('DELETE FROM execution_phases WHERE order_id = $1', [ids.orderId]);
    await q('DELETE FROM orders WHERE id = $1', [ids.orderId]);
  }
  if (ids.taskIds?.length) {
    await q('DELETE FROM bids WHERE task_id = ANY($1::uuid[])', [ids.taskIds]);
    await q('DELETE FROM webhook_deliveries WHERE task_id = ANY($1::uuid[])', [ids.taskIds]);
    await q('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [ids.taskIds]);
  }
  if (ids.agentId) {
    await q('DELETE FROM agent_heartbeats WHERE agent_id = $1', [ids.agentId]);
    await q('DELETE FROM agent_audit_logs WHERE agent_id = $1', [ids.agentId]);
    await q('DELETE FROM agent_cards WHERE agent_id = $1', [ids.agentId]);
    await q('DELETE FROM agent_capabilities WHERE agent_id = $1', [ids.agentId]);
    await q('DELETE FROM agent_tags WHERE agent_id = $1', [ids.agentId]);
    await q('DELETE FROM agents WHERE id = $1', [ids.agentId]);
  }
  if (ids.userIds?.length) {
    await q('DELETE FROM access_tokens WHERE user_id = ANY($1::uuid[])', [ids.userIds]);
    await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids.userIds]);
  }
}

async function main() {
  console.log('[wp5] compiling app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  console.log('[wp5] app initialized');

  const server = app.getHttpServer();
  const ds = app.get(DataSource);
  const checks = [];
  const ids = { taskIds: [], userIds: [] };
  let requestPrefix = null;

  try {
    const data = await seed(ds);
    ids.agentId = data.agent.id;
    ids.taskIds = [data.openTask.id, data.orderTask.id, data.quoteTask.id];
    ids.userIds = [data.client.id, data.owner.id];
    requestPrefix = `wp5-accept-${data.suffix}`;
    console.log('[wp5] data seeded', requestPrefix);

    const noToken = await mcp(server, { jsonrpc: '2.0', method: 'tools/list', id: 'auth-no-token' }, null);
    assert(noToken.status === 401, 'MCPAuthGuard did not reject missing token', noToken.body);
    pass(checks, 'MCPAuthGuard 拒绝无 Token 请求', { status: noToken.status });

    const listRes = await mcp(server, {
      jsonrpc: '2.0',
      method: 'tools/list',
      params: { arguments: { request_id: `${requestPrefix}-tools-list` } },
      id: 'tools-list',
    });
    assert([200, 201].includes(listRes.status), 'POST /mcp tools/list failed', listRes.body);
    assert(listRes.body?.jsonrpc === '2.0', 'POST /mcp did not return JSON-RPC response', listRes.body);
    pass(checks, 'MCP Server 启动在 POST /mcp', { status: listRes.status, jsonrpc: listRes.body.jsonrpc });

    const tools = listRes.body.result?.data?.tools || [];
    const expectedTools = [
      'platform.agent.search',
      'platform.agent.get',
      'platform.agent.report_health',
      'platform.task.get',
      'platform.task.list_open',
      'platform.order.create',
      'platform.order.get',
      'platform.order.update_execution',
      'platform.artifact.attach',
      'platform.quote.submit',
    ];
    assert(
      tools.length >= expectedTools.length,
      `tools/list returned ${tools.length}, expected at least ${expectedTools.length}`,
      tools,
    );
    for (const name of expectedTools) {
      const tool = tools.find((item) => item.name === name);
      assert(tool?.inputSchema, `tools/list missing schema for ${name}`, tools);
    }
    pass(checks, 'tools/list 返回所有基础 Tool 的 schema', { count: tools.length, names: tools.map((t) => t.name) });

    const search = await expectMcpSuccess(server, 'platform.agent.search', { query: 'Carbon', topK: 5, request_id: `${requestPrefix}-read-search` }, 'read-1');
    assert(search.total >= 1, 'platform.agent.search returned no agents', search);
    await expectMcpSuccess(server, 'platform.agent.get', { agent_id: data.agent.id, request_id: `${requestPrefix}-read-agent` }, 'read-2');
    await expectMcpSuccess(server, 'platform.task.get', { task_id: data.openTask.id, request_id: `${requestPrefix}-read-task` }, 'read-3');
    await expectMcpSuccess(server, 'platform.task.list_open', { limit: 10, offset: 0, request_id: `${requestPrefix}-read-open` }, 'read-4');

    const orderCreateArgs = {
      task_id: data.orderTask.id,
      agent_id: data.agent.id,
      bid_id: data.bid.id,
      idempotency_key: `${requestPrefix}-create-order`,
      request_id: `${requestPrefix}-write-create-order`,
    };
    const createdOrder = await expectMcpSuccess(server, 'platform.order.create', orderCreateArgs, 'write-1');
    assert(createdOrder.order?.id, 'platform.order.create did not create order', createdOrder);
    ids.orderId = createdOrder.order.id;

    const createdOrderRepeat = await expectMcpSuccess(server, 'platform.order.create', orderCreateArgs, 'write-1-repeat');
    assert(createdOrderRepeat.order?.id === createdOrder.order.id, 'idempotent create_order did not return cached order', { createdOrder, createdOrderRepeat });

    await expectMcpSuccess(server, 'platform.order.get', { order_id: createdOrder.order.id, request_id: `${requestPrefix}-read-order` }, 'read-5');
    pass(checks, '5 个读 Tool 可正常查询数据', {
      readTools: ['platform.agent.search', 'platform.agent.get', 'platform.task.get', 'platform.task.list_open', 'platform.order.get'],
    });

    await expectMcpSuccess(server, 'platform.order.update_execution', {
      order_id: createdOrder.order.id,
      status: 'RUNNING',
      progress: 25,
      message: 'WP5 acceptance progress',
      idempotency_key: `${requestPrefix}-update-execution`,
      request_id: `${requestPrefix}-write-update-execution`,
    }, 'write-2');
    await expectMcpSuccess(server, 'platform.artifact.attach', {
      order_id: createdOrder.order.id,
      artifacts: [{ url: `https://files.example.com/wp5-${data.suffix}.zip`, name: 'wp5.zip', type: 'archive' }],
      delivery_summary: 'WP5 acceptance artifact',
      idempotency_key: `${requestPrefix}-attach-artifact`,
      request_id: `${requestPrefix}-write-attach-artifact`,
    }, 'write-3');
    await expectMcpSuccess(server, 'platform.quote.submit', {
      task_id: data.quoteTask.id,
      agent_id: data.agent.id,
      price: 420,
      plan_summary: 'WP5 quote acceptance',
      idempotency_key: `${requestPrefix}-submit-quote`,
      request_id: `${requestPrefix}-write-submit-quote`,
    }, 'write-4');
    await expectMcpSuccess(server, 'platform.agent.report_health', {
      agent_id: data.agent.id,
      status: 'online',
      latency_ms: 33,
      load: 0.2,
      idempotency_key: `${requestPrefix}-report-health`,
      request_id: `${requestPrefix}-write-report-health`,
    }, 'write-5');
    pass(checks, '5 个写 Tool 可正常写入 + 幂等保护生效', {
      writeTools: ['platform.order.create', 'platform.order.update_execution', 'platform.artifact.attach', 'platform.quote.submit', 'platform.agent.report_health'],
      idempotentOrderId: createdOrderRepeat.order.id,
    });

    pass(checks, '重复请求（相同 idempotency_key）返回已缓存结果', {
      key: orderCreateArgs.idempotency_key,
      firstOrderId: createdOrder.order.id,
      repeatOrderId: createdOrderRepeat.order.id,
    });

    const invocations = await ds.getRepository(MCPToolInvocation).find({
      where: [
        { requestId: `${requestPrefix}-tools-list` },
        { requestId: `${requestPrefix}-read-search` },
        { requestId: `${requestPrefix}-read-agent` },
        { requestId: `${requestPrefix}-read-task` },
        { requestId: `${requestPrefix}-read-open` },
        { requestId: `${requestPrefix}-write-create-order` },
        { requestId: `${requestPrefix}-read-order` },
        { requestId: `${requestPrefix}-write-update-execution` },
        { requestId: `${requestPrefix}-write-attach-artifact` },
        { requestId: `${requestPrefix}-write-submit-quote` },
        { requestId: `${requestPrefix}-write-report-health` },
      ],
      order: { createdAt: 'ASC' },
    });
    const invocationToolNames = invocations.map((item) => item.toolName);
    const firstCallTools = ['tools/list', ...expectedTools];
    for (const name of firstCallTools) {
      assert(invocationToolNames.includes(name), `mcp_tool_invocations missing ${name}`, invocationToolNames);
    }
    const createOrderRows = invocations.filter((item) => item.idempotencyKey === orderCreateArgs.idempotency_key);
    assert(createOrderRows.length === 1, 'idempotency key should have exactly one persisted success row', createOrderRows);
    pass(checks, '所有调用写入 mcp_tool_invocations 表', {
      auditedFirstCallTools: firstCallTools,
      matchedRows: invocations.length,
      note: '重复幂等命中复用已有成功记录，不额外插入相同 idempotency_key 行',
    });

    pass(checks, 'HiClaw Controller 可成功调用所有 Tool', {
      calledTools: expectedTools,
      protocol: 'JSON-RPC 2.0 over POST /mcp with Bearer token',
    });

    console.log(JSON.stringify({ ok: true, checks }, null, 2));
  } finally {
    await cleanup(ds, ids, requestPrefix);
    await app.close();
    console.log('[wp5] cleanup complete');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      message: error.message,
      details: error.details,
      stack: error.stack,
    }, null, 2));
    process.exit(1);
  });
