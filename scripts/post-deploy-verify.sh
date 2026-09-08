#!/bin/bash
# 部署后验证脚本 — 在联调实例 172.17.0.14:4001 上执行
# 用法: bash post-deploy-verify.sh
set -e

BASE=http://localhost:4001
TOKEN=test-inbound-token
TS=$(date +%s)
SIG="t=${TS},v1=$(echo -n ''${TS} | openssl dgst -sha256 -hmac "${TOKEN}" -hex 2>/dev/null | sed 's/.*= //')"
RID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')

hmac_get() {
  local path="$1"
  curl -s -w "\n%{http_code}" -H "Authorization: Bearer ${TOKEN}" -H "X-Signature: ${SIG}" -H "X-Request-Id: ${RID}" "${BASE}${path}"
}

hmac_post() {
  local path="$1"
  local body="$2"
  local ts=$(date +%s)
  local sig="t=${ts},v1=$(printf '%s' "${body}${ts}" | openssl dgst -sha256 -hmac "${TOKEN}" -hex 2>/dev/null | sed 's/.*= //')"
  local rid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')
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
RESP=$(hmac_post "/v1/gateway/keys" "{\"org_id\":\"verify-org\",\"workspace_id\":\"${WS_ID}\"}")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
check "K1 签发 (新 workspace)" "201" "${CODE}" "${BODY}"

# 提取 key_id
KEY_ID=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key_id',''))" 2>/dev/null || echo "")
KEY_VAL=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || echo "")

# K1 幂等重取
RESP=$(hmac_post "/v1/gateway/keys" "{\"org_id\":\"verify-org\",\"workspace_id\":\"${WS_ID}\"}")
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
RESP=$(hmac_post "/v1/gateway/keys" "{\"org_id\":\"verify-org\",\"workspace_id\":\"${WS2}\"}")
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

# E1 套餐
RESP=$(hmac_get "/v1/entitlement/plans/verify-org")
CODE=$(echo "$RESP" | tail -1)
check "E1 plans" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E2 目录
RESP=$(hmac_get "/v1/entitlement/catalogs/verify-org")
CODE=$(echo "$RESP" | tail -1)
check "E2 catalogs" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E3 额度
RESP=$(hmac_get "/v1/entitlement/quotas/verify-org")
CODE=$(echo "$RESP" | tail -1)
check "E3 quotas" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E4 用量
RESP=$(hmac_get "/v1/entitlement/workspaces/${WS_ID}/usage?period_start=2026-01-01T00:00:00Z&period_end=2026-12-31T23:59:59Z")
CODE=$(echo "$RESP" | tail -1)
check "E4 usage" "200" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E7 不存在 org → 404
RESP=$(hmac_get "/v1/entitlement/llm-config/nonexistent-org-0000")
CODE=$(echo "$RESP" | tail -1)
check "E7 llm-config (不存在 org)" "404" "${CODE}" "$(echo "$RESP" | head -n -1)"

# E7 正常 config (如果有) → 200
RESP=$(hmac_get "/v1/entitlement/llm-config/verify-org")
CODE=$(echo "$RESP" | tail -1)
echo "ℹ️  E7 llm-config (verify-org) → HTTP ${CODE} (200=有配置, 404=无配置 — 均属正常)"

# L2 计量上报
RESP=$(hmac_post "/v1/entitlement/usage-records" "{\"org_id\":\"verify-org\",\"items\":[]}")
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
  N=$(PGPASSWORD=genesis_password psql -h localhost -p 5432 -U genesis_user -d genesis_db -t -c "SELECT count(*) FROM marketplace_revision_negotiations WHERE id = '033b4135-b1a3-4ddc-9215-59db87ff17fc'" 2>/dev/null | xargs)
  B=$(PGPASSWORD=genesis_password psql -h localhost -p 5432 -U genesis_user -d genesis_db -t -c "SELECT count(*) FROM marketplace_bids WHERE id::text LIKE 'dd8730b0-%'" 2>/dev/null | xargs)
  echo "negotiation 033b4135 残留: ${N} (期望 0)"
  echo "bid dd8730b0 残留: ${B} (期望 0)"
else
  echo "⚠️  psql 不可用，请手动确认 DB 残留已清理"
fi

echo ""
echo "=========================================="
echo " 结果: ${PASS} PASS / ${FAIL} FAIL"
echo "=========================================="
