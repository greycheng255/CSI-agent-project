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
