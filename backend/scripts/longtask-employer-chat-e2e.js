/**
 * 雇主 ↔ Agent / Agent Owner 沟通闭环 联调测试脚本（M 侧）。
 *
 * 覆盖链路（对应 plan「验证」第 3–4 步）：
 *   A 入站：Console 推 @employer 提问（HMAC 验签）→ 落库 employer_mentions
 *   B 雇主时间线：GET /employer/orders/:id/messages 含该提问
 *   C 雇主回复提问：POST .../mentions/:mentionId/replies → status=replied + 出站 employer-reply
 *   D 雇主时间线：回复以合成项（kind=reply）出现
 *   E 雇主主动发起：POST .../messages → employer_outbound_messages 落库 + 出站 employer-reply（null 语义）
 *   F 幂等：同 client_message_id 重复提交不新增行、不重复投递
 *   G 边界：空 text→400 / 非 uuid client_message_id→400 / 非雇主→403 / 订单不存在→404
 *   H 出站投递观测：webhook_outbox 中两条 task.employer_reply 的最终状态
 *
 * 用法（宿主或容器内均可，需能连生产 PG）：
 *   cd backend && node scripts/longtask-employer-chat-e2e.js
 *
 * 环境变量：
 *   E2E_BASE_URL   默认 http://localhost:4001
 *   ORDER_ID       默认自动挑「有 project_id 且未取消」的最新订单
 *   REPLY_MENTION_ID  C 段改为回复「已存在的真实 pending 提问」（Console 的 mention_id），
 *                     用于验证真实评论线程化；不设时回复本脚本自造的提问
 *   E2E_CLEANUP=1  结束时删除本次生成的 mention / outbound 行（access_token 始终清理）
 */
const { Client } = require('pg');
const { createHmac, createHash, randomUUID } = require('crypto');
const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

// 环境变量：仓库根 .env 优先，其次 backend/.env（与 app.module.ts 同源）
for (const envPath of [
  resolve(__dirname, '..', '..', '.env'),
  resolve(__dirname, '..', '.env'),
]) {
  if (!existsSync(envPath)) continue;
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

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:4001').replace(
  /\/$/,
  '',
);
const INBOUND_TOKEN = process.env.LONGTASK_INBOUND_TOKEN;
const CLEANUP = process.env.E2E_CLEANUP === '1';

const results = [];
let db;
const created = {
  tokenIds: [],
  mentionIds: [],
  outboundIds: [],
  clientMessageIds: [],
};

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function info(name, detail = '') {
  console.log(`[INFO] ${name}${detail ? ` — ${detail}` : ''}`);
}

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

/** HTTP 调用：返回 {status, body}，不抛错（便于断言错误分支） */
async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { _raw: text };
  }
  return { status: res.status, body: parsed };
}

/** C→M 入站调用：Bearer + X-Signature(t=,v1=) + X-Request-Id(nonce) */
async function contractPost(path, payload) {
  const raw = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', INBOUND_TOKEN).update(raw + ts).digest('hex');
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INBOUND_TOKEN}`,
      'X-Signature': `t=${ts},v1=${v1}`,
      'X-Request-Id': `e2e-${randomUUID()}`,
    },
    body: raw,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { _raw: text };
  }
  return { status: res.status, body: parsed };
}

/** 铸造平台登录态（access_tokens：明文 token 只在内存，库里存 sha256） */
async function mintToken(userId) {
  const token = `e2e_${randomUUID().replace(/-/g, '')}`;
  const row = await db.query(
    `INSERT INTO access_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '2 hours') RETURNING id`,
    [userId, createHash('sha256').update(token).digest('hex')],
  );
  created.tokenIds.push(row.rows[0].id);
  return token;
}

function pickOrder(orderIdArg) {
  if (orderIdArg) {
    return db.query(
      `SELECT id, project_id, contract_status, employer_user_id, workspace_id, marketplace_task_id
       FROM marketplace_orders WHERE id = $1`,
      [orderIdArg],
    );
  }
  return db.query(
    `SELECT o.id, o.project_id, o.contract_status, o.employer_user_id, o.workspace_id, o.marketplace_task_id
     FROM marketplace_orders o
     LEFT JOIN marketplace_tasks t ON t.id = o.marketplace_task_id
     WHERE o.project_id IS NOT NULL AND o.contract_status <> 'cancelled'
       AND COALESCE(o.employer_user_id, t.employer_user_id) IS NOT NULL
     ORDER BY o.created_at DESC LIMIT 1`,
  );
}

async function main() {
  if (!INBOUND_TOKEN) throw new Error('LONGTASK_INBOUND_TOKEN missing in .env');

  db = await pg();
  info('DB', `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  info('API', BASE);

  // ── 0. 前置：表结构 + 订单 ─────────────────────────────────────────────
  const t = await db.query(
    `SELECT to_regclass('public.employer_mentions') IS NOT NULL AS mentions,
            to_regclass('public.employer_outbound_messages') IS NOT NULL AS outbound`,
  );
  check('DDL employer_mentions 存在', t.rows[0].mentions === true);
  check(
    'DDL employer_outbound_messages 存在',
    t.rows[0].outbound === true,
    '若 false 先执行 node scripts/longtask-schema-sync.js',
  );
  if (!t.rows[0].outbound) throw new Error('employer_outbound_messages 不存在，终止');

  const orderRes = await pickOrder(process.env.ORDER_ID);
  if (orderRes.rows.length === 0) throw new Error('无可用订单（需 project_id 非空且未取消）');
  const order = orderRes.rows[0];
  info(
    '订单',
    `id=${order.id} project=${order.project_id} status=${order.contract_status}`,
  );

  // project_task_id：优先复用历史入站提问的真值；订单还没有时由脚本生成一个。
  // 真实 Console 必然携带自己的 task id，脚本模拟 Console 时保持同样语义，
  // 否则订单会因缺 task_id 被 M 侧 422 拦下（见 C 侧对接说明第 5 节）。
  const prior = await db.query(
    `SELECT project_task_id FROM employer_mentions
     WHERE order_id = $1 AND project_task_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [order.id],
  );
  const projectTaskId = prior.rows[0]?.project_task_id ?? randomUUID();
  info('project_task_id', projectTaskId);

  const employerToken = await mintToken(order.employer_user_id);
  const otherUser = await db.query(
    `SELECT id FROM users WHERE id <> $1 LIMIT 1`,
    [order.employer_user_id],
  );
  const strangerToken = otherUser.rows[0]
    ? await mintToken(otherUser.rows[0].id)
    : null;

  // ── A. 入站提问（Console → M） ─────────────────────────────────────────
  const mentionId = randomUUID();
  const sourceCommentId = randomUUID();
  const mentionPayload = {
    mention_id: mentionId,
    project_id: order.project_id,
    project_task_id: projectTaskId,
    source_comment_id: sourceCommentId,
    from: { type: 'agent', id: randomUUID(), display_name: 'Agent Owner 审阅' },
    content: { text: '【E2E】@Employer 你觉得这一版怎么样？', attachments: [] },
    sent_at: new Date().toISOString(),
  };
  const a1 = await contractPost(
    `/v1/marketplace/orders/${order.id}/employer-mentions`,
    mentionPayload,
  );
  check(
    'A1 入站提问受理',
    (a1.status === 200 || a1.status === 201) && a1.body?.ok === true,
    `HTTP ${a1.status} duplicate=${a1.body?.duplicate}`,
  );
  created.mentionIds.push(mentionId);

  const a2 = await contractPost(
    `/v1/marketplace/orders/${order.id}/employer-mentions`,
    mentionPayload,
  );
  check(
    'A2 同 mention_id 重复推送幂等',
    a2.body?.duplicate === true,
    `duplicate=${a2.body?.duplicate}`,
  );

  const mentionRow = await db.query(
    `SELECT id, status, from_type, project_task_id FROM employer_mentions WHERE mention_id = $1`,
    [mentionId],
  );
  check(
    'A3 落库 pending',
    mentionRow.rows.length === 1 && mentionRow.rows[0].status === 'pending',
    `rows=${mentionRow.rows.length} status=${mentionRow.rows[0]?.status}`,
  );
  const mentionRowId = mentionRow.rows[0]?.id;

  // ── B. 雇主时间线（含提问） ────────────────────────────────────────────
  const b = await api('GET', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
    token: employerToken,
  });
  const bItem = (b.body?.items ?? []).find((i) => i.id === mentionRowId);
  check(
    'B1 时间线含入站提问（kind=question / status=pending）',
    b.status === 200 && bItem?.kind === 'question' && bItem?.status === 'pending',
    `HTTP ${b.status} items=${b.body?.items?.length} 命中=${Boolean(bItem)}`,
  );

  // ── C. 雇主回复提问 ───────────────────────────────────────────────────
  // REPLY_MENTION_ID 指定时改回复真实 pending 提问（验证 Console 侧真实线程化）
  let replyRowId = mentionRowId;
  let replyMentionId = mentionId;
  let replySourceCommentId = sourceCommentId;
  if (process.env.REPLY_MENTION_ID) {
    const real = await db.query(
      `SELECT id, mention_id, source_comment_id, status FROM employer_mentions
       WHERE mention_id = $1 AND order_id = $2`,
      [process.env.REPLY_MENTION_ID, order.id],
    );
    if (real.rows.length === 0) throw new Error('REPLY_MENTION_ID 未匹配到本订单的提问');
    if (real.rows[0].status !== 'pending') {
      throw new Error(`REPLY_MENTION_ID 状态非 pending（${real.rows[0].status}）`);
    }
    replyRowId = real.rows[0].id;
    replyMentionId = real.rows[0].mention_id;
    replySourceCommentId = real.rows[0].source_comment_id;
    info('C 段目标', `真实提问 mention_id=${replyMentionId}（Console comment=${replySourceCommentId}）`);
  }

  const replyText = `【E2E】已确认，按当前版本继续。${new Date().toISOString()}`;
  const c = await api(
    'POST',
    `/api/v1/longtask/employer/orders/${order.id}/mentions/${replyRowId}/replies`,
    { token: employerToken, body: { text: replyText, attachments: [] } },
  );
  check(
    'C1 回复受理（status=replied）',
    (c.status === 200 || c.status === 201) && c.body?.status === 'replied',
    `HTTP ${c.status} status=${c.body?.status}`,
  );

  const cRow = await db.query(
    `SELECT status, reply->>'text' AS text, replied_at FROM employer_mentions WHERE id = $1`,
    [replyRowId],
  );
  check(
    'C2 DB 落库回复内容',
    cRow.rows[0]?.status === 'replied' &&
      cRow.rows[0]?.text === replyText &&
      cRow.rows[0]?.replied_at !== null,
    `status=${cRow.rows[0]?.status}`,
  );

  const cOutbox = await db.query(
    `SELECT id, status, payload->'data' AS payload FROM webhook_outbox
     WHERE event_type = 'task.employer_reply' AND payload->'data'->>'message_id' = $1`,
    [replyRowId],
  );
  const cPayload = cOutbox.rows[0]?.payload;
  check(
    'C3 出站 employer-reply（挂原提问评论）',
    cOutbox.rows.length === 1 &&
      cPayload?.mention_id === replyMentionId &&
      cPayload?.in_reply_to_comment_id === replySourceCommentId &&
      cPayload?.initiated_by === 'employer',
    `rows=${cOutbox.rows.length} in_reply_to=${cPayload?.in_reply_to_comment_id}`,
  );

  const cRepeat = await api(
    'POST',
    `/api/v1/longtask/employer/orders/${order.id}/mentions/${replyRowId}/replies`,
    { token: employerToken, body: { text: '重复回复应被拒' } },
  );
  check(
    'C4 已回复提问再回复 → 422 STATE_INVALID_TRANSITION',
    cRepeat.status === 422,
    `HTTP ${cRepeat.status} code=${cRepeat.body?.error_code}`,
  );

  // ── D. 时间线含回复项 ─────────────────────────────────────────────────
  const d = await api('GET', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
    token: employerToken,
  });
  const dItem = (d.body?.items ?? []).find((i) => i.id === `${replyRowId}:reply`);
  check(
    'D1 时间线含回复合成项（kind=reply / 缩进依据）',
    d.status === 200 && dItem?.kind === 'reply' && dItem?.text === replyText,
    `命中=${Boolean(dItem)}`,
  );

  // ── E. 雇主主动发起（新开顶层 Comment） ────────────────────────────────
  const clientMessageId = randomUUID();
  const proactiveText = `【E2E】请补充一下本周的进度计划。${new Date().toISOString()}`;
  const e = await api('POST', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
    token: employerToken,
    body: { text: proactiveText, client_message_id: clientMessageId },
  });
  check(
    'E1 主动发起受理（duplicate=false）',
    (e.status === 200 || e.status === 201) && e.body?.duplicate === false,
    `HTTP ${e.status} duplicate=${e.body?.duplicate}`,
  );
  const outboundId = e.body?.id;
  created.outboundIds.push(outboundId);
  created.clientMessageIds.push(clientMessageId);
  check(
    'E2 落库字段（from_type/status/addressees/employer_user_id）',
    e.body?.fromType === 'employer' &&
      e.body?.status === 'queued' &&
      e.body?.employerUserId === order.employer_user_id &&
      Array.isArray(e.body?.addressees) &&
      e.body?.addressees?.[0]?.type === 'agent_owner',
    `fromType=${e.body?.fromType} status=${e.body?.status}`,
  );

  const eOutbox = await db.query(
    `SELECT id, event_id, status, payload->'data' AS payload FROM webhook_outbox
     WHERE event_type = 'task.employer_reply' AND payload->'data'->>'message_id' = $1`,
    [outboundId],
  );
  const ePayload = eOutbox.rows[0]?.payload;
  check(
    'E3 出站 null 语义 = 新开顶层 Comment',
    eOutbox.rows.length === 1 &&
      ePayload?.mention_id === null &&
      ePayload?.source_comment_id === null &&
      ePayload?.in_reply_to_comment_id === null &&
      ePayload?.initiated_by === 'employer' &&
      ePayload?.addressees?.[0]?.type === 'agent_owner',
    `rows=${eOutbox.rows.length} in_reply_to=${ePayload?.in_reply_to_comment_id}`,
  );
  check(
    'E4 出站 event_id = 落库行 id（DLQ replay 可去重）',
    Boolean(outboundId) && eOutbox.rows[0]?.event_id === outboundId,
    `event_id=${eOutbox.rows[0]?.event_id}`,
  );
  check(
    'E5 project_id 已带（避免 Console 400 进死信）',
    typeof ePayload?.project_id === 'string' && ePayload.project_id.length > 0,
    `project_id=${ePayload?.project_id}`,
  );

  // ── F. 幂等 ───────────────────────────────────────────────────────────
  const f = await api('POST', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
    token: employerToken,
    body: { text: proactiveText, client_message_id: clientMessageId },
  });
  const fCount = await db.query(
    `SELECT count(*)::int AS n FROM employer_outbound_messages WHERE client_message_id = $1`,
    [clientMessageId],
  );
  const fOutbox = await db.query(
    `SELECT count(*)::int AS n FROM webhook_outbox
     WHERE event_type = 'task.employer_reply' AND payload->'data'->>'message_id' = $1`,
    [outboundId],
  );
  check(
    'F1 同 client_message_id 幂等（不新增行、不重复投递）',
    f.body?.duplicate === true && fCount.rows[0].n === 1 && fOutbox.rows[0].n === 1,
    `duplicate=${f.body?.duplicate} rows=${fCount.rows[0].n} outbox=${fOutbox.rows[0].n}`,
  );

  // ── G. 边界 ───────────────────────────────────────────────────────────
  const g1 = await api('POST', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
    token: employerToken,
    body: { text: '   ' },
  });
  check('G1 空 text → 400', g1.status === 400, `HTTP ${g1.status} code=${g1.body?.error_code}`);

  const g2 = await api('POST', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
    token: employerToken,
    body: { text: '非法幂等键', client_message_id: 'not-a-uuid' },
  });
  check(
    'G2 非 uuid client_message_id → 400',
    g2.status === 400,
    `HTTP ${g2.status} code=${g2.body?.error_code}`,
  );

  if (strangerToken) {
    const g3 = await api('GET', `/api/v1/longtask/employer/orders/${order.id}/messages`, {
      token: strangerToken,
    });
    check('G3 非雇主读取 → 403', g3.status === 403, `HTTP ${g3.status}`);
  } else {
    info('G3 跳过（users 表无第二个用户）');
  }

  const g4 = await api(
    'GET',
    `/api/v1/longtask/employer/orders/${randomUUID()}/messages`,
    { token: employerToken },
  );
  check('G4 订单不存在 → 404', g4.status === 404, `HTTP ${g4.status} code=${g4.body?.error_code}`);

  // ── H. 出站投递观测 ───────────────────────────────────────────────────
  const h = await db.query(
    `SELECT payload->'data'->>'message_id' AS message_id, status, attempts, last_error
     FROM webhook_outbox
     WHERE event_type = 'task.employer_reply' AND payload->'data'->>'message_id' = ANY($1::text[])`,
    [[replyRowId, outboundId].filter(Boolean)],
  );
  for (const row of h.rows) {
    info(
      `H 投递状态 ${row.message_id === replyRowId ? '(回复提问)' : '(主动发起)'}`,
      `status=${row.status} attempts=${row.attempts}${row.last_error ? ` last_error=${String(row.last_error).slice(0, 160)}` : ''}`,
    );
  }
  if (h.rows.some((r) => r.status === 'dead')) {
    console.log(
      '[WARN] 存在 dead 出站（Console 侧可能尚未实现 null→顶层 Comment 或 project_task_id 反查），按 C 侧对接说明核对',
    );
  }
}

async function cleanup() {
  if (!db) return;
  // access_token 始终清理（临时凭证）
  if (created.tokenIds.length) {
    await db.query(`DELETE FROM access_tokens WHERE id = ANY($1::uuid[])`, [
      created.tokenIds,
    ]);
    console.log(`[cleanup] 已删除临时 access_token ${created.tokenIds.length} 个`);
  }
  if (CLEANUP) {
    if (created.mentionIds.length) {
      await db.query(`DELETE FROM employer_mentions WHERE mention_id = ANY($1::uuid[])`, [
        created.mentionIds,
      ]);
    }
    if (created.clientMessageIds.length) {
      await db.query(
        `DELETE FROM employer_outbound_messages WHERE client_message_id = ANY($1::uuid[])`,
        [created.clientMessageIds],
      );
    }
    console.log(`[cleanup] E2E_CLEANUP=1：已删除本次生成的 mention / outbound 行`);
  } else if (created.mentionIds.length || created.outboundIds.length) {
    console.log('[cleanup] 保留落库证据（如需清理，用下面的 SQL 或加 E2E_CLEANUP=1 重跑）');
    console.log(
      `  DELETE FROM employer_mentions WHERE mention_id = ANY('{${created.mentionIds.join(',')}}'::uuid[]);`,
    );
    console.log(
      `  DELETE FROM employer_outbound_messages WHERE client_message_id = ANY('{${created.clientMessageIds.join(',')}}'::uuid[]);`,
    );
  }
  await db.end();
}

main()
  .then(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n[summary] ${results.length - failed.length}/${results.length} PASS` +
        (failed.length ? `，FAIL: ${failed.map((f) => f.name).join(' | ')}` : ''),
    );
    process.exit(failed.length ? 1 : 0);
  })
  .catch(async (err) => {
    console.error('[e2e] FAIL:', err.message);
    await cleanup().catch(() => {});
    process.exit(1);
  });
