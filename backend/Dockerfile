# 后端 Dockerfile - 使用宿主机预编译的 dist
FROM node:20

WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production

# 复制 package.json 和 node_modules
COPY package.json .
COPY node_modules ./node_modules

# 复制预编译的 dist 目录
COPY dist ./dist

# 创建数据目录
RUN mkdir -p /data

# 暴露端口
EXPOSE 4000

# 启动命令
CMD ["node", "dist/main.js"]
