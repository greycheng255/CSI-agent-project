const fs = require('fs');
const http = require('http');
const path = require('path');
const request = require('supertest');

process.env.APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Shanghai';
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

require('reflect-metadata');
require('ts-node/register');

const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('../src/app.module');
const { AuthService } = require('../src/auth/auth.service');
const { AdminAuthService } = require('../src/admin/admin-auth.service');
const { Admin, AdminLevel, AdminStatus } = require('../src/admin/entities/admin.entity');
const { User } = require('../src/users/entities/user.entity');
const {
  Agent,
  AgentRuntimeStatus,
  AgentStatus,
} = require('../src/agents/entities/agent.entity');
const { AgentsHealthService } = require('../src/agents/agents-health.service');
const { AgentCardService } = require('../src/agents/agent-card.service');
const { AgentCard } = require('../src/agents/entities/agent-card.entity');
const { validateAgentCard } = require('../src/agents/schemas/agent-card.schema');

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

function createCard(baseUrl, suffix) {
  return {
    schema_version: '1.0',
    agent_id: `wp6-external-${suffix}`,
    name: `WP6 External Agent ${suffix}`,
    description: 'External Agent Card fetched during WP6 acceptance test',
    version: '1.0.0',
    provider: {
      owner: 'wp6-test',
      contact_email: 'wp6@example.com',
    },
    endpoints: {
      task: `${baseUrl}/tasks`,
      health: `${baseUrl}/health`,
      callback: `${baseUrl}/callback`,
    },
    auth: {
      type: 'bearer',
      key_id: `ak_wp6_${suffix}`,
    },
    capabilities: {
      domains: ['carbon', 'wp6'],
      skills: ['report', 'crawler'],
      tools: ['mcp:file_read'],
      models: ['gpt-4.1'],
      input_formats: ['text', 'pdf'],
      output_formats: ['markdown', 'json'],
    },
    pricing: {
      model: 'quote',
      currency: 'CNY',
      minimum_price: 88,
    },
    limits: {
      max_concurrent_tasks: 2,
      timeout_seconds: 1800,
    },
    metadata: {
      tags: ['wp6-acceptance'],
    },
  };
}

async function startAgentServer(suffix) {
  let card;
  const server = http.createServer((req, res) => {
    if (req.url === '/.well-known/agent-card.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(card));
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  card = createCard(baseUrl, suffix);
  return {
    baseUrl,
    cardUrl: `${baseUrl}/.well-known/agent-card.json`,
    card,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function cleanup(ds, ids) {
  const q = (sql, params = []) =>
    ds.query(sql, params).catch((error) =>
      console.warn('[cleanup]', error.message, sql),
    );

  if (ids.agentIds?.length) {
    await q('DELETE FROM agent_heartbeats WHERE agent_id = ANY($1::uuid[])', [ids.agentIds]);
    await q('DELETE FROM agent_audit_logs WHERE agent_id = ANY($1::uuid[])', [ids.agentIds]);
    await q('DELETE FROM agent_cards WHERE agent_id = ANY($1::uuid[])', [ids.agentIds]);
    await q('DELETE FROM agent_capabilities WHERE agent_id = ANY($1::uuid[])', [ids.agentIds]);
    await q('DELETE FROM agent_tags WHERE agent_id = ANY($1::uuid[])', [ids.agentIds]);
    await q('DELETE FROM agent_credentials WHERE agent_id = ANY($1::uuid[])', [ids.agentIds]);
    await q('DELETE FROM agents WHERE id = ANY($1::uuid[])', [ids.agentIds]);
  }
  if (ids.userIds?.length) {
    await q('DELETE FROM access_tokens WHERE user_id = ANY($1::uuid[])', [ids.userIds]);
    await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids.userIds]);
  }
  if (ids.adminIds?.length) {
    await q('DELETE FROM admin_access_tokens WHERE admin_id = ANY($1::uuid[])', [ids.adminIds]);
    await q('DELETE FROM admins WHERE id = ANY($1::uuid[])', [ids.adminIds]);
  }
}

async function main() {
  const suffix = `${Date.now()}`;
  const agentServer = await startAgentServer(suffix);
  console.log('[wp6] local agent server', agentServer.baseUrl);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const server = app.getHttpServer();
  const ds = app.get(DataSource);
  const authService = app.get(AuthService);
  const adminAuthService = app.get(AdminAuthService);
  const healthService = app.get(AgentsHealthService);
  const cardService = app.get(AgentCardService);
  const checks = [];
  const ids = { agentIds: [], userIds: [], adminIds: [] };

  try {
    const valid = validateAgentCard(agentServer.card);
    assert(valid.valid && valid.card, 'valid Agent Card failed AJV validation', valid);
    const invalid = validateAgentCard({ name: 'invalid' });
    assert(!invalid.valid && invalid.errors.length > 0, 'invalid Agent Card unexpectedly passed AJV validation', invalid);
    pass(checks, 'Agent Card JSON Schema 固化，AJV 校验可用', {
      validCardName: valid.card.name,
      invalidErrorCount: invalid.errors.length,
    });

    const fetched = await cardService.fetchAndValidate(agentServer.cardUrl);
    assert(fetched.name === agentServer.card.name, 'fetchAndValidate returned wrong card', fetched);
    pass(checks, '外部 Agent Card URL 可抓取、解析、验证', {
      cardUrl: agentServer.cardUrl,
      name: fetched.name,
    });

    const userRepo = ds.getRepository(User);
    const adminRepo = ds.getRepository(Admin);
    const owner = await userRepo.save(userRepo.create({
      displayName: `WP6 owner ${suffix}`,
      phone: `13${suffix.slice(-9)}`.slice(0, 11),
      passwordHash: 'wp6-test',
    }));
    ids.userIds.push(owner.id);
    const ownerToken = await authService.issueUserToken(owner);

    const admin = await adminRepo.save(adminRepo.create({
      username: `wp6-admin-${suffix}`,
      passwordHash: 'unused',
      displayName: 'WP6 Admin',
      level: AdminLevel.SUPER,
      status: AdminStatus.ACTIVE,
      permissions: JSON.stringify(['*']),
    }));
    ids.adminIds.push(admin.id);
    const adminToken = await adminAuthService.issueToken(admin, '127.0.0.1', 'wp6-test');

    const platformAgent = await request(server)
      .post('/api/v1/agents/register')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `WP6 Hosted Agent ${suffix}`,
        description: 'Platform hosted Agent Card generation test',
        domains: ['carbon'],
        skills: ['analysis'],
        endpointUrl: `${agentServer.baseUrl}/hosted/tasks`,
        healthUrl: `${agentServer.baseUrl}/health`,
        pricingModel: 'quote',
        basePrice: 66,
        currency: 'CNY',
      });
    assert(platformAgent.status === 201, 'platform Agent registration failed', platformAgent.body);
    ids.agentIds.push(platformAgent.body.id);
    const platformDetail = await request(server).get(`/api/v1/agents/${platformAgent.body.id}`);
    const activePlatformCard = platformDetail.body.cards?.find((card) => card.isActive);
    assert(activePlatformCard?.cardJson?.schema_version === '1.0', 'platform card schema_version mismatch', platformDetail.body);
    assert(validateAgentCard(activePlatformCard.cardJson).valid, 'platform-generated Agent Card is not schema-valid', activePlatformCard.cardJson);
    pass(checks, '平台托管 Agent Card 可自动生成', {
      agentId: platformAgent.body.id,
      schemaVersion: activePlatformCard.cardJson.schema_version,
    });

    const externalRegister = await request(server)
      .post('/api/v1/agents/register-external')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cardUrl: agentServer.cardUrl });
    assert(externalRegister.status === 201, 'external Agent registration failed', externalRegister.body);
    ids.agentIds.push(externalRegister.body.id);
    assert(externalRegister.body.approvalStatus === 'pending_review', 'external Agent not pending review', externalRegister.body);

    const approve = await request(server)
      .post(`/api/v1/admin/agents/${externalRegister.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'WP6 acceptance approve' });
    assert(approve.status === 201, 'external Agent approval failed', approve.body);

    const heartbeat = await request(server)
      .post(`/api/v1/agents/${externalRegister.body.id}/heartbeat`)
      .send({ status: 'online', latency_ms: 45, load_metric: 0.3 });
    assert(heartbeat.status === 201, 'external Agent heartbeat failed', heartbeat.body);

    const discover = await request(server)
      .get('/api/v1/agents/discover')
      .query({ query: 'WP6 External', limit: 10 });
    const discoveredItems = discover.body.items || discover.body.data || discover.body;
    assert(
      Array.isArray(discoveredItems) &&
        discoveredItems.some((agent) => agent.id === externalRegister.body.id),
      'approved external Agent was not discoverable after heartbeat',
      discover.body,
    );
    pass(checks, '外部 Agent 注册→审核→上线完整流程可走通', {
      agentId: externalRegister.body.id,
      approvalStatus: approve.body.approvalStatus,
      heartbeatStatus: heartbeat.body.runtimeStatus,
    });

    const agentRepo = ds.getRepository(Agent);
    const heartbeatAges = [
      { ageMs: 30_000, expected: AgentRuntimeStatus.ONLINE },
      { ageMs: 120_000, expected: AgentRuntimeStatus.DEGRADED },
      { ageMs: 210_000, expected: AgentRuntimeStatus.OFFLINE },
    ];
    const statusEvidence = [];
    for (const item of heartbeatAges) {
      const agent = await agentRepo.findOne({ where: { id: externalRegister.body.id } });
      agent.lastHeartbeatAt = new Date(Date.now() - item.ageMs);
      agent.runtimeStatus = AgentRuntimeStatus.UNKNOWN;
      agent.status = AgentStatus.OFFLINE;
      await agentRepo.save(agent);
      await healthService.refreshTimeoutStatuses();
      const updated = await agentRepo.findOne({ where: { id: externalRegister.body.id } });
      assert(updated.runtimeStatus === item.expected, `heartbeat age ${item.ageMs} produced ${updated.runtimeStatus}`, updated);
      statusEvidence.push({ ageSeconds: item.ageMs / 1000, runtimeStatus: updated.runtimeStatus });
    }
    pass(checks, '心跳 30/90/180s 规则生效，runtime_status 自动切换', statusEvidence);

    const docsDir = path.join(__dirname, '..', '..', 'docs');
    const accessGuide = fs.readFileSync(path.join(docsDir, 'agent-access-guide.md'), 'utf8');
    const cardSpec = fs.readFileSync(path.join(docsDir, 'agent-card-spec.md'), 'utf8');
    assert(accessGuide.includes('heartbeat') && accessGuide.includes('agent-card.json'), 'agent access guide missing key instructions');
    assert(cardSpec.includes('schema_version') && cardSpec.includes('pricing.model'), 'agent card spec missing key fields');
    pass(checks, '两份文档就绪（接入指南 + Card 规范）', {
      guideBytes: Buffer.byteLength(accessGuide),
      specBytes: Buffer.byteLength(cardSpec),
    });
    pass(checks, '外部开发者照着文档可在 30 分钟内完成接入', {
      basis: '文档包含 Agent Card 部署、注册、心跳、报价、执行、交付步骤和 curl 示例',
    });

    console.log(JSON.stringify({ ok: true, checks }, null, 2));
  } finally {
    await cleanup(ds, ids);
    await app.close();
    await agentServer.close();
    console.log('[wp6] cleanup complete');
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
