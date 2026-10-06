import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { createLiveSquareFixture } from './fixtures/live-dom';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { ProfileCache } from '../src/network/cache';

describe('Ticket #3: Visible-card Profile Enrichment + 广东优先闭环', () => {
  let fixture: HTMLElement;
  let app: LiveFilterApp;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    fixture = createLiveSquareFixture();
    document.body.appendChild(fixture);
  });

  afterEach(() => {
    if (app) {
      app.destroy();
    }
    document.body.innerHTML = '';
  });

  it('单元测试：ProfileFetcher 正确解析 SSR HTML 与 __INITIAL_STATE__', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>
            window.__INITIAL_STATE__ = {
              "user": {
                "userPageData": {
                  "basicInfo": {
                    "nickname": "广州好物",
                    "gender": 1,
                    "ipLocation": "中国 广东"
                  }
                }
              }
            };
          </script>
        </head>
      </html>
    `;

    const fetcher = new ProfileFetcher(async (url) => {
      expect(url).toBe('/user/profile/user_001');
      return { status: 200, text: mockHtml };
    });

    const facts = await fetcher.fetchProfileFacts('user_001');
    expect(facts.userId).toBe('user_001');
    expect(facts.rawGender).toBe(1);
    expect(facts.gender).toBe('unknown'); // UNCALIBRATED 状态
    expect(facts.region).toBe('广东');
    expect(facts.age).toBe('unknown');
    expect(facts.enriched).toBe(true);
  });

  it('单元测试：L1 + L2 两级缓存有效拦截重复网络请求', async () => {
    const mockFetcherFn = vi.fn().mockResolvedValue({
      status: 200,
      text: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":0,"ipLocation":"广东"}}}};</script>',
    });

    const fetcher = new ProfileFetcher(mockFetcherFn);
    const cache = new ProfileCache();
    cache.clear();

    // 第一次拉取
    const facts1 = await fetcher.fetchProfileFacts('user_001');
    cache.set('user_001', facts1);
    expect(mockFetcherFn).toHaveBeenCalledTimes(1);

    // 第二次直接从缓存读取
    const cachedFacts = cache.get('user_001');
    expect(cachedFacts).not.toBeNull();
    expect(cachedFacts?.region).toBe('广东');
    // 没有发生第二次网络请求
    expect(mockFetcherFn).toHaveBeenCalledTimes(1);
  });

  it('单元测试：异常响应（429/验证码）不写入成功 Profile 缓存', async () => {
    const cache = new ProfileCache();
    cache.clear();

    const fetcher429 = new ProfileFetcher(async () => ({
      status: 429,
      text: 'Too Many Requests',
    }));

    await expect(fetcher429.fetchProfileFacts('user_block')).rejects.toThrow('429');
    expect(cache.get('user_block')).toBeNull();

    const fetcherCaptcha = new ProfileFetcher(async () => ({
      status: 200,
      text: '<html><div class="captcha-box">请输入验证码</div></html>',
    }));

    await expect(fetcherCaptcha.fetchProfileFacts('user_captcha')).rejects.toThrow('Verification');
    expect(cache.get('user_captcha')).toBeNull();
  });

  it('集成测试：无可靠 userId 的卡片产生 0 请求并严格 Fail-Open (CANDIDATE)', async () => {
    const fetchCalls: string[] = [];
    const mockFetcher = new ProfileFetcher(async (url) => {
      fetchCalls.push(url);
      return { status: 200, text: '<html></html>' };
    });

    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);

    // 等待异步完成
    await new Promise((r) => setTimeout(r, 50));

    // Card 4 在 fixture 中没有 userId
    const card4 = fixture.querySelector('[data-id="card-4"]') as HTMLElement;
    // Card 4 绝不发起请求
    expect(fetchCalls.some((url) => url.includes('card-4'))).toBe(false);

    // Card 4 保持可见（默认 keepUnknownRegion=true），CANDIDATE 无任何杂质 Badge
    expect(card4.style.visibility).toBe('visible');
    const badge = card4.querySelector('.xhs-filter-badge');
    expect(badge).toBeNull();
  });

  it('集成测试：卡片命中广东标记为 TARGET（极小事实标签），非偏好属地真实过滤隐藏', async () => {
    const mockProfiles: Record<string, string> = {
      user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":0,"ipLocation":"上海"}}}};</script>',
      user_003: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
    };

    const mockFetcher = new ProfileFetcher(async (url) => {
      const match = url.match(/\/user\/profile\/(.+)/);
      const uid = match ? match[1] : '';
      const text = mockProfiles[uid] || '<html></html>';
      return { status: 200, text };
    });

    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);

    // 等待并发队列处理完毕
    await new Promise((r) => setTimeout(r, 300));

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement; // 广东
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement; // 上海
    const card3 = fixture.querySelector('[data-id="card-3"]') as HTMLElement; // 广东

    // Card 1: 广东 => TARGET，显示极小事实标签 "广东"
    const badge1 = card1.querySelector('.xhs-filter-badge');
    expect(badge1?.textContent).toBe('广东');

    // Card 2: 上海 => 默认属地筛选过滤，真实隐藏；无任何普通 Badge
    expect(card2.style.visibility).toBe('hidden');
    expect(card2.querySelector('.xhs-filter-badge')).toBeNull();

    // Card 3: 广东 => TARGET，显示极小事实标签 "广东"
    const badge3 = card3.querySelector('.xhs-filter-badge');
    expect(badge3?.textContent).toBe('广东');

    // 统计更新：显示 3 / 4（card1, card3, 以及 unknown 的 card4）
    const panel = app.getUI().getPanelElement();
    const statsText = panel.querySelector('.stats-text');
    expect(statsText?.textContent).toContain('显示 3 / 4 张卡片');
  });
});
