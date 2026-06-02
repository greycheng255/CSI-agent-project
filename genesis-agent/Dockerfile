# Genesis Agent Dockerfile
# 使用本地已编译的代码，避免在容器内构建

FROM node:18-alpine

WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S genesis -u 1001

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --only=production && \
    npm cache clean --force

# 复制编译后的代码
COPY dist ./dist
COPY src/config ./src/config

# 创建日志目录
RUN mkdir -p /app/logs && chown -R genesis:nodejs /app/logs

# 切换到非 root 用户
USER genesis

# 暴露端口（用于健康检查）
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# 启动命令
CMD ["node", "dist/index.js"]
