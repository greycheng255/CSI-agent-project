#!/bin/bash
# 过渡期巡检：自动为缺 org 绑定的 Console workspace 补绑 org 并激活 beta-free 套餐。
#
# org 权威源：Marketplace POST /v1/orgs/resolve（O1 端点，幂等）。
# 本脚本负责把权威 org_id 回填到 Console 侧 csi_org_bindings 并确保套餐激活。
# Console 侧完成「注册/建 workspace 时调用 /v1/orgs/resolve」改造后，移除本 crontab。

set -u
# cron 环境最小化：显式补 PATH 与 KUBECONFIG（kubectl 在 /usr/local/bin）
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.local/bin"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

LOCK=/tmp/org-binding-sync.lock
LOG=/tmp/org-binding-sync.log
PROJECT_DIR=/home/ubuntu/csi-agent-project-new/CSI-agent-project
NS=csi-beta
SECRET=csi-beta-secrets

exec 9>"$LOCK"
flock -n 9 || exit 0

DBURL=$(kubectl get secret "$SECRET" -n "$NS" -o jsonpath='{.data.DATABASE_URL}' 2>>"$LOG" | base64 -d)
if [ -z "$DBURL" ]; then
  echo "$(date '+%F %T') ERROR: cannot read DATABASE_URL from k8s secret" >> "$LOG"
  exit 1
fi
DBU=$(echo "$DBURL" | sed -E 's|postgres://([^:]+):.*|\1|')
DBP=$(echo "$DBURL" | sed -E 's|postgres://[^:]+:([^@]+)@.*|\1|')
DBH=$(echo "$DBURL" | sed -E 's|.*@([^:/?]+).*|\1|')
DBPORT=$(echo "$DBURL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DBN=$(echo "$DBURL" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')

TOKEN=$(grep '^LONGTASK_INBOUND_TOKEN=' "$PROJECT_DIR/.env" | cut -d= -f2 | tr -d '[:space:]')

# HMAC 签名调用（与长任务契约同构：t=<ts>,v1=hmac(body+ts)）
call_api() {
  local method="$1" path="$2" body="$3"
  local ts sig
  ts=$(date +%s)
  sig="t=${ts},v1=$(printf '%s%s' "$body" "$ts" | openssl dgst -sha256 -hmac "$TOKEN" -hex | sed 's/.*= //')"
  curl -s -X "$method" "http://localhost:4001$path" \
    -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    -H "X-Signature: ${sig}" -H "X-Request-Id: obsync-$$-$RANDOM" \
    -d "$body" --max-time 10
}

ROWS=$(PGHOST="$DBH" PGPORT="$DBPORT" PGUSER="$DBU" PGPASSWORD="$DBP" LC_ALL=C \
  psql -d "$DBN" -At -F '|' -c "
SELECT w.id
FROM workspace w
JOIN member m ON m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
LEFT JOIN csi_org_bindings b0 ON b0.workspace_id = w.id
WHERE b0.workspace_id IS NULL;")

while IFS='|' read -r ws; do
  [ -z "${ws:-}" ] && continue
  # 权威源解析 org_id（幂等；已绑定返回既有，未绑定生成新 org）
  RESP=$(call_api POST /v1/orgs/resolve "{\"workspace_id\":\"$ws\"}")
  ORG=$(echo "$RESP" | sed -n 's/.*"org_id":"\([^"]*\)".*/\1/p')
  if [ -z "$ORG" ]; then
    echo "$(date '+%F %T') ws=${ws%%-*} ERROR: resolve failed: $RESP" >> "$LOG"
    continue
  fi
  PGHOST="$DBH" PGPORT="$DBPORT" PGUSER="$DBU" PGPASSWORD="$DBP" LC_ALL=C \
    psql -d "$DBN" -q -c "
INSERT INTO csi_org_bindings (workspace_id, org_id, source, resolved_at)
VALUES ('$ws', '$ORG', 'auto-sync', now())
ON CONFLICT (workspace_id) DO NOTHING;"
  # 激活 beta-free（幂等：已有 active/trial 订阅直接返回）
  ACT=$(call_api POST /v1/entitlement/subscriptions "{\"action\":\"activate\",\"org_id\":\"$ORG\",\"plan_code\":\"beta-free\"}")
  CODE=$(echo "$ACT" | grep -o '"status":"active"' | head -1)
  echo "$(date '+%F %T') ws=${ws%%-*} org=${ORG%%-*} activate=${CODE:-FAIL:$ACT}" >> "$LOG"
done <<< "$ROWS"
