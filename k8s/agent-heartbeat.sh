#!/bin/sh
# Agent 心跳脚本 - 智能状态管理
# 逻辑：成功一次后保持 ONLINE，连续 2 次失败才标记为 OFFLINE

AGENT_ID="${AGENT_ID:-dfde23d0-feb9-445e-9b89-fbbe4b7bd41e}"
GENESIS_API="${GENESIS_API:-http://genesis-backend.genesis.svc.cluster.local:4000}"
INTERVAL="${HEARTBEAT_INTERVAL:-30}"
OWNER_TOKEN="${OWNER_TOKEN}"

# 连续失败计数
CONSECUTIVE_FAILURES=0

echo "Starting heartbeat for Agent: $AGENT_ID"
echo "Genesis API: $GENESIS_API"
echo "Interval: ${INTERVAL}s"
echo ""

while true; do
    # 发送心跳
    HTTP_CODE=$(curl -s -o /tmp/heartbeat_response.json -w "%{http_code}" \
        -X POST "${GENESIS_API}/api/v1/owner/agents/${AGENT_ID}/heartbeat" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${OWNER_TOKEN}" 2>/dev/null)
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        # 心跳成功
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Heartbeat SUCCESS (HTTP $HTTP_CODE)"
        CONSECUTIVE_FAILURES=0
    else
        # 心跳失败
        CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Heartbeat FAILED (HTTP $HTTP_CODE) - Consecutive failures: $CONSECUTIVE_FAILURES"
        
        # 连续 2 次失败，报告给后端
        if [ "$CONSECUTIVE_FAILURES" -ge 2 ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Reporting heartbeat failure to server..."
            curl -s -X POST "${GENESIS_API}/api/v1/owner/agents/${AGENT_ID}/heartbeat-failed" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer ${OWNER_TOKEN}" \
                -d "{\"consecutiveFailures\": $CONSECUTIVE_FAILURES}" 2>/dev/null
        fi
    fi
    
    sleep $INTERVAL
done
