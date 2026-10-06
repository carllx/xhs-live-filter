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
let firstFeedSchemaLogged = false;

/**
 * 生成安全的结构化 schema 诊断对象（仅输出 keys 和类型，不输出敏感字符串值）
 */
function buildSafeStructuralSchema(obj: unknown, depth = 0, maxDepth = 3): unknown {
  if (depth > maxDepth || !obj || typeof obj !== 'object') {
    return typeof obj;
  }
  if (Array.isArray(obj)) {
    return [obj.length > 0 ? buildSafeStructuralSchema(obj[0], depth + 1, maxDepth) : 'empty_array'];
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      result[k] = buildSafeStructuralSchema(v, depth + 1, maxDepth);
    } else {
      result[k] = typeof v;
    }
  }
  return result;
}

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

  // 生产环境诊断：仅在首次捕获时打印首条 feed 的受限安全结构，协助现场定位
  if (!firstFeedSchemaLogged && feeds[0]) {
    firstFeedSchemaLogged = true;
    try {
      const safeSchema = buildSafeStructuralSchema(feeds[0]);
      console.log('[xhs-live-filter] squarefeed first-feed schema:', JSON.stringify(safeSchema));
    } catch {
      // fail-soft
    }
  }

  store.incrementCapturedCount(feeds.length);
  let parsedCount = 0;

  for (const item of feeds) {
    if (!item || typeof item !== 'object') continue;
    const rawItem = item as Record<string, any>;
    const live = rawItem.live ?? rawItem;

    // 适配真实 raw 响应（snake_case）与经过 axios 拦截器转换后的（camelCase）
    const roomInfo =
      live.t_room_info ??
      live.tRoomInfo ??
      live.room_info ??
      live.roomInfo;

    const hostInfo =
      live.t_live_host_info ??
      live.tLiveHostInfo ??
      live.host_info ??
      live.hostInfo ??
      live.anchor_info ??
      live.anchorInfo;

    const liveId = (
      roomInfo?.room_id_str ??
      roomInfo?.roomIdStr ??
      roomInfo?.room_id ??
      roomInfo?.roomId ??
      live.room_id_str ??
      live.roomIdStr ??
      live.room_id ??
      live.roomId ??
      ''
    ).toString().trim();

    const userId = (
      hostInfo?.user_id ??
      hostInfo?.userId ??
      hostInfo?.anchor_id ??
      hostInfo?.anchorId ??
      live.user_id ??
      live.userId ??
      ''
    ).toString().trim();

    const nickname = (
      hostInfo?.nickname ??
      hostInfo?.nick_name ??
      hostInfo?.name ??
      ''
    ).toString().trim();

    const title = (
      roomInfo?.name ??
      roomInfo?.title ??
      live.name ??
      live.title ??
      ''
    ).toString().trim();

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
