#!/bin/bash

# 完整任务流程测试脚本
# 测试步骤：
# 1. 创建任务
# 2. 等待 Agent 报价
# 3. 接受报价
# 4. 等待任务执行完成
# 5. 验证执行结果

set -e

# 配置
# 使用 Kubernetes 服务地址
GENESIS_API="http://genesis-backend.genesis.svc.cluster.local:4000"
# 或者使用 NodePort 访问
# GENESIS_API="http://localhost:30080"  # 前端 NodePort
OWNER_TOKEN="BjE_PwKyOCr6KvPMcdO9Qw7lLYLJuqC_RY0iWj7eVo8"
AGENT_API_KEY="47ZtxmjqSV-XzK5CzfD8RZfdzR4PaK-PWJGudITVMrA"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  完整任务流程测试"
echo "=========================================="
echo ""

# ========== 步骤1: 创建任务 ==========
echo -e "${YELLOW}[步骤1/5] 创建任务...${NC}"

TASK_RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/tasks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OWNER_TOKEN}" \
  -d '{
    "title": "抖音视频数据采集测试",
    "description": "爬取抖音视频页面数据，包括点赞数、评论数、分享数等统计信息。目标URL: https://v.douyin.com/YmtZAd53VCs/",
    "type": "爬虫开发",
    "tags": ["抖音", "爬虫", "数据采集"],
    "budget": 500,
    "deadline": "2025-05-01T00:00:00Z",
    "acceptanceCriteria": "1. 成功获取点赞数\n2. 成功获取评论数\n3. 数据保存为JSON和CSV格式"
  }')

echo "任务创建响应:"
echo "$TASK_RESPONSE" | jq '.' 2>/dev/null || echo "$TASK_RESPONSE"
echo ""

# 提取任务ID
TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.id // .data?.id // empty')
if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "null" ]; then
    echo -e "${RED}错误: 无法获取任务ID${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 任务创建成功，ID: $TASK_ID${NC}"
echo ""

# ========== 步骤2: 等待 Agent 报价 ==========
echo -e "${YELLOW}[步骤2/5] 等待 Agent 报价 (最多60秒)...${NC}"

MAX_WAIT=60
WAITED=0
BID_ID=""

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep 5
    WAITED=$((WAITED + 5))
    
    # 查询任务详情
    TASK_DETAIL=$(curl -s "${GENESIS_API}/api/v1/tasks/${TASK_ID}" \
      -H "Authorization: Bearer ${OWNER_TOKEN}")
    
    # 检查是否有报价
    BIDS_COUNT=$(echo "$TASK_DETAIL" | jq '.bids | length' 2>/dev/null || echo "0")
    
    if [ "$BIDS_COUNT" -gt 0 ]; then
        BID_ID=$(echo "$TASK_DETAIL" | jq -r '.bids[0].id')
        BID_PRICE=$(echo "$TASK_DETAIL" | jq -r '.bids[0].price')
        echo -e "${GREEN}✓ 收到报价，ID: $BID_ID, 价格: ¥$BID_PRICE${NC}"
        break
    fi
    
    echo "  等待中... ($WAITED/$MAX_WAIT 秒)"
done

if [ -z "$BID_ID" ]; then
    echo -e "${RED}错误: 等待超时，未收到报价${NC}"
    exit 1
fi
echo ""

# ========== 步骤3: 接受报价 ==========
echo -e "${YELLOW}[步骤3/5] 接受报价...${NC}"

ACCEPT_RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/bids/${BID_ID}/accept" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OWNER_TOKEN}")

echo "接受报价响应:"
echo "$ACCEPT_RESPONSE" | jq '.' 2>/dev/null || echo "$ACCEPT_RESPONSE"
echo ""

ORDER_ID=$(echo "$ACCEPT_RESPONSE" | jq -r '.orderId // .data?.orderId // empty')
if [ -z "$ORDER_ID" ] || [ "$ORDER_ID" = "null" ]; then
    echo -e "${RED}错误: 无法获取订单ID${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 报价已接受，订单ID: $ORDER_ID${NC}"
echo ""

# ========== 步骤4: 等待任务执行 ==========
echo -e "${YELLOW}[步骤4/5] 等待任务执行完成 (最多5分钟)...${NC}"

MAX_EXEC_WAIT=300
EXEC_WAITED=0
EXECUTION_COMPLETED=false

while [ $EXEC_WAITED -lt $MAX_EXEC_WAIT ]; do
    sleep 10
    EXEC_WAITED=$((EXEC_WAITED + 10))
    
    # 查询执行进度
    PROGRESS=$(curl -s "${GENESIS_API}/api/v1/execution/orders/${ORDER_ID}/progress" \
      -H "X-Agent-API-Key: ${AGENT_API_KEY}" 2>/dev/null)
    
    # 检查执行状态
    OVERALL_STATUS=$(echo "$PROGRESS" | jq -r '.data?.overallStatus // .overallStatus // "unknown"')
    OVERALL_PROGRESS=$(echo "$PROGRESS" | jq -r '.data?.overallProgress // .overallProgress // 0')
    
    echo "  状态: $OVERALL_STATUS, 进度: $OVERALL_PROGRESS% ($EXEC_WAITED/$MAX_EXEC_WAIT 秒)"
    
    if [ "$OVERALL_STATUS" = "completed" ]; then
        EXECUTION_COMPLETED=true
        echo -e "${GREEN}✓ 任务执行完成!${NC}"
        break
    fi
    
    if [ "$OVERALL_STATUS" = "failed" ]; then
        echo -e "${RED}✗ 任务执行失败${NC}"
        break
    fi
done

echo ""

# ========== 步骤5: 验证执行结果 ==========
echo -e "${YELLOW}[步骤5/5] 验证执行结果...${NC}"

# 查询订单详情
ORDER_DETAIL=$(curl -s "${GENESIS_API}/api/v1/orders/${ORDER_ID}" \
  -H "Authorization: Bearer ${OWNER_TOKEN}")

echo "订单详情:"
echo "$ORDER_DETAIL" | jq '.' 2>/dev/null || echo "$ORDER_DETAIL"
echo ""

# 查询执行进度详情
PROGRESS_DETAIL=$(curl -s "${GENESIS_API}/api/v1/execution/orders/${ORDER_ID}/progress" \
  -H "X-Agent-API-Key: ${AGENT_API_KEY}")

echo "执行进度详情:"
echo "$PROGRESS_DETAIL" | jq '.' 2>/dev/null || echo "$PROGRESS_DETAIL"
echo ""

# 检查是否有真实数据
if echo "$ORDER_DETAIL" | jq -e '.executionResult?.likeCount' > /dev/null 2>&1; then
    LIKE_COUNT=$(echo "$ORDER_DETAIL" | jq -r '.executionResult.likeCount')
    COMMENT_COUNT=$(echo "$ORDER_DETAIL" | jq -r '.executionResult.commentCount // "N/A"')
    IS_SIMULATED=$(echo "$ORDER_DETAIL" | jq -r '.executionResult.isSimulated // "true"')
    
    echo "=========================================="
    echo "  执行结果摘要"
    echo "=========================================="
    echo "点赞数: $LIKE_COUNT"
    echo "评论数: $COMMENT_COUNT"
    echo "是否模拟数据: $IS_SIMULATED"
    echo ""
    
    if [ "$IS_SIMULATED" = "false" ] && [ "$LIKE_COUNT" != "null" ] && [ -n "$LIKE_COUNT" ]; then
        echo -e "${GREEN}✓ 成功获取真实数据!${NC}"
    else
        echo -e "${RED}✗ 未获取到真实数据${NC}"
    fi
else
    echo -e "${YELLOW}⚠ 执行结果中暂无数据字段${NC}"
fi

echo ""
echo "=========================================="
echo "  测试完成"
echo "=========================================="
echo "任务ID: $TASK_ID"
echo "报价ID: $BID_ID"
echo "订单ID: $ORDER_ID"
