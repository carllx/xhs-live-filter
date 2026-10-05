/**
 * xhs-live-filter 用户脚本主入口
 */

import { LiveFilterApp } from './app';

function bootstrap(): void {
  // 避免在同一页面重复初始化
  if ((window as unknown as { __XHS_LIVE_FILTER_LOADED__?: boolean }).__XHS_LIVE_FILTER_LOADED__) {
    return;
  }
  (window as unknown as { __XHS_LIVE_FILTER_LOADED__?: boolean }).__XHS_LIVE_FILTER_LOADED__ = true;

  const app = new LiveFilterApp();
  app.start(document.body);
  console.log('[xhs-live-filter] v0.1.0 started successfully');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
