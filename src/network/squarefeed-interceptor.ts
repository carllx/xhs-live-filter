/**
 * Squarefeed 被动网络拦截器 (Page-World Passive Interceptor)
 *
 * 规范约束：
 * 1. 只监听 live-room.xiaohongshu.com 的 /api/sns/red/live/web/feed/v1/squarefeed
 * 2. 纯被动窃听，不主动发网络请求，不修改原始请求与响应，不重放请求
 * 3. 严格不持久化、不输出任何 token / cookie / headers
 * 4. 针对 fetch 和 XMLHttpRequest 同时挂载 hook
 */

import { FeedIdentityStore } from './feed-identity-store';

export const SQUAREFEED_HOST = 'live-room.xiaohongshu.com';
export const SQUAREFEED_PATH = '/api/sns/red/live/web/feed/v1/squarefeed';

/**
 * 校验 URL 是否匹配目标 squarefeed 接口
 */
export function isSquarefeedUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    // 兼容相对路径与不同 origin
    const url = new URL(rawUrl, typeof window !== 'undefined' ? window.location?.href : 'https://www.xiaohongshu.com');
    const isTargetHost = url.hostname === SQUAREFEED_HOST || url.hostname.endsWith('.' + SQUAREFEED_HOST);
    const isTargetPath = url.pathname === SQUAREFEED_PATH;
    return isTargetHost && isTargetPath;
  } catch {
    return rawUrl.includes(SQUAREFEED_HOST) && rawUrl.includes(SQUAREFEED_PATH);
  }
}

/**
 * 安全解析 squarefeed 响应 payload 并写入 store
 */
export function processSquarefeedPayload(payload: unknown, store: FeedIdentityStore = FeedIdentityStore.getInstance()): void {
  if (!payload || typeof payload !== 'object') return;

  // 兼容 payload.data.feeds 与 payload.feeds
  const dataObj = (payload as { data?: { feeds?: unknown[] }; feeds?: unknown[] });
  const feeds = Array.isArray(dataObj.data?.feeds)
    ? dataObj.data!.feeds
    : Array.isArray(dataObj.feeds)
    ? dataObj.feeds
    : null;

  if (!feeds || feeds.length === 0) return;

  store.incrementCapturedCount(feeds.length);
  let parsedCount = 0;

  for (const item of feeds) {
    if (!item || typeof item !== 'object') continue;
    const feed = item as {
      live?: {
        tRoomInfo?: { roomIdStr?: string | number; roomId?: string | number; name?: string };
        tLiveHostInfo?: { userId?: string | number; nickname?: string };
      };
    };

    const roomInfo = feed.live?.tRoomInfo;
    const hostInfo = feed.live?.tLiveHostInfo;

    const liveId = (roomInfo?.roomIdStr ?? roomInfo?.roomId ?? '').toString().trim();
    const userId = (hostInfo?.userId ?? '').toString().trim();
    const nickname = (hostInfo?.nickname ?? '').toString().trim();
    const title = (roomInfo?.name ?? '').toString().trim();

    if (liveId && userId) {
      store.addIdentity({
        liveId,
        userId,
        nickname,
        title,
      });
      parsedCount++;
    }
  }

  // 低噪声控制台诊断输出（不含 token/cookie）
  console.log(`[xhs-live-filter] squarefeed captured: feeds=${feeds.length}, identities=${parsedCount}`);
}

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

/**
 * 在目标 window 上安装 fetch 和 XMLHttpRequest 被动拦截器
 */
export function installSquarefeedInterceptor(
  targetWindow?: Window & typeof globalThis,
  store: FeedIdentityStore = FeedIdentityStore.getInstance()
): void {
  const resolvedWindow =
    targetWindow ?? (typeof unsafeWindow !== 'undefined' ? unsafeWindow : typeof window !== 'undefined' ? window : undefined);
  if (!resolvedWindow) return;

  const win = resolvedWindow as unknown as {
    fetch: typeof fetch;
    XMLHttpRequest: typeof XMLHttpRequest;
    __XHS_SQUAREFEED_INTERCEPTOR_INSTALLED__?: boolean;
  };

  if (!win || win.__XHS_SQUAREFEED_INTERCEPTOR_INSTALLED__) {
    return;
  }
  win.__XHS_SQUAREFEED_INTERCEPTOR_INSTALLED__ = true;

  // 1. Hook window.fetch
  const originalFetch = win.fetch;
  if (typeof originalFetch === 'function') {
    win.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const response = await originalFetch.apply(this, args);
      try {
        const input = args[0];
        const requestUrl = typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.toString()
          : input instanceof Request
          ? input.url
          : '';

        if (isSquarefeedUrl(requestUrl)) {
          // 被动克隆，不影响原调用链路
          const clone = response.clone();
          clone.json().then(
            (data) => processSquarefeedPayload(data, store),
            () => {
              // 尝试 text 兜底解析
              clone.text().then(
                (text) => {
                  try {
                    processSquarefeedPayload(JSON.parse(text), store);
                  } catch {
                    // fail-soft
                  }
                },
                () => {}
              );
            }
          );
        }
      } catch {
        // fail-soft: 绝不抛出任何异常阻断页面 fetch
      }
      return response;
    };
  }

  // 2. Hook window.XMLHttpRequest
  const OriginalXHR = win.XMLHttpRequest;
  if (typeof OriginalXHR === 'function') {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (
      this: XMLHttpRequest & { _xhsUrl?: string },
      method: string,
      url: string | URL,
      ...rest: [boolean?, (string | null)?, (string | null)?]
    ) {
      try {
        this._xhsUrl = typeof url === 'string' ? url : url.toString();
      } catch {
        // ignore
      }
      return originalOpen.apply(this, [method, url, ...rest] as Parameters<typeof originalOpen>);
    };

    OriginalXHR.prototype.send = function (
      this: XMLHttpRequest & { _xhsUrl?: string },
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      try {
        if (this._xhsUrl && isSquarefeedUrl(this._xhsUrl)) {
          const xhrSelf = this;
          this.addEventListener('load', function () {
            try {
              let parsed: unknown = null;
              if (xhrSelf.responseType === '' || xhrSelf.responseType === 'text') {
                parsed = JSON.parse(xhrSelf.responseText);
              } else if (xhrSelf.responseType === 'json') {
                parsed = xhrSelf.response;
              }
              if (parsed) {
                processSquarefeedPayload(parsed, store);
              }
            } catch {
              // fail-soft
            }
          });
        }
      } catch {
        // fail-soft
      }
      return originalSend.call(this, body);
    };
  }
}
