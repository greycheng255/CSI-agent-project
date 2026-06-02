#!/bin/bash

echo "=========================================="
echo "进度上报功能测试脚本"
echo "=========================================="
echo ""

# 检查环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

GENESIS_API=${GENESIS_API:-"http://genesis-backend.genesis.svc.cluster.local:4000"}
AGENT_API_KEY=${AGENT_API_KEY:-""}

echo "测试配置:"
echo "  GENESIS_API: $GENESIS_API"
echo "  AGENT_API_KEY: ${AGENT_API_KEY:0:10}..."
echo ""

# 测试 1: 检查后端 API 是否可用
echo "1. 检查后端 API 可用性..."
if command -v curl &> /dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${GENESIS_API}/health" 2>&1)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "   ✅ 后端 API 可访问"
    else
        echo "   ❌ 后端 API 返回状态码: $HTTP_CODE"
        echo "   请确保后端服务已启动"
        exit 1
    fi
else
    echo "   ⚠️  未安装 curl，跳过 API 检查"
fi
echo ""

# 测试 2: 创建执行计划 API 测试
echo "2. 测试创建执行计划 API..."
TEST_ORDER_ID="test-order-$(date +%s)"

if command -v curl &> /dev/null; then
    RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/execution/plans" \
        -H "Content-Type: application/json" \
        -H "X-Agent-API-Key: ${AGENT_API_KEY}" \
        -d "{
            \"orderId\": \"${TEST_ORDER_ID}\",
            \"phases\": [
                {
                    \"phaseKey\": \"phase-test\",
                    \"name\": \"测试阶段\",
                    \"description\": \"用于测试的阶段\",
                    \"weight\": 50,
                    \"sequence\": 0,
                    \"subTasks\": [
                        {
                            \"taskKey\": \"task-test-1\",
                            \"name\": \"测试子任务1\",
                            \"description\": \"测试用\",
                            \"weight\": 50
                        }
                    ]
                }
            ]
        }" 2>&1)

    echo "   响应: $RESPONSE"

    # 检查是否返回了 phase ID
    if echo "$RESPONSE" | grep -q '"id"'; then
        echo "   ✅ 执行计划创建成功，返回了 phase ID"
        PHASE_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "   Phase ID: $PHASE_ID"
    else
        echo "   ❌ 执行计划创建可能失败"
    fi
else
    echo "   ⚠️  未安装 curl，跳过 API 测试"
fi
echo ""

# 测试 3: 查询执行进度 API
echo "3. 测试查询执行进度 API..."
if command -v curl &> /dev/null && [ -n "$TEST_ORDER_ID" ]; then
    RESPONSE=$(curl -s "${GENESIS_API}/api/v1/execution/orders/${TEST_ORDER_ID}/progress" \
        -H "X-Agent-API-Key: ${AGENT_API_KEY}" 2>&1)

    echo "   响应: $RESPONSE"

    if echo "$RESPONSE" | grep -q '"success":true'; then
        echo "   ✅ 查询执行进度成功"
    else
        echo "   ⚠️  查询执行进度可能失败"
    fi
else
    echo "   ⚠️  未安装 curl，跳过 API 测试"
fi
echo ""

echo "=========================================="
echo "测试完成"
echo "=========================================="
echo ""
echo "如果以上测试都通过，说明:"
echo "1. 后端 API 正常工作"
echo "2. 执行计划可以创建"
echo "3. 进度可以查询"
echo ""
echo "接下来需要:"
echo "1. 重新构建 genesis-agent 镜像"
echo "2. 重新部署到 Kubernetes"
echo "3. 触发一个真实任务测试进度上报"
echo ""
