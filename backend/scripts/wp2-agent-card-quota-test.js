const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0 && !process.env[trimmed.slice(0, idx)]) {
    process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
}

require('reflect-metadata');
require('ts-node/register');

const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../src/app.module');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStatus(promise, status, label) {
  const response = await promise;
  if (response.status !== status) {
    throw new Error(`${label} expected HTTP ${status}, got ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  const server = app.getHttpServer();
  const suffix = `${Date.now()}`.slice(-8);
  const phone = `18${suffix.padStart(9, '0')}`.slice(0, 11);
  const password = 'Test123456';

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
      request(server).post('/api/v1/users/register').send({
        phone,
        password,
        displayName: `WP2 Card额度测试${suffix}`,
      }),
      201,
      'user register',
    );
    result.checks.push('user_register');

    const login = await expectStatus(
      request(server).post('/api/v1/users/login').send({ phone, password }),
      201,
      'user login',
    );
    result.checks.push('user_login');

    const cardJson = {
      schema_version: '1.0',
      agent_id: `wp2-card-quota-${suffix}`,
      name: `WP2 Card额度测试Agent-${suffix}`,
      description: 'Validate Agent Card pricing and limits persistence',
      version: '2.3.4',
      provider: {
        owner: 'wp2-test',
        contact_email: 'wp2-card-quota@example.com',
      },
      endpoints: {
        task: 'https://quota.example.com/a2a/tasks',
        health: 'https://quota.example.com/health',
      },
      auth: {
        type: 'api_key',
        key_id: `quota-key-${suffix}`,
      },
      capabilities: {
        domains: ['carbon', 'quota-test'],
        skills: ['reporting', 'quota-management'],
        tools: ['mcp:quota.inspect'],
        models: ['gpt-4.1'],
        input_formats: ['json'],
        output_formats: ['pdf'],
      },
      pricing: {
        model: 'fixed',
        currency: 'CNY',
        minimum_price: 188.5,
        unit_price: 12.3,
        description: 'fixed package with quota metadata',
      },
      limits: {
        max_concurrent_tasks: 7,
        timeout_seconds: 2400,
      },
      metadata: {
        tags: ['quota', 'card-management'],
      },
    };

    const created = await expectStatus(
      request(server)
        .post('/api/v1/agents/register-external')
        .set('Authorization', `Bearer ${login.token}`)
        .send({ cardJson }),
      201,
      'register external card',
    );

    result.agentId = created.id;
    assert(created.id, 'registered agent id missing');
    assert(created.pricingModel === 'fixed', `pricingModel mismatch: ${created.pricingModel}`);
    assert(Number(created.basePrice) === 188.5, `basePrice mismatch: ${created.basePrice}`);
    assert(created.currency === 'CNY', `currency mismatch: ${created.currency}`);
    assert(created.authType === 'api_key', `authType mismatch: ${created.authType}`);
    assert(created.version === '2.3.4', `version mismatch: ${created.version}`);
    result.checks.push('agent_pricing_quota_fields_mapped');

    const detail = await expectStatus(
      request(server).get(`/api/v1/agents/${created.id}`),
      200,
      'get agent detail',
    );

    assert(Array.isArray(detail.cards) && detail.cards.length > 0, 'agent card not returned');
    const activeCard = detail.cards.find((card) => card.isActive) || detail.cards[0];
    assert(activeCard.cardJson?.pricing?.minimum_price === 188.5, 'card pricing minimum_price not persisted');
    assert(activeCard.cardJson?.pricing?.unit_price === 12.3, 'card pricing unit_price not persisted');
    assert(activeCard.cardJson?.limits?.max_concurrent_tasks === 7, 'card limits max_concurrent_tasks not persisted');
    assert(activeCard.cardJson?.limits?.timeout_seconds === 2400, 'card limits timeout_seconds not persisted');
    result.checks.push('card_json_pricing_and_limits_persisted');

    const capabilityNames = (detail.capabilities || []).map((item) => `${item.capabilityType}:${item.name}`);
    for (const expected of [
      'domain:carbon',
      'domain:quota-test',
      'skill:reporting',
      'skill:quota-management',
      'tool:mcp:quota.inspect',
      'model:gpt-4.1',
      'input_format:json',
      'output_format:pdf',
    ]) {
      assert(capabilityNames.includes(expected), `capability missing: ${expected}`);
    }
    result.checks.push('card_capabilities_extracted');

    const tagNames = (detail.tags || []).map((item) => `${item.tagType}:${item.tag}`);
    for (const expected of [
      'domain:carbon',
      'domain:quota-test',
      'pricing:fixed',
      'custom:quota',
      'custom:card-management',
    ]) {
      assert(tagNames.includes(expected), `tag missing: ${expected}`);
    }
    result.checks.push('card_tags_extracted');

    const invalid = await request(server)
      .post('/api/v1/agents/register-external')
      .set('Authorization', `Bearer ${login.token}`)
      .send({
        cardJson: {
          schema_version: '1.0',
          name: `Invalid Card ${suffix}`,
          description: 'missing pricing model and endpoints',
          version: '1.0.0',
        },
      });
    assert(invalid.status === 400, `invalid card expected 400, got ${invalid.status}`);
    result.checks.push('invalid_card_rejected');

    result.ok = true;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
