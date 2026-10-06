/**
 * 公开 Profile SSR HTML 数据拉取与解析器
 * 路径：/user/profile/{userId}
 * 解析 __INITIAL_STATE__ 或 HTML 内容获取 coarse IP-location 与 raw gender
 */

import { NormalizedFacts } from '../domain/facts';

export type HttpFetcher = (url: string) => Promise<{ status: number; text: string }>;

declare const GM_xmlhttpRequest:
  | ((details: {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      anonymous?: boolean;
      onload?: (response: { status: number; responseText: string; finalUrl?: string }) => void;
      onerror?: (error: unknown) => void;
      ontimeout?: () => void;
    }) => void)
  | undefined;

export interface ProfileFetchStats {
  transport: 'GM_xmlhttpRequest(anonymous)' | 'fetch(credentials:omit)';
  requested: number;
  cacheHit: number;
  deduped: number;
  pausedReason?: string;
}

export class ProfileFetcher {
  private fetcher: HttpFetcher;
  private static stats: ProfileFetchStats = {
    transport: typeof GM_xmlhttpRequest === 'function' ? 'GM_xmlhttpRequest(anonymous)' : 'fetch(credentials:omit)',
    requested: 0,
    cacheHit: 0,
    deduped: 0,
  };

  constructor(fetcher?: HttpFetcher) {
    this.fetcher = fetcher || this.defaultFetch;
  }

  static getStats(): ProfileFetchStats {
    return { ...this.stats };
  }

  static recordCacheHit(): void {
    this.stats.cacheHit++;
  }

  static recordDeduped(): void {
    this.stats.deduped++;
  }

  static recordPaused(reason: string): void {
    this.stats.pausedReason = reason;
    console.warn(`[xhs-live-filter] profile transport=${this.stats.transport} profile requested=${this.stats.requested} profile cache-hit=${this.stats.cacheHit} profile deduped=${this.stats.deduped} profile paused=${reason}`);
  }

  private async defaultFetch(url: string): Promise<{ status: number; text: string }> {
    ProfileFetcher.stats.requested++;
    const origin = typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'https://www.xiaohongshu.com';
    const targetUrl = url.startsWith('http') ? url : `${origin}${url}`;

    // 方案 1: 如果宿主环境支持 GM_xmlhttpRequest，优先采用 anonymous: true（无 Cookie、无授权）
    if (typeof GM_xmlhttpRequest === 'function') {
      ProfileFetcher.stats.transport = 'GM_xmlhttpRequest(anonymous)';
      return new Promise<{ status: number; text: string }>((resolve, reject) => {
        try {
          GM_xmlhttpRequest!({
            method: 'GET',
            url: targetUrl,
            anonymous: true, // 绝对不携带宿主 Cookies / Session 凭证
            headers: {
              'Accept': 'text/html,application/xhtml+xml',
            },
            onload: (res) => {
              resolve({ status: res.status, text: res.responseText });
            },
            onerror: (err) => {
              reject(err);
            },
            ontimeout: () => {
              reject(new Error('GM_xmlhttpRequest timeout'));
            },
          });
        } catch (e) {
          reject(e);
        }
      });
    }

    // 方案 2: 标准 fetch，严格使用 credentials: 'omit'，绝对不使用 same-origin 或 include
    ProfileFetcher.stats.transport = 'fetch(credentials:omit)';
    const res = await fetch(targetUrl, {
      credentials: 'omit', // 严格解耦：忽略任何当前登录账号 Cookie / Authorization
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    const text = await res.text();
    return { status: res.status, text };
  }

  /**
   * 拉取并解析 Anchor Profile Facts
   * @param userId Anchor userId
   */
  async fetchProfileFacts(userId: string): Promise<NormalizedFacts> {
    if (!userId) {
      throw new Error('UserId cannot be empty');
    }

    const url = `/user/profile/${userId}`;
    const { status, text } = await this.fetcher(url);

    // 严格风控与业务级限流判定 (XHS 300013 Rate Limit):
    // 1. 优先解析 JSON: code === 300013
    let is300013 = false;
    let limitMsg = '';
    try {
      const parsed = JSON.parse(text);
      if (parsed && (parsed.code === 300013 || parsed.code === '300013')) {
        is300013 = true;
        limitMsg = parsed.msg || parsed.message || '访问频次异常，请勿频繁操作或重启试试';
      }
    } catch {
      // 忽略非 JSON 格式
    }

    // 2. HTML/text fallback: 必须同时满足 contains "300013" AND 至少一个 rate-limit 语义词
    if (!is300013 && text.includes('300013')) {
      const hasRateLimitSemantic =
        text.includes('访问频次异常') ||
        text.includes('访问频率') ||
        text.includes('Too many requests') ||
        text.includes('Try again later');
      if (hasRateLimitSemantic) {
        is300013 = true;
        limitMsg = 'XHS 300013 rate limit';
      }
    }

    if (is300013) {
      const err = new Error(`XHS 300013 rate limit${limitMsg ? `: ${limitMsg}` : ''}`);
      (err as { isSecurityStop?: boolean; isRateLimited?: boolean; code?: number | string; reason?: string }).isSecurityStop = true;
      (err as { isSecurityStop?: boolean; isRateLimited?: boolean; code?: number | string; reason?: string }).isRateLimited = true;
      (err as { isSecurityStop?: boolean; isRateLimited?: boolean; code?: number | string; reason?: string }).code = 300013;
      (err as { isSecurityStop?: boolean; isRateLimited?: boolean; code?: number | string; reason?: string }).reason = 'XHS 300013 rate limit';
      throw err;
    }

    // 严格风控与登录拦截判定 (ADR / Safety Hardening):
    // 遇到 HTTP 401, 403, 429, 验证码、登录页重定向或登录弹窗墙立即触发安全停止
    if (status === 401 || status === 403) {
      const err = new Error(`HTTP ${status} Auth/Forbidden`);
      (err as { isSecurityStop?: boolean; reason?: string }).isSecurityStop = true;
      (err as { isSecurityStop?: boolean; reason?: string }).reason = `HTTP ${status}`;
      throw err;
    }

    if (status === 429) {
      const err = new Error(`HTTP 429 Too Many Requests`);
      (err as { isRateLimited?: boolean; isSecurityStop?: boolean; reason?: string }).isRateLimited = true;
      (err as { isSecurityStop?: boolean; reason?: string }).isSecurityStop = true;
      (err as { isRateLimited?: boolean; isSecurityStop?: boolean; reason?: string }).reason = 'HTTP 429';
      throw err;
    }

    if (
      text.includes('captcha') ||
      text.includes('验证码') ||
      text.includes('sec.xiaohongshu.com') ||
      text.includes('/login?redirectPath=') ||
      text.includes('loginPadMountedTime') ||
      text.includes('登录后推荐更懂你的笔记')
    ) {
      // 检查是否是纯登录重定向/拦截页面
      const isCaptcha = text.includes('captcha') || text.includes('验证码') || text.includes('sec.xiaohongshu.com');
      const isLoginWall = text.includes('/login?redirectPath=') || text.includes('loginPadMountedTime') || text.includes('登录后推荐更懂你的笔记');
      const reason = isCaptcha ? 'captcha verification' : isLoginWall ? 'login wall redirect' : 'security page detected';
      const err = new Error(isCaptcha ? 'Verification page detected' : `Security stop triggered: ${reason}`);
      (err as { isVerification?: boolean; isSecurityStop?: boolean; reason?: string }).isVerification = isCaptcha;
      (err as { isVerification?: boolean; isSecurityStop?: boolean; reason?: string }).isSecurityStop = true;
      (err as { isVerification?: boolean; isSecurityStop?: boolean; reason?: string }).reason = reason;
      throw err;
    }

    if (status >= 400) {
      throw new Error(`Profile request failed with status ${status}`);
    }

    return this.parseProfileHtml(userId, text);
  }

  /**
   * 解析 Profile HTML 或 __INITIAL_STATE__
   */
  parseProfileHtml(userId: string, html: string): NormalizedFacts {
    let rawGender: number | string | undefined = undefined;
    let ipLocation = 'unknown';

    // 1. 尝试从 window.__INITIAL_STATE__ 匹配 JSON
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?<\/script>/s);
    if (stateMatch && stateMatch[1]) {
      try {
        // 部分字段可能带有 undefined，做基础净化
        const cleanJson = stateMatch[1].replace(/:\s*undefined/g, ': null');
        const state = JSON.parse(cleanJson);
        const user =
          state?.user?.userPageData?.basicInfo ||
          state?.user?.userInfo?.basicInfo ||
          state?.user?.user?.basicInfo ||
          state?.user?.userPageData ||
          state?.user?.userInfo;

        if (user) {
          if (user.gender !== undefined) {
            rawGender = user.gender;
          }
          if (user.ipLocation) {
            ipLocation = user.ipLocation;
          } else if (user.location) {
            ipLocation = user.location;
          }
        }
      } catch (e) {
        // JSON 解析失败则降级到正则抽取
      }
    }

    // 2. 降级：从 HTML 文本、unicode 转义或属性中正则匹配 ipLocation / 属地
    if (ipLocation === 'unknown') {
      const ipMatch =
        html.match(/IP\s*属地[：:\s]+([^\s<"']+)/) ||
        html.match(/IP(?:\\u0020)*\\u5c5e\\u5730[：:\s\\uff1a]+([^\s<"'\\]+)/) ||
        html.match(/"ipLocation"\s*:\s*"([^"]+)"/) ||
        html.match(/\\?"ipLocation\\?"\s*:\s*\\?"([^"\\]+)\\?"/);
      if (ipMatch && ipMatch[1]) {
        ipLocation = ipMatch[1];
      }
    }

    if (rawGender === undefined) {
      const genderMatch =
        html.match(/"gender"\s*:\s*([0-9]+)/) ||
        html.match(/\\?"gender\\?"\s*:\s*([0-9]+)/);
      if (genderMatch && genderMatch[1]) {
        rawGender = parseInt(genderMatch[1], 10);
      }
    }

    // 属地标签清洗（移除“中国”前缀，保留完整公开属地如“广东广州”、“贵州贵阳”）
    let cleanRegion = ipLocation.replace(/^中国\s*/, '').trim();
    // 移除常见多余字样如“IP属地：”
    cleanRegion = cleanRegion.replace(/^IP\s*属地[：:]\s*/, '').trim();
    if (!cleanRegion) cleanRegion = 'unknown';

    return {
      userId,
      rawGender,
      // 未校准状态下始终为 unknown (ADR-0003)
      gender: 'unknown',
      region: cleanRegion,
      age: 'unknown',
      enriched: true,
    };
  }
}
