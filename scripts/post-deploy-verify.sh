#!/bin/bash
# 部署后验证脚本 — Console 联调口径（公网 122.51.51.177:4001，安全组须放行 4001）
# node 进程直接绑 0.0.0.0:4001，无需 socat 转发
# 用法: bash post-deploy-verify.sh
set -e

BASE=http://122.51.51.177:4001
# 从 .env 读取真实入站 token
ENV_FILE="${ENV_FILE:-/home/ubuntu/csi-agent-project-new/CSI-agent-project/.env}"
TOKEN=$(grep '^LONGTASK_INBOUND_TOKEN=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
# 测试 org（有套餐）/ 无套餐 org（触发 PLAN_NOT_FOUND）— §6.4 约定 UUID 测试值
ORG_WITH_PLAN="00000000-0000-4000-8000-00000000e001"
ORG_NO_PLAN="00000000-0000-4000-8000-00000000e002"

hmac_get() {
  local path="$1"
  local ts=$(date +%s)
  local sig="t=${ts},v1=$(printf '%s%s' '' "$ts" | openssl dgst -sha256 -hmac "${TOKEN}" -hex 2>/dev/null | sed 's/.*= //')"
  local rid="verify-$(date +%s%N)"
  curl -s -w "\n%{http_code}" -H "Authorization: Bearer ${TOKEN}" -H "X-Signature: ${sig}" -H "X-Request-Id: ${rid}" "${BASE}${path}"
}

hmac_post() {
  local path="$1"
  local body="$2"
  local ts=$(date +%s)
  local sig="t=${ts},v1=$(printf '%s' "${body}${ts}" | openssl dgst -sha256 -hmac "${TOKEN}" -hex 2>/dev/null | sed 's/.*= //')"
  local rid="verify-$(date +%s%N)"
  curl -s -w "\n%{http_code}" -X POST -H "Authorization: Bearer ${TOKEN}" -H "X-Signature: ${sig}" -H "X-Request-Id: ${rid}" -H "Content-Type: application/json" -d "${body}" "${BASE}${path}"
}

PASS=0; FAIL=0
check() {
  local name="$1" expected="$2" actual="$3" body="$4"
  if [ "${actual}" = "${expected}" ]; then
    echo "✅ ${name} → HTTP ${actual}"
    PASS=$((PASS+1))
  else
    echo "❌ ${name} → HTTP ${actual} (期望 ${expected})"
    echo "   body: ${body:0:200}"
    FAIL=$((FAIL+1))
  fi
}

echo "=========================================="
echo " 部署后验证 — $(date '+%Y-%m-%d %H:%M:%S')"
echo " 目标: ${BASE}"
echo "=========================================="
echo ""

# ─────────────── K 线 ───────────────
echo "── K 线 (gateway keys) ──"

# K1 签发
WS_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')
RESP=$(hmac_post "/v1/gateway/keys" "{\"org_id\":\"${ORG_WITH_PLAN}\",\"workspace_id\":\"${WS_ID}\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
check "K1 签发 (新 workspace)" "201" "${CODE}" "${BODY}"

# 提取 key_id
KEY_ID=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key_id',''))" 2>/dev/null || echo "")
KEY_VAL=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || echo "")

# K1 幂等重取
RESP=$(hmac_post "/v1/gateway/keys" "{\"org_id\":\"${ORG_WITH_PLAN}\",\"workspace_id\":\"${WS_ID}\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
EXISTING=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('existing',''))" 2>/dev/null || echo "")
if [ "${CODE}" = "201" ] && [ "${EXISTING}" = "True" ]; then
  echo "✅ K1 幂等重取 → HTTP ${CODE} existing=${EXISTING}"
  PASS=$((PASS+1))
else
  echo "❌ K1 幂等重取 → HTTP ${CODE} existing=${EXISTING}"
  FAIL=$((FAIL+1))
fi

# K2 validate (有效 key)
RESP=$(hmac_post "/v1/gateway/keys/validate" "{\"key\":\"${KEY_VAL}\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
VALID=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('valid',''))" 2>/dev/null || echo "")
if [ "${CODE}" = "201" ] && [ "${VALID}" = "True" ]; then
  echo "✅ K2 validate 有效 key → HTTP ${CODE} valid=${VALID}"
  PASS=$((PASS+1))
else
  echo "❌ K2 validate 有效 key → HTTP ${CODE} valid=${VALID}"
  echo "   body: ${BODY:0:200}"
  FAIL=$((FAIL+1))
fi

# K3 revoke
if [ -n "${KEY_ID}" ]; then
  RESP=$(hmac_post "/v1/gateway/keys/${KEY_ID}/revoke" "{}")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | head -n -1)
  check "K3 revoke (存在 key)" "201" "${CODE}" "${BODY}"
fi

# K3 revoke 不存在的 key_id
RESP=$(hmac_post "/v1/gateway/keys/nonexistent-id/revoke" "{}")
CODE=$(echo "$RESP" | tail -1)
check "K3 revoke (无效 key_id)" "404" "${CODE}" "$(echo "$RESP" | head -n -1)"

# K4 rotate (用另一个新 workspace)
WS2=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')
RESP=$(hmac_post "/v1/gateway/keys" "{\"org_id\":\"${ORG_WITH_PLAN}\",\"workspace_id\":\"${WS2}\"}")
KEY_ID2=$(echo "$RESP" | head -n -1 | python3 -c "import sys,json; print(json.load(sys.stdin).get('key_id',''))" 2>/dev/null || echo "")
if [ -n "${KEY_ID2}" ]; then
  RESP=$(hmac_post "/v1/gateway/keys/${KEY_ID2}/rotate" "{}")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | head -n -1)
  check "K4 rotate" "201" "${CODE}" "${BODY}"
fi

echo ""

# ─────────────── E 族 ───────────────
echo "── E 族 (entitlement) ──"

# 预激活 test org 免费套餐（幂等）— E1/E2/E3 依赖 org 有 active subscription
ACT_BODY="{\"action\":\"activate\",\"org_id\":\"${ORG_WITH_PLAN}\",\"plan_code\":\"beta-free\"}"
hmac_post "/v1/entitlement/subscriptions" "${ACT_BODY}" > /dev/null 2>&1 || true

# E1 套餐
RESP=$(hmac_get "/v1/entitlement/plans/${ORG_WITH_PLAN}")
CODE=$(echo "$RESP" | tail -1)
check "E1 plans" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E1 契约别名 ?org_id=
RESP=$(hmac_get "/v1/entitlement/plan?org_id=${ORG_WITH_PLAN}")
CODE=$(echo "$RESP" | tail -1)
check "E1 plan (query alias)" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E2 目录
RESP=$(hmac_get "/v1/entitlement/catalogs/${ORG_WITH_PLAN}")
CODE=$(echo "$RESP" | tail -1)
check "E2 catalogs" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E3 额度
RESP=$(hmac_get "/v1/entitlement/quotas/${ORG_WITH_PLAN}")
CODE=$(echo "$RESP" | tail -1)
check "E3 quotas" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E4 用量
RESP=$(hmac_get "/v1/entitlement/workspaces/${WS_ID}/usage?period_start=2026-01-01T00:00:00Z&period_end=2026-12-31T23:59:59Z")
CODE=$(echo "$RESP" | tail -1)
check "E4 usage" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E5 能力声明
RESP=$(hmac_get "/v1/entitlement/capabilities")
CODE=$(echo "$RESP" | tail -1)
check "E5 capabilities" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E6 激活免费额度
RESP=$(hmac_post "/v1/entitlement/free-quota/activate" "{\"org_id\":\"${ORG_WITH_PLAN}\"}")
CODE=$(echo "$RESP" | tail -1)
check "E6 activate" "201" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E7 非 UUID → 400（UUID 校验）
RESP=$(hmac_get "/v1/entitlement/llm-config/non-uuid")
CODE=$(echo "$RESP" | tail -1)
check "E7 llm-config (非UUID)" "400" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E7 不存在 org → 404
RESP=$(hmac_get "/v1/entitlement/llm-config/${ORG_NO_PLAN}")
CODE=$(echo "$RESP" | tail -1)
check "E7 llm-config (不存在 org)" "404" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E7 plan 内置 fallback (with-plan) → 200 source=plan_builtin
RESP=$(hmac_get "/v1/entitlement/llm-config/${ORG_WITH_PLAN}")
CODE=$(echo "$RESP" | tail -1)
check "E7 llm-config (plan 内置)" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# L2 计量上报
RESP=$(hmac_post "/v1/entitlement/usage-records" "{\"org_id\":\"${ORG_WITH_PLAN}\",\"items\":[]}")
CODE=$(echo "$RESP" | tail -1)
check "L2 usage-records" "201" "${CODE}" "$(echo "$RESP" | head -n -1)"

echo ""

# ─────────────── 订单面 (S15 + D1-D3) ───────────────
echo "── 订单面 (S15 + D1-D3) ──"

# S15 假 order → 404
RESP=$(hmac_post "/v1/marketplace/orders/11111111-1111-1111-1111-111111111111/revision-negotiation/start" "{\"reason\":\"verify\"}")
CODE=$(echo "$RESP" | tail -1)
check "S15 revneg-start (假 order)" "404" "${CODE}" "$(echo "$RESP" | head -n -1)"

# D1 decide 错误字段 → 400
RESP=$(hmac_post "/v1/marketplace/orders/11111111-1111-1111-1111-111111111111/revision-negotiation/22222222-2222-2222-2222-222222222222/decide" "{\"option\":\"A\"}")
CODE=$(echo "$RESP" | tail -1)
check "D1 decide (错误字段 option)" "400" "${CODE}" "$(echo "$RESP" | head -n -1)"

# D2 respond 错误字段 → 400
RESP=$(hmac_post "/v1/marketplace/orders/11111111-1111-1111-1111-111111111111/cancel-requests/33333333-3333-3333-3333-333333333333/respond" "{\"decision\":\"accept\"}")
CODE=$(echo "$RESP" | tail -1)
check "D2 respond (错误字段 decision)" "400" "${CODE}" "$(echo "$RESP" | head -n -1)"

# D3 auto-resolve 错误字段 → 400
RESP=$(hmac_post "/v1/marketplace/orders/11111111-1111-1111-1111-111111111111/cancel-requests/33333333-3333-3333-3333-333333333333/auto-resolve" "{\"resolution\":\"accept_partial_settlement\"}")
CODE=$(echo "$RESP" | tail -1)
check "D3 auto-resolve (错误字段 resolution)" "400" "${CODE}" "$(echo "$RESP" | head -n -1)"

echo ""

# ─────────────── DB 残留确认 ───────────────
echo "── DB 残留确认 ──"
if command -v psql &>/dev/null; then
  export PGPASSWORD="${DB_PASSWORD:-WHcWmDaySF3NXjtf}"
  DBH="${DB_HOST:-122.51.51.177}"; DBP="${DB_PORT:-15435}"; DBU="${DB_USER:-genesis_db}"; DBN="${DB_NAME:-genesis_db}"
  N=$(psql -h "$DBH" -p "$DBP" -U "$DBU" -d "$DBN" -t -c "SELECT count(*) FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17fc'" 2>/dev/null | xargs)
  B=$(psql -h "$DBH" -p "$DBP" -U "$DBU" -d "$DBN" -t -c "SELECT count(*) FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%'" 2>/dev/null | xargs)
  D=$(psql -h "$DBH" -p "$DBP" -U "$DBU" -d "$DBN" -t -c "SELECT count(*) FROM org_subscriptions WHERE org_id = '00000000-0000-0000-0000-00000000d104'" 2>/dev/null | xargs)
  echo "negotiation 033b4135 残留: ${N} (期望 0)"
  echo "bid dd8730b0 残留: ${B} (期望 0)"
  echo "d104 探针订阅残留: ${D} (期望 0)"
else
  echo "⚠️  psql 不可用，请手动确认 DB 残留已清理"
fi

echo ""
echo "=========================================="
echo " 结果: ${PASS} PASS / ${FAIL} FAIL"
echo "=========================================="
