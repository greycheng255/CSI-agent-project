/**
 * 工作台「保存门面」数据流转验证：
 * PATCH showcase（bio/公告，模拟 MyWorkspace 保存）→ slug 回读 → PG 落库比对。
 */
const { Client } = require('pg');
const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

for (const envPath of [resolve(__dirname, '..', '.env')]) {
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sep = trimmed.indexOf('=');
      if (sep <= 0) continue;
      process.env[trimmed.slice(0, sep).trim()] ??= trimmed
        .slice(sep + 1)
        .trim();
    }
  }
}

async function main() {
  const slug = 'starcraft-ai';
  const viaSlug = await fetch(
    `http://localhost:4000/api/v1/longtask/workspaces/slug/${slug}`,
  ).then((r) => r.json());

  const patched = await fetch(
    `http://localhost:4000/api/v1/longtask/workspaces/${viaSlug.id}/showcase`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bio: '专注企业官网与数据报告交付的 AI 工作室（工作台编辑版简介）。',
        announcement: '工作台保存验证：本周可承接 3 个官网类新任务。',
      }),
    },
  ).then((r) => r.json());

  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await db.connect();
  const row = (
    await db.query('SELECT bio, announcement FROM workspaces WHERE id = $1', [
      viaSlug.id,
    ])
  ).rows[0];
  await db.end();

  console.log('[verify] API bio        :', patched.bio);
  console.log('[verify] API announcement:', patched.announcement);
  console.log('[verify] DB  bio        :', row.bio);
  console.log('[verify] DB  announcement:', row.announcement);

  const checks = [
    ['bio 一致', patched.bio, row.bio],
    ['公告一致', patched.announcement, row.announcement],
  ];
  let failed = 0;
  for (const [label, apiVal, dbVal] of checks) {
    const ok = apiVal === dbVal;
    if (!ok) failed += 1;
    console.log(`[verify] ${ok ? 'PASS' : 'FAIL'} ${label}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[verify] FAIL:', err.message);
  process.exit(1);
});