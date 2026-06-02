#!/bin/bash

echo "=========================================="
echo "Genesis Agent 网络诊断脚本"
echo "=========================================="
echo ""

# 检查环境变量
echo "1. 检查环境变量..."
if [ -f .env ]; then
    echo "   ✅ 找到 .env 文件"
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "   ⚠️  未找到 .env 文件，使用 .env.local 作为模板"
    if [ -f .env.local ]; then
        echo "   ℹ️  请复制 .env.local 为 .env 并配置实际值"
    fi
fi

echo ""
echo "2. 当前配置:"
echo "   GENESIS_API: ${GENESIS_API:-未设置}"
echo "   AGENT_ID: ${AGENT_ID:-未设置}"
echo ""

# 解析 API 地址
if [ -n "$GENESIS_API" ]; then
    # 提取主机名和端口
    HOST=$(echo $GENESIS_API | sed -E 's|https?://||' | cut -d'/' -f1 | cut -d':' -f1)
    PORT=$(echo $GENESIS_API | sed -E 's|https?://||' | cut -d'/' -f1 | grep ':' | cut -d':' -f2)
    PORT=${PORT:-80}
    
    echo "3. DNS 解析测试..."
    if command -v nslookup &> /dev/null; then
        nslookup $HOST 2>&1 | head -5
    elif command -v host &> /dev/null; then
        host $HOST 2>&1 | head -3
    elif command -v ping &> /dev/null; then
        ping -c 1 $HOST 2>&1 | head -2
    else
        echo "   ⚠️  无法执行 DNS 测试（缺少 nslookup/host/ping）"
    fi
    
    echo ""
    echo "4. TCP 连接测试 ($HOST:$PORT)..."
    if command -v nc &> /dev/null; then
        timeout 3 nc -zv $HOST $PORT 2>&1 || echo "   ❌ 连接失败"
    elif command -v telnet &> /dev/null; then
        echo "   ℹ️  尝试 telnet 连接..."
        timeout 3 bash -c "echo >/dev/tcp/$HOST/$PORT" 2>&1 && echo "   ✅ 端口可连接" || echo "   ❌ 连接失败"
    else
        echo "   ⚠️  无法执行 TCP 测试（缺少 nc/telnet）"
    fi
    
    echo ""
    echo "5. HTTP 连通性测试..."
    if command -v curl &> /dev/null; then
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${GENESIS_API}/health" 2>&1)
        if [ "$HTTP_CODE" = "200" ]; then
            echo "   ✅ HTTP 连接正常 (状态码: $HTTP_CODE)"
        else
            echo "   ❌ HTTP 异常 (状态码: $HTTP_CODE)"
        fi
    elif command -v wget &> /dev/null; then
        wget -q --timeout=5 --spider "${GENESIS_API}/health" 2>&1
        if [ $? -eq 0 ]; then
            echo "   ✅ HTTP 连接正常"
        else
            echo "   ❌ HTTP 连接失败"
        fi
    else
        echo "   ⚠️  无法执行 HTTP 测试（缺少 curl/wget）"
    fi
fi

echo ""
echo "6. 检查 /etc/hosts..."
if grep -q "genesis-backend" /etc/hosts 2>/dev/null; then
    echo "   ✅ 找到 genesis-backend 的 hosts 配置:"
    grep "genesis-backend" /etc/hosts | head -2
else
    echo "   ℹ️  未找到 genesis-backend 的 hosts 配置"
    echo "   💡 如需本地测试，可添加:"
    echo "      127.0.0.1 genesis-backend.genesis.svc.cluster.local"
fi

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "常见问题解决方案:"
echo ""
echo "1. DNS 解析失败 (EAI_AGAIN):"
echo "   - 添加 hosts 记录:"
echo "     echo '127.0.0.1 genesis-backend.genesis.svc.cluster.local' | sudo tee -a /etc/hosts"
echo "   - 或使用 IP 地址配置 GENESIS_API"
echo ""
echo "2. 连接被拒绝 (ECONNREFUSED):"
echo "   - 确认 Genesis Backend 服务已启动"
echo "   - 检查服务监听地址是否为 0.0.0.0:4000"
echo ""
echo "3. 连接超时:"
echo "   - 检查防火墙设置"
echo "   - 确认网络连通性"
echo ""
