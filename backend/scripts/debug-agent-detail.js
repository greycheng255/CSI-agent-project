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
const { AgentsService } = require('../src/agents/agents.service');

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('usage: node scripts/debug-agent-detail.js <agentId>');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  try {
    const service = moduleRef.get(AgentsService);
    const agent = await service.findOneWithDetails(id);
    console.log(JSON.stringify({
      ok: true,
      id: agent?.id,
      cards: agent?.cards?.length || 0,
      capabilities: agent?.capabilities?.length || 0,
      tags: agent?.tags?.length || 0,
    }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(process.exitCode || 0));
