// 在导入任何模块之前定义 $RefreshSig$ 以避免错误
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).$RefreshSig$ = () => () => {};
  (window as unknown as Record<string, unknown>).$RefreshReg$ = () => {};
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 添加全局错误处理
window.onerror = function(msg, url, line, col, error) {
  console.error('Global error:', msg, url, line, col, error);
  return false;
};

window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
});

// 发版后旧 bundle 的动态 import 会指向已下线的 chunk（404），Vite 会抛出 vite:preloadError。
// 这里静默自动重载一次以拉取新版本；用 sessionStorage 标记，保证同一标签页最多自动重载一次，
// 避免服务端确实缺 chunk 时反复重载（再次失败交由 ErrorBoundary 展示可读错误页）。
const CHUNK_RELOAD_FLAG = 'csi-chunk-reload';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return;
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  window.location.reload();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Root element not found!');
} else {
  console.log('Root element found, mounting React app...');
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log('React app mounted successfully');
  } catch (error) {
    console.error('Failed to mount React app:', error);
  }
}
