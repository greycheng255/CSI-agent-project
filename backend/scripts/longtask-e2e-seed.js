/**
 * T14 展示页 E2E 种子脚本：
 * 1) 清理旧演示数据（pg 直连）
 * 2) 走真实 API：创建 Workspace → 更新展示页（案例/公告/服务承诺/标签）
 * 3) 模拟平台 job 写入信用数据（pg UPDATE，脱敏聚合指标）
 * 4) API 回读 + 数据库落库对比验证
 * 前置：后端已启动（http://localhost:4000，连接 .env 指定 PG）
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
      const key = trimmed.slice(0, sep).trim();
      const value = trimmed.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] ??= value;
    }
  }
}

const API = 'http://localhost:4000';
const SLUG = 'starcraft-ai';

async function pg() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${res.status}: ${text}`);
  }
  return data;
}

async function main() {
  const db = await pg();

  // 1) 清理旧演示数据（含 PowerShell 乱码残留）
  await db.query(`DELETE FROM workspaces WHERE slug = $1`, [SLUG]);
  console.log('[seed] 旧数据已清理');

  // 1.5) 改造语义：绑定平台既有用户为工作室 owner（取 users 表第一条，无用户则留空）
  const userRes = await db.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
  const ownerUserId = userRes.rows[0]?.id ?? null;
  console.log(`[seed] 绑定 owner_user_id=${ownerUserId ?? '(无用户，留空)'}`);

  // 2) 真实 API：创建 Workspace
  const created = await api('/api/v1/longtask/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      ownerUserId,
      name: '星辰 AI 工作室',
      slug: SLUG,
      bio: '专注企业官网与数据报告交付的 AI 工作室：平均 3 天完成需求澄清，全流程由 AI 自主规划与交付，人工仅在关键节点审批。',
      categoryIds: ['web', 'data'],
      capabilityTags: ['电商文案', 'SaaS 官网', '数据分析报告'],
    }),
  });
  console.log(`[seed] POST 创建成功 id=${created.id} name=${created.name} slug=${created.slug}`);

  // 3) 真实 API：更新展示页内容
  const patched = await api(`/api/v1/longtask/workspaces/${created.id}/showcase`, {
    method: 'PATCH',
    body: JSON.stringify({
      showcaseCases: [
        { title: '连锁零售官网改版', summary: '12 个产品线落地页 + CMS，交付后首月转化率提升 18%，供雇主脱敏案例查看。', permission: 'public' },
        { title: 'Q2 经营分析报告', summary: '整合 40 万行销售数据生成可视化报告，用于内部经营评审（内容已脱敏）。', permission: 'public' },
        { title: 'B2B 平台定制看板', summary: '客户定制化指标看板，涉及客户数据，仅评审可见。', permission: 'review_only' },
      ],
      announcement: '本周可承接 2 个官网类新任务，工作日 24 小时内响应。',
      serviceCommitments: {
        response_time: '24h 内响应',
        revisions: '2 次免费修订',
        refund: '14 天验收退款保障',
      },
    }),
  });
  console.log(`[seed] PATCH 展示页成功 cases=${patched.showcaseCases.length} announcement=${patched.announcement}`);

  // 4) 模拟平台 job 写入信用数据（脱敏聚合指标，平台自动生成域）
  const credit = {
    completed_tasks_count: 12,
    avg_rating: 4.7,
    on_time_rate: 0.93,
    dispute_rate: 0.02,
  };
  await db.query(
    `UPDATE workspaces SET
       completed_tasks_count = $2, avg_rating = $3, on_time_rate = $4, dispute_rate = $5,
       updated_at = now()
     WHERE id = $1`,
    [created.id, credit.completed_tasks_count, credit.avg_rating, credit.on_time_rate, credit.dispute_rate],
  );
  console.log('[seed] 平台 job 信用数据已写入', JSON.stringify(credit));

  // 5) API 回读（页面数据源）
  const bySlug = await api(`/api/v1/longtask/workspaces/slug/${SLUG}`);
  console.log('[verify] API 回读:', JSON.stringify({
    id: bySlug.id,
    name: bySlug.name,
    capabilityTags: bySlug.capabilityTags,
    serviceCommitments: bySlug.serviceCommitments,
    showcaseCases: bySlug.showcaseCases?.length,
    announcement: bySlug.announcement,
    completedTasksCount: bySlug.completedTasksCount,
    avgRating: bySlug.avgRating,
    onTimeRate: bySlug.onTimeRate,
    disputeRate: bySlug.disputeRate,
  }));

  // 6) 数据库落库验证
  const row = await db.query(
    `SELECT id, name, slug, capability_tags, service_commitments, showcase_cases,
            announcement, completed_tasks_count, avg_rating, on_time_rate, dispute_rate
     FROM workspaces WHERE slug = $1`,
    [SLUG],
  );
  console.log('[verify] DB 落库行:', JSON.stringify(row.rows[0]));

  // 断言一致性：API 返回与 DB 一致
  const dbRow = row.rows[0];
  const checks = [
    ['id', bySlug.id, dbRow.id],
    ['name', bySlug.name, dbRow.name],
    ['slug', bySlug.slug, dbRow.slug],
    ['announcement', bySlug.announcement, dbRow.announcement],
    ['completedTasksCount', Number(bySlug.completedTasksCount), dbRow.completed_tasks_count],
    ['avgRating', Number(bySlug.avgRating), Number(dbRow.avg_rating)],
    ['cases', bySlug.showcaseCases.length, dbRow.showcase_cases.length],
  ];
  let failed = 0;
  for (const [label, apiVal, dbVal] of checks) {
    const ok = String(apiVal) === String(dbVal);
    if (!ok) failed += 1;
    console.log(`[verify] ${ok ? 'PASS' : 'FAIL'} ${label}: api=${String(apiVal)} db=${String(dbVal)}`);
  }

  await db.end();
  if (failed > 0) {
    console.error('[seed] 存在不一致项，E2E 前置失败');
    process.exit(1);
  }
  console.log('[seed] 全部校验通过，workspace_id=' + created.id);
}

main().catch((err) => {
  console.error('[seed] FAIL:', err.message);
  process.exit(1);
});