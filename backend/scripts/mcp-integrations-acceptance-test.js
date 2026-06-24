const request = require('supertest');
const { hashSync } = require('bcryptjs');
const http = require('http');

process.env.MCP_SERVER_TOKEN = process.env.MCP_SERVER_TOKEN || 'mcp-integrations-test-token';
process.env.APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Shanghai';
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

require('reflect-metadata');
require('ts-node/register');

const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('../src/app.module');
const { Admin, AdminLevel, AdminStatus } = require('../src/admin/entities/admin.entity');
const { AdminAuthService } = require('../src/admin/admin-auth.service');
const { User } = require('../src/users/entities/user.entity');
const { Task, TaskStatus } = require('../src/tasks/entities/task.entity');
const { Order, OrderStatus } = require('../src/orders/entities/order.entity');

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

function createMockMCPServer() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      if (payload.method === 'tools/list') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              tools: [
                {
                  name: 'mock_task_submit',
                  description: 'Submit a mock external task',
                  inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
                },
                {
                  name: 'mock_task_status',
                  description: 'Get mock external task status',
                  inputSchema: { type: 'object', properties: { task_id: { type: 'string' } } },
                },
              ],
            },
          }),
        );
        return;
      }
      if (payload.method === 'tools/call' && payload.params?.name === 'mock_task_submit') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              structuredContent: {
                code: 200,
                data: { task_id: 'mock-external-task-001' },
              },
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ code: 200, data: { task_id: 'mock-external-task-001' } }),
                },
              ],
              isError: false,
            },
          }),
        );
        return;
      }
      if (payload.method === 'tools/call' && payload.params?.name === 'mock_task_status') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: payload.id,
            result: {
              structuredContent: {
                code: 200,
                data: {
                  task_id: payload.params.arguments.task_id,
                  status: 'completed',
                  is_final: true,
                  progress: '100%',
                  result_url: 'https://files.example.com/mock-mcp-result.md',
                  result_data: { summary: 'Mock MCP delivery result' },
                  cost: 1,
                  error: '',
                },
              },
              isError: false,
            },
          }),
        );
        return;
      }
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            isError: true,
            content: [{ type: 'text', text: 'Unknown mock tool' }],
          },
        }),
      );
    });
  });
}

async function main() {
  const checks = [];
  console.log('[mcp-integrations] compiling app');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  console.log('[mcp-integrations] app initialized');

  const ds = app.get(DataSource);
  const adminAuth = app.get(AdminAuthService);
  const admins = ds.getRepository(Admin);
  const users = ds.getRepository(User);
  const tasks = ds.getRepository(Task);
  const orders = ds.getRepository(Order);
  const suffix = `${Date.now()}`;
  const admin = await admins.save(
    admins.create({
      username: `mcp-integrations-${suffix}`,
      passwordHash: hashSync('mcp-integrations-test', 10),
      level: AdminLevel.SUPER,
      status: AdminStatus.ACTIVE,
      phone: '',
      email: '',
      displayName: 'MCP Integrations Acceptance',
      permissions: '[]',
      createdBy: '',
    }),
  );
  const token = await adminAuth.issueToken(admin, '127.0.0.1', 'mcp-integrations-test');
  const server = app.getHttpServer();
  const mockMCP = createMockMCPServer();
  await new Promise((resolve) => mockMCP.listen(0, '127.0.0.1', resolve));
  const mockEndpoint = `http://127.0.0.1:${mockMCP.address().port}/mcp`;
  const get = (url) => request(server).get(url).set('Authorization', `Bearer ${token}`);
  const post = (url) => request(server).post(url).set('Authorization', `Bearer ${token}`);
  const patch = (url) => request(server).patch(url).set('Authorization', `Bearer ${token}`);
  let openNotebookId = null;
  let hiclawId = null;
  let hiclawTokenIssued = false;
  const cleanup = {
    appId: null,
    orderId: null,
    taskId: null,
    userIds: [],
  };

  try {
    console.log('[mcp-integrations] GET apps');
    const listRes = await get('/api/v1/admin/mcp-integrations/apps');
    assert(listRes.status === 200, 'apps list status failed', listRes.body);
    const apps = listRes.body.data || [];
    const openNotebook = apps.find((item) => item.code === 'opennotebook');
    const hiclaw = apps.find((item) => item.code === 'hiclaw-controller');
    assert(openNotebook, 'OpenNotebook app missing', apps);
    assert(hiclaw, 'HiClaw Controller app missing', apps);
    openNotebookId = openNotebook.id;
    hiclawId = hiclaw.id;
    pass(checks, '阶段一：默认应用可见', {
      codes: apps.map((item) => item.code),
    });

    const updatedEndpoint = 'https://api.opennotebook.chat/api/v1/agent/mcp/';
    console.log('[mcp-integrations] PATCH OpenNotebook config');
    const updateRes = await patch(`/api/v1/admin/mcp-integrations/apps/${openNotebook.id}`)
      .send({
        endpointUrl: updatedEndpoint,
        transport: 'streamable-http',
        authMode: 'none',
        defaultWorkspaceId: 'acceptance-workspace',
        defaultTenantId: 'acceptance-tenant',
      });
    assert(updateRes.status === 200, 'app update status failed', updateRes.body);
    assert(updateRes.body.data.endpointUrl === updatedEndpoint, 'endpoint not saved', updateRes.body);
    assert(updateRes.body.data.defaultWorkspaceId === 'acceptance-workspace', 'workspace not saved', updateRes.body);
    pass(checks, '阶段一：应用配置可保存', {
      app: updateRes.body.data.code,
      endpointUrl: updateRes.body.data.endpointUrl,
    });

    console.log('[mcp-integrations] toggle HiClaw');
    const disableRes = await post(`/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/disable`);
    assert(disableRes.status === 201, 'disable status failed', disableRes.body);
    assert(disableRes.body.data.enabled === false, 'disable did not persist', disableRes.body);
    const enableRes = await post(`/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/enable`);
    assert(enableRes.status === 201, 'enable status failed', enableRes.body);
    assert(enableRes.body.data.enabled === true, 'enable did not persist', enableRes.body);
    pass(checks, '阶段一：应用启停可切换', {
      app: enableRes.body.data.code,
      enabled: enableRes.body.data.enabled,
    });

    console.log('[mcp-integrations] discover OpenNotebook tools');
    const discoverRes = await post(`/api/v1/admin/mcp-integrations/apps/${openNotebook.id}/discover-tools`)
      .send({});
    assert(discoverRes.status === 201, 'discover status failed', discoverRes.body);
    const discovered = discoverRes.body.tools || [];
    const discoveredNames = discovered.map((item) => item.name);
    for (const name of [
      'opennotebook_agent_catalog',
      'opennotebook_agent_generate',
      'opennotebook_agent_status',
      'opennotebook_framedirector_render_approve',
    ]) {
      assert(discoveredNames.includes(name), `${name} not discovered`, discoveredNames);
    }
    pass(checks, '阶段二：OpenNotebook Tool 可发现并保存', {
      count: discovered.length,
      names: discoveredNames,
    });

    console.log('[mcp-integrations] read saved tools');
    const savedToolsRes = await get(
      `/api/v1/admin/mcp-integrations/apps/${openNotebook.id}/tools?direction=external`,
    );
    assert(savedToolsRes.status === 200, 'saved tools status failed', savedToolsRes.body);
    assert(savedToolsRes.body.data.length >= 4, 'saved tools not persisted', savedToolsRes.body);
    pass(checks, '阶段二：页面刷新后可读取已保存 Tool', {
      count: savedToolsRes.body.data.length,
    });

    console.log('[mcp-integrations] read platform tools');
    const platformToolsRes = await get(
      `/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/platform-tools`,
    );
    assert(platformToolsRes.status === 200, 'platform tools status failed', platformToolsRes.body);
    const platformToolNames = platformToolsRes.body.data.map((item) => item.name);
    assert(platformToolNames.includes('platform.task.list_open'), 'platform tool missing', platformToolNames);
    pass(checks, '阶段三：平台开放 Tool 白名单可展示', {
      count: platformToolNames.length,
      includes: 'platform.task.list_open',
    });

    console.log('[mcp-integrations] issue HiClaw inbound token');
    const tokenRes = await post(`/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/token`);
    assert(tokenRes.status === 201, 'inbound token issue failed', tokenRes.body);
    assert(typeof tokenRes.body.token === 'string' && tokenRes.body.token.startsWith('mcp_'), 'invalid issued token', tokenRes.body);
    hiclawTokenIssued = true;
    const hiclawInboundToken = tokenRes.body.token;

    const appToolsListRes = await request(server)
      .post('/mcp')
      .set('Authorization', `Bearer ${hiclawInboundToken}`)
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 'hiclaw-tools-list' });
    assert([200, 201].includes(appToolsListRes.status), 'app token tools/list HTTP failed', appToolsListRes.body);
    const appListedTools = appToolsListRes.body.result?.data?.tools?.map((item) => item.name) || [];
    assert(appListedTools.includes('platform.task.list_open'), 'app token tools/list missing allowed tool', appToolsListRes.body);
    pass(checks, '阶段三：应用级 Token 可访问授权平台 Tool 列表', {
      toolCount: appListedTools.length,
      includes: 'platform.task.list_open',
    });

    const disableTaskListRes = await patch(
      `/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/platform-tools/platform.task.list_open`,
    ).send({ enabled: false });
    assert(disableTaskListRes.status === 200, 'disable platform tool permission failed', disableTaskListRes.body);
    const forbiddenCallRes = await request(server)
      .post('/mcp')
      .set('Authorization', `Bearer ${hiclawInboundToken}`)
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'platform.task.list_open',
          arguments: { limit: 1, offset: 0, request_id: `forbidden-${suffix}` },
        },
        id: 'forbidden-call',
      });
    assert([200, 201].includes(forbiddenCallRes.status), 'forbidden call HTTP failed', forbiddenCallRes.body);
    assert(forbiddenCallRes.body.result?.success === false, 'forbidden call unexpectedly succeeded', forbiddenCallRes.body);
    assert(forbiddenCallRes.body.result?.error?.code === 'TOOL_FORBIDDEN', 'forbidden call code mismatch', forbiddenCallRes.body);
    pass(checks, '阶段三：未授权平台 Tool 会被应用级 Token 拒绝', {
      code: forbiddenCallRes.body.result.error.code,
    });

    const enableTaskListRes = await patch(
      `/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/platform-tools/platform.task.list_open`,
    ).send({ enabled: true });
    assert(enableTaskListRes.status === 200, 're-enable platform tool permission failed', enableTaskListRes.body);
    const allowedCallRes = await request(server)
      .post('/mcp')
      .set('Authorization', `Bearer ${hiclawInboundToken}`)
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'platform.task.list_open',
          arguments: { limit: 1, offset: 0, request_id: `allowed-${suffix}` },
        },
        id: 'allowed-call',
      });
    assert([200, 201].includes(allowedCallRes.status), 'allowed call HTTP failed', allowedCallRes.body);
    assert(allowedCallRes.body.result?.success === true, 'allowed call failed', allowedCallRes.body);
    const callerRows = await ds.query(
      `SELECT caller FROM mcp_tool_invocations WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [`allowed-${suffix}`],
    );
    assert(callerRows[0]?.caller === 'mcp-app:hiclaw-controller', 'app caller not audited', callerRows);
    pass(checks, '阶段三：授权平台 Tool 可用应用级 Token 调用并记录 app caller', {
      caller: callerRows[0].caller,
      tool: 'platform.task.list_open',
    });

    console.log('[mcp-integrations] sync catalog');
    const catalogRes = await post(`/api/v1/admin/mcp-integrations/apps/${openNotebook.id}/sync-capabilities`)
      .send({});
    assert(catalogRes.status === 201, 'sync capabilities status failed', catalogRes.body);
    const capabilities = catalogRes.body.capabilities || [];
    const workflowCount = capabilities.filter((item) => item.capabilityType === 'workflow').length;
    const modelCount = capabilities.filter((item) => item.capabilityType === 'model').length;
    assert(workflowCount >= 6, 'workflow capabilities missing', catalogRes.body);
    assert(modelCount >= 5, 'model capabilities missing', catalogRes.body);
    pass(checks, '阶段五前置：OpenNotebook catalog 可同步并保存能力', {
      workflowCount,
      modelCount,
    });

    console.log('[mcp-integrations] call catalog');
    const externalCallRes = await post(`/api/v1/admin/mcp-integrations/apps/${openNotebook.id}/test/external-call`)
      .send({
        name: 'opennotebook_agent_catalog',
        arguments: {},
      });
    assert(externalCallRes.status === 201, 'external call status failed', externalCallRes.body);
    assert(externalCallRes.body.ok === true, 'catalog call not ok', externalCallRes.body);
    pass(checks, '阶段四：平台到 OpenNotebook 调用测试成功', {
      statusCode: externalCallRes.body.statusCode,
      durationMs: externalCallRes.body.durationMs,
    });

    console.log('[mcp-integrations] call invalid status');
    const invalidStatusRes = await post(`/api/v1/admin/mcp-integrations/apps/${openNotebook.id}/test/external-call`)
      .send({
        name: 'opennotebook_agent_status',
        arguments: { task_id: 'codex-nonexistent-task' },
      });
    assert(invalidStatusRes.status === 201, 'invalid status call HTTP failed', invalidStatusRes.body);
    assert(invalidStatusRes.body.ok === false, 'isError was not marked failed', invalidStatusRes.body);
    pass(checks, '阶段四：result.isError 会标记为 failed', {
      ok: invalidStatusRes.body.ok,
      statusCode: invalidStatusRes.body.statusCode,
    });

    console.log('[mcp-integrations] simulate platform call');
    const platformCallRes = await post(`/api/v1/admin/mcp-integrations/apps/${hiclaw.id}/test/platform-call`)
      .send({
        name: 'platform.task.list_open',
        arguments: { limit: 1, offset: 0, request_id: `mcp-integrations-${suffix}` },
      });
    assert(platformCallRes.status === 201, 'platform call status failed', platformCallRes.body);
    assert(platformCallRes.body.result?.success === true, 'platform call result failed', platformCallRes.body);
    pass(checks, '阶段四：外部应用到平台模拟调用成功', {
      tool: 'platform.task.list_open',
    });

    console.log('[mcp-integrations] read invocations');
    const invocationsRes = await get(
      `/api/v1/admin/mcp-integrations/invocations?appId=${openNotebook.id}&limit=20`,
    );
    assert(invocationsRes.status === 200, 'invocations status failed', invocationsRes.body);
    assert(invocationsRes.body.pagination.total >= 3, 'invocations not recorded', invocationsRes.body);
    pass(checks, '阶段四：调用测试写入审计', {
      total: invocationsRes.body.pagination.total,
    });

    console.log('[mcp-integrations] create mock MCP app and platform order');
    const mockAppRes = await post('/api/v1/admin/mcp-integrations/apps').send({
      code: `mock-mcp-${suffix}`,
      name: `Mock MCP ${suffix}`,
      description: 'Mock app for task binding acceptance',
      direction: 'bidirectional',
      transport: 'streamable-http',
      endpointUrl: mockEndpoint,
      authMode: 'none',
      enabled: true,
    });
    assert(mockAppRes.status === 201, 'mock app create failed', mockAppRes.body);
    const mockApp = mockAppRes.body.data;
    cleanup.appId = mockApp.id;

    console.log('[mcp-integrations] validate per-app platform tool rate limit');
    const mockTokenRes = await post(`/api/v1/admin/mcp-integrations/apps/${mockApp.id}/token`);
    assert(mockTokenRes.status === 201, 'mock app inbound token issue failed', mockTokenRes.body);
    assert(typeof mockTokenRes.body.token === 'string' && mockTokenRes.body.token.startsWith('mcp_'), 'invalid mock app token', mockTokenRes.body);
    const mockInboundToken = mockTokenRes.body.token;
    const rateLimitPermissionRes = await patch(
      `/api/v1/admin/mcp-integrations/apps/${mockApp.id}/platform-tools/platform.task.list_open`,
    ).send({ enabled: true, rateLimitPerMinute: 1 });
    assert(rateLimitPermissionRes.status === 200, 'rate limit permission update failed', rateLimitPermissionRes.body);

    const rateLimitFirstRes = await request(server)
      .post('/mcp')
      .set('Authorization', `Bearer ${mockInboundToken}`)
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'platform.task.list_open',
          arguments: { limit: 1, offset: 0, request_id: `rate-limit-first-${suffix}` },
        },
        id: 'rate-limit-first',
      });
    assert([200, 201].includes(rateLimitFirstRes.status), 'rate limit first call HTTP failed', rateLimitFirstRes.body);
    assert(rateLimitFirstRes.body.result?.success === true, 'rate limit first call failed', rateLimitFirstRes.body);

    const rateLimitSecondRes = await request(server)
      .post('/mcp')
      .set('Authorization', `Bearer ${mockInboundToken}`)
      .send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'platform.task.list_open',
          arguments: { limit: 1, offset: 0, request_id: `rate-limit-second-${suffix}` },
        },
        id: 'rate-limit-second',
      });
    assert([200, 201].includes(rateLimitSecondRes.status), 'rate limit second call HTTP failed', rateLimitSecondRes.body);
    assert(rateLimitSecondRes.body.result?.success === false, 'rate limit second call unexpectedly succeeded', rateLimitSecondRes.body);
    assert(rateLimitSecondRes.body.result?.error?.code === 'RATE_LIMITED', 'rate limit error code mismatch', rateLimitSecondRes.body);
    pass(checks, '阶段三：应用级平台 Tool 限流生效', {
      tool: 'platform.task.list_open',
      limitPerMinute: 1,
      code: rateLimitSecondRes.body.result.error.code,
    });

    const client = await users.save(users.create({
      displayName: `MCP Client ${suffix}`,
      phone: `13${suffix.slice(-9)}`.slice(0, 11),
      passwordHash: 'mcp-integrations-test',
    }));
    const owner = await users.save(users.create({
      displayName: `MCP Owner ${suffix}`,
      phone: `12${suffix.slice(-9)}`.slice(0, 11),
      passwordHash: 'mcp-integrations-test',
    }));
    cleanup.userIds.push(client.id, owner.id);

    const task = await tasks.save(tasks.create({
      client,
      clientUserId: client.id,
      title: `MCP Binding Task ${suffix}`,
      description: 'Task used by MCP binding acceptance',
      acceptanceCriteria: 'Return a result URL',
      budgetCny: 500,
      tags: ['mcp-binding'],
      skillsRequired: ['mock'],
      status: TaskStatus.OPEN,
    }));
    cleanup.taskId = task.id;

    const order = await orders.save(orders.create({
      task,
      client,
      owner,
      clientUserId: client.id,
      ownerUserId: owner.id,
      bidId: null,
      amountCny: 300,
      platformFeeRate: 0,
      status: OrderStatus.IN_PROGRESS,
      escrowedAt: new Date(),
      platformFeeCny: 0,
      payoutCny: 300,
      deliveryCount: 0,
      maxDeliveryAttempts: 3,
    }));
    cleanup.orderId = order.id;

    const submitBindingRes = await post(
      `/api/v1/admin/mcp-integrations/apps/${mockApp.id}/task-bindings/submit`,
    ).send({
      platformTaskId: task.id,
      platformOrderId: order.id,
      toolName: 'mock_task_submit',
      arguments: { title: task.title },
    });
    assert(submitBindingRes.status === 201, 'task binding submit failed', submitBindingRes.body);
    assert(
      submitBindingRes.body.binding?.externalTaskId === 'mock-external-task-001',
      'external task id not saved',
      submitBindingRes.body,
    );
    pass(checks, '阶段五：真实任务提交后保存 external_task_id 绑定关系', {
      bindingId: submitBindingRes.body.binding.id,
      externalTaskId: submitBindingRes.body.binding.externalTaskId,
      platformOrderId: submitBindingRes.body.binding.platformOrderId,
    });

    const pollBindingRes = await post(
      `/api/v1/admin/mcp-integrations/task-bindings/${submitBindingRes.body.binding.id}/poll`,
    ).send({
      statusToolName: 'mock_task_status',
      deliverOnFinal: true,
    });
    assert(pollBindingRes.status === 201, 'task binding poll failed', pollBindingRes.body);
    assert(pollBindingRes.body.binding?.status === 'completed', 'binding status not synced', pollBindingRes.body);
    assert(
      pollBindingRes.body.binding?.resultUrl === 'https://files.example.com/mock-mcp-result.md',
      'binding result url not synced',
      pollBindingRes.body,
    );
    const deliveredOrder = await orders.findOne({ where: { id: order.id } });
    const deliveries = await ds.query('SELECT id, attachment_url, evidence_bundle FROM deliveries WHERE order_id = $1', [order.id]);
    assert(deliveredOrder?.status === OrderStatus.DELIVERED, 'order not delivered', deliveredOrder);
    assert(deliveries.length === 1, 'delivery not created', deliveries);
    assert(
      deliveries[0].attachment_url === 'https://files.example.com/mock-mcp-result.md',
      'delivery result url mismatch',
      deliveries,
    );
    pass(checks, '阶段五：外部任务完成后生成平台执行交付结果', {
      orderId: order.id,
      orderStatus: deliveredOrder.status,
      deliveryId: deliveries[0].id,
      attachmentUrl: deliveries[0].attachment_url,
    });

    console.log(JSON.stringify({ ok: true, checks }, null, 2));
  } finally {
    if (cleanup.orderId) {
      await ds.query('DELETE FROM delivery_revisions WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_id = $1)', [cleanup.orderId]).catch(() => undefined);
      await ds.query('DELETE FROM deliveries WHERE order_id = $1', [cleanup.orderId]).catch(() => undefined);
      await ds.query('DELETE FROM orders WHERE id = $1', [cleanup.orderId]).catch(() => undefined);
    }
    if (cleanup.taskId) {
      await ds.query('DELETE FROM tasks WHERE id = $1', [cleanup.taskId]).catch(() => undefined);
    }
    if (cleanup.userIds.length) {
      await ds.query('DELETE FROM access_tokens WHERE user_id = ANY($1::uuid[])', [cleanup.userIds]).catch(() => undefined);
      await ds.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [cleanup.userIds]).catch(() => undefined);
    }
    if (cleanup.appId) {
      await ds.query('DELETE FROM mcp_app_integrations WHERE id = $1', [cleanup.appId]).catch(() => undefined);
    }
    if (openNotebookId) {
      await ds
        .query(
          `UPDATE mcp_app_integrations
           SET endpoint_url = $1,
               auth_mode = 'none',
               transport = 'streamable-http',
               default_workspace_id = NULL,
               default_tenant_id = NULL,
               enabled = TRUE
           WHERE id = $2`,
          ['https://api.opennotebook.chat/api/v1/agent/mcp/', openNotebookId],
        )
        .catch(() => undefined);
    }
    if (hiclawId) {
      await ds
        .query(
          `UPDATE mcp_app_tool_permissions
           SET enabled = TRUE
           WHERE app_id = $1 AND tool_name = 'platform.task.list_open'`,
          [hiclawId],
        )
        .catch(() => undefined);
      await ds
        .query(
          `UPDATE mcp_app_integrations
           SET enabled = TRUE,
               mcp_token_hash = NULL,
               mcp_token_issued_at = NULL
           WHERE id = $1`,
          [hiclawId],
        )
        .catch(() => undefined);
    }
    await ds.query('DELETE FROM admin_access_tokens WHERE admin_id = $1', [admin.id]).catch(() => undefined);
    await ds.query('DELETE FROM admins WHERE id = $1', [admin.id]).catch(() => undefined);
    console.log('[mcp-integrations] cleanup complete');
    await app.close();
    await new Promise((resolve) => mockMCP.close(resolve));
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message, details: error.details }, null, 2));
  process.exit(1);
});
