#!/bin/bash

# 创建任务和 Agent 报价的测试脚本
# 使用 curl 直接调用 API

set -e

# API 基础地址
GENESIS_API="${GENESIS_API:-http://localhost:30080}"

echo "======================================"
echo "Genesis 任务创建和报价测试脚本"
echo "API: $GENESIS_API"
echo "======================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 步骤 1: 创建任务
echo -e "${BLUE}步骤 1: 创建任务${NC}"
echo "--------------------------------------"

TASK_RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "抖音视频数据采集任务",
    "description": "需要抓取抖音视频页面的点赞数、评论数、收藏数、转发数。目标页面：https://v.douyin.com/xxxxx。要求：1. 能正确识别目标用户 2. 能准确提取互动数据 3. 能获取主页信息",
    "acceptanceCriteria": "1. 能正确识别目标用户\n2. 能准确提取点赞/评论/收藏/转发数量\n3. 能获取主页信息和产品介绍\n4. 提供100条真实数据样本",
    "budgetCny": 100,
    "expectedDeliveryAt": "2025-04-25T23:59:59Z"
  }')

echo "任务创建响应:"
echo "$TASK_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TASK_RESPONSE"
echo ""

# 提取任务 ID
TASK_ID=$(echo "$TASK_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -z "$TASK_ID" ]; then
    echo -e "${YELLOW}警告: 无法提取任务 ID，使用默认测试 ID${NC}"
    TASK_ID="test-task-$(date +%s)"
fi

echo -e "${GREEN}任务 ID: $TASK_ID${NC}"
echo ""

# 步骤 2: 等待任务创建完成
sleep 2

# 步骤 3: 创建报价
echo -e "${BLUE}步骤 2: Agent 提交报价${NC}"
echo "--------------------------------------"

# 构建详细的执行计划
EXECUTION_PLAN='[
  "【需求分析】分析目标抖音视频/用户页面结构：https://v.douyin.com/xxxxx，明确需要提取的数据字段：点赞数、评论数、收藏数、转发数、作者信息",
  "【页面分析】使用浏览器开发者工具分析页面DOM结构，识别视频信息、互动数据（点赞/评论/收藏/转发）、作者信息的CSS选择器或XPath",
  "【技术方案】使用Playwright模拟真实浏览器行为，设置合理的请求间隔（1-3秒），配置User-Agent轮换，处理可能的反爬机制",
  "【核心开发】编写抖音爬虫核心逻辑：①视频页面解析 ②互动数据提取 ③作者信息抓取 ④数据清洗和格式化",
  "【数据验证】针对验收标准逐项验证：①能否正确识别目标用户 ②能否准确提取点赞/评论/收藏/转发数量 ③能否获取主页信息和产品介绍",
  "【交付物】①douyin_spider.py（完整可运行代码）②config.py（配置文件）③sample_data.json（100条真实数据样本）④README.md（详细使用说明）"
]'

# 构建 pricingMeta
PRICING_META=$(cat <<EOF
{
  "scores": {
    "relevance": 0.85,
    "complexity": 0.6,
    "urgency": 0.5,
    "overall": 0.75
  },
  "skillHits": ["Python", "爬虫", "数据分析"],
  "params": {
    "minBidRatio": 0.3,
    "maxBidRatio": 0.9,
    "minScore": 0.5
  },
  "ratio": 0.65,
  "evaluation": {
    "baseRate": 50,
    "estimatedHours": 2,
    "basePrice": 100,
    "complexityFactor": 1.2,
    "complexity": "low",
    "complexityCn": "低",
    "confidence": "高",
    "minPrice": 8,
    "maxPrice": 12,
    "budgetCny": 100,
    "matchedSkills": [
      {"name": "Python开发", "description": "匹配关键词：爬虫", "matchScore": 0.85},
      {"name": "AI/机器学习", "description": "匹配关键词：ai", "matchScore": 0.65}
    ],
    "executionPlan": $EXECUTION_PLAN,
    "analysis": "【Openclaw grey 分析】\n任务：抖音爬虫135\n复杂度：低（low）\n预估工时：2小时\n匹配技能：Python开发，AI/机器学习\n建议报价：¥10"
  }
}
EOF
)

BID_RESPONSE=$(curl -s -X POST "${GENESIS_API}/api/v1/agent/bids" \
  -H "Content-Type: application/json" \
  -d "{
    \"taskId\": \"$TASK_ID\",
    \"agentName\": \"Openclaw grey\",
    \"priceCny\": 10,
    \"planSummary\": \"我将使用Python + Playwright开发抖音视频数据采集爬虫，提取点赞、评论、收藏、转发数据。预计2小时完成，提供完整代码和数据样本。\",
    \"pricingModel\": \"smart-v3\",
    \"pricingMeta\": $PRICING_META
  }")

echo "报价提交响应:"
echo "$BID_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$BID_RESPONSE"
echo ""

# 提取报价 ID
BID_ID=$(echo "$BID_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -n "$BID_ID" ]; then
    echo -e "${GREEN}报价 ID: $BID_ID${NC}"
else
    echo -e "${YELLOW}警告: 无法提取报价 ID${NC}"
fi

echo ""
echo "======================================"
echo -e "${GREEN}操作完成！${NC}"
echo "======================================"
echo ""
echo "任务详情页面: ${GENESIS_API}/tasks/${TASK_ID}"
echo ""
echo "你可以通过以下命令查看任务详情:"
echo "  curl -s ${GENESIS_API}/api/v1/tasks/${TASK_ID} | python3 -m json.tool"
echo ""
