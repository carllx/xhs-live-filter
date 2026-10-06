/**
 * xhs-live-filter 用户脚本主入口
 */

import { LiveFilterApp } from './app';
import { installSquarefeedInterceptor } from './network/squarefeed-interceptor';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

// Phase 1 — document-start: 立即安装 page-world 被动网络拦截器
try {
  const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  installSquarefeedInterceptor(targetWin);
} catch (e) {
  console.warn('[xhs-live-filter] Install squarefeed interceptor failed:', e);
}

// Phase 2 — DOM ready: 等待 body 节点就绪后启动 LiveFilterApp UI / DOM 观察
function bootstrap(): void {
  // 避免在同一页面重复初始化 App
  if ((window as unknown as { __XHS_LIVE_FILTER_LOADED__?: boolean }).__XHS_LIVE_FILTER_LOADED__) {
    return;
  }
  if (!document.body) {
    // 保护：若 body 尚未出现则等待 DOMContentLoaded
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    return;
  }
  (window as unknown as { __XHS_LIVE_FILTER_LOADED__?: boolean }).__XHS_LIVE_FILTER_LOADED__ = true;

  const app = new LiveFilterApp();
  app.start(document.body);
  console.log('[xhs-live-filter] v0.1.3-beta.6 candidate started successfully');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}

