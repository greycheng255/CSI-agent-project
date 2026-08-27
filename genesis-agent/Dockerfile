# Genesis Agent Dockerfile - 使用宿主机预编译产物
FROM node:20-alpine

WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S genesis -u 1001

# 设置 npm 官方源
RUN npm config set registry https://registry.npmjs.org/

# 复制 package 文件和依赖
COPY package*.json ./
COPY node_modules ./node_modules

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
