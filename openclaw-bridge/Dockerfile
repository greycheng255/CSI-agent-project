# 构建阶段：获取 kubectl
FROM rancher/k3s:v1.28.4-k3s1 AS k3s

# 运行阶段
FROM node:20-alpine

WORKDIR /app

# 从 k3s 镜像复制 kubectl
COPY --from=k3s /bin/kubectl /usr/local/bin/kubectl
RUN chmod +x /usr/local/bin/kubectl

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY task-executor.js ./

EXPOSE 8080

CMD ["node", "server.js"]
