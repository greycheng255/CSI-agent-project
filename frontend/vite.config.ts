import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // 读取 frontend/.env，使 BACKEND_PORT 等变量对代理生效
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: true,
      proxy: {
        '^/api(?:/|$)': {
          target: `http://localhost:${env.BACKEND_PORT ?? 4000}`,
          changeOrigin: true,
          // 直通：业务控制器自带 api/v1 前缀（如 api/v1/users），
          // 跨版块契约端点（v1/...）不经前端代理（Console 直连后端）
        },
      },
    },
    preview: {
      host: true,
    },
  }
})
