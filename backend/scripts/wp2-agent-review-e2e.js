const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));
process.env.DB_SYNC = process.env.DB_SYNC || 'true';

console.log('[wp2-review-e2e] env loaded', {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

require('reflect-metadata');
console.log('[wp2-review-e2e] loading ts-node...');
require('ts-node/register');
console.log('[wp2-review-e2e] loading Nest test dependencies...');

const request = require('supertest');
const { Test } = require('@nestjs/testing');
console.log('[wp2-review-e2e] loading AppModule...');
const { AppModule } = require('../src/app.module');
console.log('[wp2-review-e2e] AppModule loaded');

async function expectStatus(promise, status, label) {
  console.log(`[wp2-review-e2e] ${label}...`);
  const response = await promise;
  if (response.status !== status) {
    throw new Error(
      `${label} expected HTTP ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return response.body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('[wp2-review-e2e] compiling Nest testing module...');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  console.log('[wp2-review-e2e] initializing Nest app...');
  const app = moduleRef.createNestApplication();
  await app.init();
  console.log('[wp2-review-e2e] Nest app initialized');
  const server = app.getHttpServer();
  const suffix = `${Date.now()}`.slice(-8);
  const password = 'Test123456';
  const phone = `18${suffix.padStart(9, '0')}`.slice(0, 11);

  const result = {
    db: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    },
    checks: [],
  };

  try {
    await expectStatus(
      request(server)
        .post('/api/v1/users/register')
        .send({ phone, password, displayName: `WP2审核测试${suffix}` }),
      201,
      'user register',
    );
    result.checks.push('user_register');

    const login = await expectStatus(
      request(server).post('/api/v1/users/login').send({ phone, password }),
      201,
      'user login',
    );
    assert(login.token, 'user login did not return token');
    result.checks.push('user_login');

    const adminLogin = await expectStatus(
      request(server)
        .post('/api/v1/admin/login')
        .send({ username: 'admin', password: '123456' }),
      201,
      'admin login',
    );
    assert(adminLogin.token, 'admin login did not return token');
    result.checks.push('admin_login');

    const platformAgent = await expectStatus(
      request(server)
        .post('/api/v1/agents/register')
        .set('Authorization', `Bearer ${login.token}`)
        .send({
          name: `WP2审核通过测试Agent-${suffix}`,
          description: 'WP2 approval flow test platform agent',
          skills: ['review-flow', 'approval'],
          domains: ['wp2-test'],
          tags: ['auto-test'],
          endpointUrl: 'https://example.com/a2a/tasks',
          healthUrl: 'https://example.com/health',
          pricingModel: 'quote',
          basePrice: 10,
          currency: 'CNY',
        }),
      201,
      'platform agent register',
    );
    assert(platformAgent.id, 'platform register did not return agent id');
    assert(
      platformAgent.approvalStatus === 'pending_review',
      `platform agent status expected pending_review, got ${platformAgent.approvalStatus}`,
    );
    result.platformAgentId = platformAgent.id;
    result.checks.push('platform_agent_pending_review');

    const externalAgent = await expectStatus(
      request(server)
        .post('/api/v1/agents/register-external')
        .set('Authorization', `Bearer ${login.token}`)
        .send({
          cardJson: {
            schema_version: '1.0',
            agent_id: `wp2-review-reject-${suffix}`,
            name: `WP2审核驳回测试Agent-${suffix}`,
            description: 'WP2 reject flow test external agent',
            version: '1.0.0',
            endpoints: {
              task: 'https://external.example.com/a2a/tasks',
              health: 'https://external.example.com/health',
            },
            capabilities: {
              domains: ['wp2-test'],
              skills: ['review-flow', 'reject'],
            },
            pricing: {
              model: 'quote',
              minimum_price: 20,
              currency: 'CNY',
            },
            auth: { type: 'bearer' },
            provider: { contact_email: 'wp2-test@example.com' },
            metadata: { source: 'wp2-agent-review-e2e' },
          },
        }),
      201,
      'external agent register',
    );
    assert(externalAgent.id, 'external register did not return agent id');
    assert(
      externalAgent.approvalStatus === 'pending_review',
      `external agent status expected pending_review, got ${externalAgent.approvalStatus}`,
    );
    result.externalAgentId = externalAgent.id;
    result.checks.push('external_agent_pending_review');

    const pendingBefore = await expectStatus(
      request(server)
        .get('/api/v1/admin/agents/pending')
        .set('Authorization', `Bearer ${adminLogin.token}`),
      200,
      'admin pending before review',
    );
    assert(
      pendingBefore.some((agent) => agent.id === platformAgent.id) &&
        pendingBefore.some((agent) => agent.id === externalAgent.id),
      'pending list did not include both newly registered agents',
    );
    result.pendingBeforeCount = pendingBefore.length;
    result.checks.push('admin_pending_list_contains_new_agents');

    const approved = await expectStatus(
      request(server)
        .post(`/api/v1/admin/agents/${platformAgent.id}/approve`)
        .set('Authorization', `Bearer ${adminLogin.token}`)
        .send({ comment: 'WP2 approval flow test approved' }),
      201,
      'admin approve',
    );
    assert(
      approved.approvalStatus === 'approved',
      `approve expected approved, got ${approved.approvalStatus}`,
    );
    result.checks.push('admin_approve_sets_approved');

    const rejected = await expectStatus(
      request(server)
        .post(`/api/v1/admin/agents/${externalAgent.id}/reject`)
        .set('Authorization', `Bearer ${adminLogin.token}`)
        .send({ comment: 'WP2 approval flow test rejected' }),
      201,
      'admin reject',
    );
    assert(
      rejected.approvalStatus === 'rejected',
      `reject expected rejected, got ${rejected.approvalStatus}`,
    );
    result.checks.push('admin_reject_sets_rejected');

    const approvedDetail = await expectStatus(
      request(server).get(`/api/v1/agents/${platformAgent.id}`),
      200,
      'approved detail',
    );
    assert(
      approvedDetail.approvalStatus === 'approved',
      'approved detail did not persist approved status',
    );
    assert(
      Array.isArray(approvedDetail.capabilities) && approvedDetail.capabilities.length > 0,
      'approved detail did not include extracted capabilities',
    );
    assert(
      Array.isArray(approvedDetail.tags) && approvedDetail.tags.length > 0,
      'approved detail did not include extracted tags',
    );
    result.checks.push('approved_detail_contains_wp2_metadata');

    const rejectedDetail = await expectStatus(
      request(server).get(`/api/v1/agents/${externalAgent.id}`),
      200,
      'rejected detail',
    );
    assert(
      rejectedDetail.approvalStatus === 'rejected',
      'rejected detail did not persist rejected status',
    );
    result.checks.push('rejected_detail_persists_status');

    const discover = await expectStatus(
      request(server).get('/api/v1/agents/discover').query({ query: suffix }),
      200,
      'discover approved agents',
    );
    const discoveredAgents = Array.isArray(discover)
      ? discover
      : discover.items || discover.data || [];
    assert(
      discoveredAgents.some((agent) => agent.id === platformAgent.id),
      'approved agent was not discoverable',
    );
    assert(
      !discoveredAgents.some((agent) => agent.id === externalAgent.id),
      'rejected agent should not be discoverable',
    );
    result.discoverCount = discoveredAgents.length;
    result.checks.push('discover_shows_approved_hides_rejected');

    const unauthorizedPending = await request(server).get('/api/v1/admin/agents/pending');
    assert(
      unauthorizedPending.status === 401,
      `admin pending without token expected 401, got ${unauthorizedPending.status}`,
    );
    result.checks.push('admin_pending_requires_token');

    result.ok = true;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
