#!/bin/bash
# Openclaw Agent 绑定工具
# 在 Openclaw 实例中执行，绑定到 Genesis Agent

set -e

VERSION="1.0.0"
GENESIS_API="${GENESIS_API:-http://genesis-backend.genesis.svc.cluster.local:4000}"
CONFIG_DIR="${HOME}/.genesis"
CONFIG_FILE="${CONFIG_DIR}/openclaw-bind.json"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印帮助信息
show_help() {
    cat << EOF
Openclaw Agent 绑定工具 v${VERSION}

用法: openclaw-bind [选项]

选项:
    -t, --token <token>      绑定令牌 (从 Genesis Web 界面获取)
    -a, --api <url>          Genesis API 地址 (默认: ${GENESIS_API})
    -i, --instance <name>    Openclaw 实例名称 (默认: 自动检测)
    -s, --status             查看绑定状态
    -n, --info               查看绑定的 Agent 信息
    -u, --unbind             解除绑定
    -h, --help               显示帮助信息
    -v, --version            显示版本

示例:
    # 交互式绑定
    openclaw-bind

    # 使用令牌绑定
    openclaw-bind --token abc123def456

    # 查看绑定状态
    openclaw-bind --status

EOF
}

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 获取 Openclaw 实例信息
get_openclaw_info() {
    local instance_name="${1:-}"
    local openclaw_url=""
    
    # 尝试从环境变量获取
    if [ -n "$OPENCLAW_URL" ]; then
        openclaw_url="$OPENCLAW_URL"
        print_info "从环境变量获取 Openclaw URL: $openclaw_url"
    fi
    
    # 尝试从 Kubernetes 获取
    if [ -z "$openclaw_url" ] && command -v kubectl &> /dev/null; then
        # 获取当前 Pod 的信息
        local pod_name=$(kubectl get pod -n openclaw-cloud -l app=openclaw --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
        if [ -n "$pod_name" ]; then
            instance_name=$(echo "$pod_name" | sed 's/openclaw-oc-\([^-]*\)-.*/\1/')
            openclaw_url="http://${pod_name}.openclaw-cloud.svc.cluster.local:18789"
            print_info "从 Kubernetes 获取 Openclaw 信息:"
            print_info "  实例名: $instance_name"
            print_info "  URL: $openclaw_url"
        fi
    fi
    
    # 尝试从本地服务获取
    if [ -z "$openclaw_url" ]; then
        if curl -s http://localhost:18789/health &> /dev/null; then
            openclaw_url="http://localhost:18789"
            instance_name="${instance_name:-local}"
            print_info "检测到本地 Openclaw 服务: $openclaw_url"
        fi
    fi
    
    # 如果还是无法获取，使用默认值
    if [ -z "$openclaw_url" ]; then
        instance_name="${instance_name:-grey}"
        openclaw_url="http://openclaw-oc-${instance_name}.openclaw-cloud.svc.cluster.local:18789"
        print_warning "无法自动检测 Openclaw 信息，使用默认值:"
        print_warning "  实例名: $instance_name"
        print_warning "  URL: $openclaw_url"
    fi
    
    echo "${instance_name}|${openclaw_url}"
}

# 生成外部 ID
generate_external_id() {
    local instance_name="$1"
    local hostname=$(hostname)
    local timestamp=$(date +%s)
    echo "openclaw-${instance_name}-${hostname}-${timestamp}"
}

# 执行绑定
execute_bind() {
    local token="$1"
    local instance_name="$2"
    
    print_info "开始绑定流程..."
    
    # 获取 Openclaw 信息
    local openclaw_info=$(get_openclaw_info "$instance_name")
    instance_name=$(echo "$openclaw_info" | cut -d'|' -f1)
    local openclaw_url=$(echo "$openclaw_info" | cut -d'|' -f2)
    
    # 生成外部 ID
    local external_id=$(generate_external_id "$instance_name")
    
    print_info "绑定信息:"
    print_info "  Openclaw 实例: $instance_name"
    print_info "  Openclaw URL: $openclaw_url"
    print_info "  外部 ID: $external_id"
    print_info "  Genesis API: $GENESIS_API"
    
    # 准备绑定数据
    local timestamp=$(date +%s)000
    local agent_id="${AGENT_ID:-}"  # 可以从环境变量获取
    
    # 构建 JSON 数据
    local json_data=$(cat <<EOF
{
    "agentId": "${agent_id}",
    "externalId": "${external_id}",
    "openclawUrl": "${openclaw_url}",
    "openclawInstance": "${instance_name}",
    "signature": "${token}",
    "timestamp": ${timestamp}
}
EOF
)
    
    print_info "发送绑定请求..."
    
    # 发送绑定请求
    local response=$(curl -s -w "\n%{http_code}" -X POST "${GENESIS_API}/api/v1/agent-bind/execute" \
        -H "Content-Type: application/json" \
        -d "$json_data" 2>&1 || echo "{}")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        print_success "绑定成功!"
        print_info "响应: $body"
        
        # 保存配置
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_FILE" <<EOF
{
    "agentId": "$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)",
    "openclawUrl": "$openclaw_url",
    "instanceName": "$instance_name",
    "externalId": "$external_id",
    "boundAt": "$(date -Iseconds)"
}
EOF
        print_info "配置已保存到: $CONFIG_FILE"
        return 0
    else
        print_error "绑定失败 (HTTP $http_code)"
        print_error "响应: $body"
        return 1
    fi
}

# 查看绑定状态
show_status() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_warning "未找到绑定配置"
        print_info "请先执行绑定: openclaw-bind --token <token>"
        return 1
    fi
    
    print_info "当前绑定状态:"
    cat "$CONFIG_FILE" | python3 -m json.tool 2>/dev/null || cat "$CONFIG_FILE"
    
    # 检查 Openclaw 服务状态
    local openclaw_url=$(grep -o '"openclawUrl": "[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
    if [ -n "$openclaw_url" ]; then
        print_info ""
        print_info "检查 Openclaw 服务状态..."
        if curl -s "${openclaw_url}/health" &> /dev/null; then
            print_success "Openclaw 服务运行正常"
        else
            print_error "Openclaw 服务无法访问"
        fi
    fi
}

# 查看 Agent 信息
show_info() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_warning "未找到绑定配置"
        return 1
    fi
    
    local agent_id=$(grep -o '"agentId": "[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
    
    if [ -n "$agent_id" ]; then
        print_info "获取 Agent 信息..."
        curl -s "${GENESIS_API}/api/v1/agents/${agent_id}" | python3 -m json.tool 2>/dev/null || echo "无法获取 Agent 信息"
    fi
}

# 解除绑定
unbind() {
    if [ ! -f "$CONFIG_FILE" ]; then
        print_warning "未找到绑定配置"
        return 1
    fi
    
    local agent_id=$(grep -o '"agentId": "[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
    
    if [ -z "$agent_id" ]; then
        print_error "无法获取 Agent ID"
        return 1
    fi
    
    print_warning "确定要解除绑定吗? (y/N)"
    read -r confirm
    
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        print_info "解除绑定..."
        
        local response=$(curl -s -w "\n%{http_code}" -X POST "${GENESIS_API}/api/v1/agent-bind/unbind/${agent_id}" \
            -H "Authorization: Bearer ${USER_TOKEN}" 2>&1 || echo "{}")
        
        local http_code=$(echo "$response" | tail -n1)
        
        if [ "$http_code" = "200" ]; then
            print_success "解除绑定成功"
            rm -f "$CONFIG_FILE"
            print_info "配置已删除"
        else
            print_error "解除绑定失败 (HTTP $http_code)"
        fi
    else
        print_info "取消操作"
    fi
}

# 交互式绑定
interactive_bind() {
    print_info "Openclaw Agent 绑定工具"
    print_info "========================"
    print_info ""
    print_info "请在 Genesis Web 界面获取绑定令牌:"
    print_info "  1. 登录 Genesis 平台"
    print_info "  2. 进入 Agent 详情页"
    print_info "  3. 点击'绑定 Openclaw'按钮"
    print_info "  4. 复制生成的绑定令牌"
    print_info ""
    
    read -rp "请输入绑定令牌: " token
    
    if [ -z "$token" ]; then
        print_error "绑定令牌不能为空"
        return 1
    fi
    
    read -rp "请输入 Openclaw 实例名称 [grey]: " instance_name
    instance_name="${instance_name:-grey}"
    
    execute_bind "$token" "$instance_name"
}

# 主函数
main() {
    # 解析命令行参数
    local token=""
    local instance_name=""
    local action="bind"
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--token)
                token="$2"
                shift 2
                ;;
            -a|--api)
                GENESIS_API="$2"
                shift 2
                ;;
            -i|--instance)
                instance_name="$2"
                shift 2
                ;;
            -s|--status)
                action="status"
                shift
                ;;
            -n|--info)
                action="info"
                shift
                ;;
            -u|--unbind)
                action="unbind"
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--version)
                echo "openclaw-bind version $VERSION"
                exit 0
                ;;
            *)
                print_error "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # 执行对应操作
    case $action in
        bind)
            if [ -n "$token" ]; then
                execute_bind "$token" "$instance_name"
            else
                interactive_bind
            fi
            ;;
        status)
            show_status
            ;;
        info)
            show_info
            ;;
        unbind)
            unbind
            ;;
    esac
}

# 运行主函数
main "$@"
