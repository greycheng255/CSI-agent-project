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

const { Test } = require('@nestjs/testing');
const { AppModule } = require('../src/app.module');
const { AgentsDiscoveryService } = require('../src/agents/agents-discovery.service');

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  try {
    const service = moduleRef.get(AgentsDiscoveryService);
    const result = await service.discover({ limit: 24 });
    console.log(JSON.stringify({ ok: true, total: result.total, count: result.items.length }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(process.exitCode || 0));
