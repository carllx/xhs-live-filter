/**
 * 公开 Profile SSR HTML 数据拉取与解析器
 * 路径：/user/profile/{userId}
 * 解析 __INITIAL_STATE__ 或 HTML 内容获取 coarse IP-location 与 raw gender
 */

import { NormalizedFacts } from '../domain/facts';

export type HttpFetcher = (url: string) => Promise<{ status: number; text: string }>;

export class ProfileFetcher {
  private fetcher: HttpFetcher;

  constructor(fetcher?: HttpFetcher) {
    this.fetcher = fetcher || this.defaultFetch;
  }

  private async defaultFetch(url: string): Promise<{ status: number; text: string }> {
    const origin = typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'https://www.xiaohongshu.com';
    const targetUrl = url.startsWith('http') ? url : `${origin}${url}`;

    const res = await fetch(targetUrl, {
      credentials: 'same-origin',
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

    // 检查风控限流与异常
    if (status === 429) {
      const err = new Error(`HTTP 429 Too Many Requests`);
      (err as { isRateLimited?: boolean }).isRateLimited = true;
      throw err;
    }

    if (text.includes('captcha') || text.includes('验证码') || text.includes('sec.xiaohongshu.com')) {
      const err = new Error(`Verification page detected`);
      (err as { isVerification?: boolean }).isVerification = true;
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
        const user = state?.user?.userPageData?.basicInfo || state?.user?.user?.basicInfo || state?.user?.userPageData;
        if (user) {
          if (user.gender !== undefined) {
            rawGender = user.gender;
          }
          if (user.ipLocation) {
            ipLocation = user.ipLocation;
          }
        }
      } catch (e) {
        // JSON 解析失败则降级到正则抽取
      }
    }

    // 2. 降级：从 HTML 文本或标签中正则匹配 ipLocation
    if (ipLocation === 'unknown') {
      const ipMatch = html.match(/IP\s*属地[：:]\s*([^\s<"']+)/) ||
                      html.match(/"ipLocation"\s*:\s*"([^"]+)"/);
      if (ipMatch && ipMatch[1]) {
        ipLocation = ipMatch[1];
      }
    }

    if (rawGender === undefined) {
      const genderMatch = html.match(/"gender"\s*:\s*([0-9]+)/);
      if (genderMatch && genderMatch[1]) {
        rawGender = parseInt(genderMatch[1], 10);
      }
    }

    // 属地标签清洗（移除“中国”前缀，保留省/国级粗粒度）
    let cleanRegion = ipLocation.replace(/^中国\s*/, '').trim();
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
