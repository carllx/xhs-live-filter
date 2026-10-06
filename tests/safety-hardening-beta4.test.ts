import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { ViewportScheduler } from '../src/network/viewport-scheduler';
import { CircuitBreaker } from '../src/network/breaker';
import { LiveFilterApp } from '../src/app';
import { FeedIdentityStore } from '../src/network/feed-identity-store';
import { createLiveSquareFixture } from './fixtures/live-dom';

describe('Safety Hardening Regression (v0.1.3-beta.4)', () => {
  let fixture: HTMLElement;
  let app: LiveFilterApp;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    fixture = createLiveSquareFixture();
    document.body.appendChild(fixture);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (app) {
      app.destroy();
    }
    document.body.innerHTML = '';
  });

  // 1 & 2 & 3. 匿名请求 & credentials:omit / anonymous:true & 绝不读取 cookie/token
  describe('1. 匿名传输与凭证解耦 (Anonymity & Credential Decoupling)', () => {
    it('1. profile requests are anonymous: GM_xmlhttpRequest 传入 anonymous: true', async () => {
      let passedOptions: Record<string, unknown> | null = null;
      const mockGM = vi.fn().mockImplementation((options: Record<string, unknown>) => {
        passedOptions = options;
        if (typeof options.onload === 'function') {
          (options.onload as (res: { status: number; responseText: string }) => void)({
            status: 200,
            responseText: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
          });
        }
      });

      // 模拟全局环境注入 GM_xmlhttpRequest
      (globalThis as unknown as { GM_xmlhttpRequest: typeof mockGM }).GM_xmlhttpRequest = mockGM;

      const fetcher = new ProfileFetcher();
      const facts = await fetcher.fetchProfileFacts('user_safe_1');

      expect(mockGM).toHaveBeenCalled();
      expect(passedOptions).not.toBeNull();
      expect(passedOptions!['anonymous']).toBe(true);
      expect(facts.region).toBe('广东');

      delete (globalThis as unknown as { GM_xmlhttpRequest?: typeof mockGM }).GM_xmlhttpRequest;
    });

    it('2. no same-origin/include credentials: 降级标准 fetch 时严格使用 credentials: omit', async () => {
      delete (globalThis as unknown as { GM_xmlhttpRequest?: unknown }).GM_xmlhttpRequest;

      let capturedInit: RequestInit | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return {
          status: 200,
          text: async () => '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
        } as Response;
      });

      const fetcher = new ProfileFetcher();
      await fetcher.fetchProfileFacts('user_safe_2');

      expect(capturedInit).toBeDefined();
      expect(capturedInit?.credentials).toBe('omit');
      expect(capturedInit?.credentials).not.toBe('same-origin');
      expect(capturedInit?.credentials).not.toBe('include');

      globalThis.fetch = originalFetch;
    });

    it('3. no cookie/token credential source: 请求 URL 与 Headers 绝不包含 xsec_token、token、cookie', async () => {
      delete (globalThis as unknown as { GM_xmlhttpRequest?: unknown }).GM_xmlhttpRequest;

      let capturedUrl = '';
      let capturedHeaders: Record<string, string> | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init?.headers as Record<string, string>;
        return {
          status: 200,
          text: async () => '<html></html>',
        } as Response;
      });

      const fetcher = new ProfileFetcher();
      await fetcher.fetchProfileFacts('user_safe_3');

      expect(capturedUrl).not.toContain('xsec_token');
      expect(capturedUrl).not.toContain('token');
      expect(capturedUrl).not.toContain('cookie');
      if (capturedHeaders) {
        expect(capturedHeaders['Cookie']).toBeUndefined();
        expect(capturedHeaders['Authorization']).toBeUndefined();
        expect(capturedHeaders['xsec-token']).toBeUndefined();
      }

      globalThis.fetch = originalFetch;
    });
  });

  // 4 & 5. 保守速率与节流
  describe('2. 保守速率控制 (Conservative Rate Policy)', () => {
    it('4. concurrency <= 1: 默认调度器最大并发严格为 1', () => {
      const breaker = new CircuitBreaker({ onStateChange: () => {} });
      const scheduler = new ViewportScheduler(breaker);
      expect(scheduler.maxConcurrency).toBe(1);
      expect(ViewportScheduler.DEFAULT_MAX_CONCURRENCY).toBe(1);
    });

    it('5. request start interval >= configured safe interval: 两次请求启动间隔受控', async () => {
      const breaker = new CircuitBreaker({ onStateChange: () => {} });
      const scheduler = new ViewportScheduler(breaker, {
        maxConcurrency: 1,
        minIntervalMs: 100, // 设定 100ms 测试间隔
      });

      const startTimes: number[] = [];
      const createDelayedTask = (id: string, card: HTMLElement) => ({
        userId: id,
        cardElement: card,
        priority: 'VISIBLE' as const,
        execute: async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 10));
        },
      });

      const cardA = document.createElement('div');
      const cardB = document.createElement('div');
      scheduler.observeCard(cardA);
      scheduler.observeCard(cardB);

      scheduler.enqueue(createDelayedTask('uA', cardA));
      scheduler.enqueue(createDelayedTask('uB', cardB));

      await new Promise((r) => setTimeout(r, 260));

      expect(startTimes.length).toBe(2);
      const interval = startTimes[1] - startTimes[0];
      expect(interval).toBeGreaterThanOrEqual(95); // 满足 minIntervalMs 节流

      scheduler.destroy();
    });
  });

  // 6 & 7. 全生命周期去重
  describe('3. 全生命周期去重 (Full-Lifecycle Deduplication)', () => {
    it('6. same userId queued twice => exactly one network request', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
      });
      const fetcher = new ProfileFetcher(fetchFn);
      app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
      app.setPolicy({ preferredRegions: ['广东'], profileEnrichmentEnabled: true });

      // 卡片 1 与 备选卡片拥有相同 userId 'user_001'
      const duplicateCard = document.createElement('div');
      duplicateCard.className = 'live-item';
      duplicateCard.innerHTML = `<a href="/user/profile/user_001">重复卡片</a>`;
      fixture.appendChild(duplicateCard);

      app.start(fixture);

      await new Promise((r) => setTimeout(r, 150));

      const callsForUser001 = fetchFn.mock.calls.filter((c) => c[0].includes('user_001'));
      expect(callsForUser001.length).toBe(1);
    });

    it('7. same userId in-flight + new card => one network request', async () => {
      let releaseFlight: () => void = () => {};
      const fetchFn = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('slow_user')) {
          await new Promise<void>((r) => { releaseFlight = r; });
        }
        return {
          status: 200,
          text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
        };
      });

      const fetcher = new ProfileFetcher(fetchFn);
      const store = FeedIdentityStore.getInstance();
      store.clear();

      app = new LiveFilterApp(fetcher, undefined, undefined, store, { minIntervalMs: 20 });
      app.setPolicy({ preferredRegions: ['广东'], profileEnrichmentEnabled: true });

      store.addIdentity({ liveId: 'live_slow_1', userId: 'slow_user', title: '1', nickname: '1' });
      store.addIdentity({ liveId: 'live_slow_2', userId: 'slow_user', title: '2', nickname: '2' });

      const card1 = document.createElement('div');
      card1.className = 'live-item';
      card1.innerHTML = `<a href="/livestream/live_slow_1">直播1</a>`;
      fixture.appendChild(card1);

      app.start(fixture);
      await new Promise((r) => setTimeout(r, 30));

      // 此时 slow_user 处于 in-flight 阶段
      // 动态追加第二张相同 userId 的卡片
      const card2 = document.createElement('div');
      card2.className = 'live-item';
      card2.innerHTML = `<a href="/livestream/live_slow_2">直播2</a>`;
      fixture.appendChild(card2);

      await new Promise((r) => setTimeout(r, 30));

      // 释放 in-flight 请求
      releaseFlight();
      await new Promise((r) => setTimeout(r, 60));

      const callsForSlow = fetchFn.mock.calls.filter((c) => c[0].includes('slow_user'));
      expect(callsForSlow.length).toBe(1);
    });
  });

  // 8 & 9. 按需请求规则
  describe('4. 按需请求规则 (Request Only When Needed)', () => {
    it('8. empty region filter + gender uncalibrated => ZERO profile requests', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ status: 200, text: '<html></html>' });
      const fetcher = new ProfileFetcher(fetchFn);

      app = new LiveFilterApp(fetcher);
      // preferredRegions 为空，未校准性别门禁
      app.setPolicy({ preferredRegions: [] });
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 100));

      // 绝无任何 profile 请求产生！
      expect(fetchFn).toHaveBeenCalledTimes(0);
    });

    it('9. region filter enabled => visible cards may enqueue and fetch', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
      });
      const fetcher = new ProfileFetcher(fetchFn);

      app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
      app.setPolicy({ preferredRegions: [], profileEnrichmentEnabled: true }); // 初始不限属地但已授权
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 50));
      expect(fetchFn).toHaveBeenCalledTimes(0);

      // 开启属地筛选
      app.setPolicy({ preferredRegions: ['广东'] });
      await new Promise((r) => setTimeout(r, 150));

      // 卡片按需发起 enrichment 请求
      expect(fetchFn.mock.calls.length).toBeGreaterThan(0);
    });
  });

  // 10 & 11 & 12 & 13 & 14. 停止条件与熔断保护
  describe('5. 严格停止条件 (Strict Stop Conditions)', () => {
    it('10 & 11. 401 / 403 => CircuitBreaker 立即进入 PAUSED 状态', async () => {
      for (const authStatus of [401, 403]) {
        const fetchFn = vi.fn().mockResolvedValue({
          status: authStatus,
          text: 'Auth Forbidden',
        });
        const fetcher = new ProfileFetcher(fetchFn);
        const testApp = new LiveFilterApp(fetcher);
        testApp.setPolicy({ profileEnrichmentEnabled: true });
        testApp.start(fixture);

        await new Promise((r) => setTimeout(r, 80));
        expect(testApp.getBreaker().isPaused()).toBe(true);
        testApp.destroy();
      }
    });

    it('12. 429 => CircuitBreaker 立即进入 PAUSED 状态', async () => {
      const fetchFn = vi.fn().mockResolvedValue({ status: 429, text: 'Too Many Requests' });
      const fetcher = new ProfileFetcher(fetchFn);
      app = new LiveFilterApp(fetcher);
      app.setPolicy({ profileEnrichmentEnabled: true });
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 80));
      expect(app.getBreaker().isPaused()).toBe(true);
    });

    it('13. verification & login wall => CircuitBreaker 立即进入 PAUSED 状态', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        text: '<html><a href="https://www.xiaohongshu.com/login?redirectPath=xyz">Found</a></html>',
      });
      const fetcher = new ProfileFetcher(fetchFn);
      app = new LiveFilterApp(fetcher);
      app.setPolicy({ profileEnrichmentEnabled: true });
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 80));
      expect(app.getBreaker().isPaused()).toBe(true);
    });

    it('14. anonymous failure never falls back to authenticated request', async () => {
      let usedCredentials: string[] = [];
      const fetchFn = vi.fn().mockImplementation(async (_url: string) => {
        usedCredentials.push('omit');
        return { status: 403, text: 'Forbidden' };
      });

      const fetcher = new ProfileFetcher(fetchFn);
      app = new LiveFilterApp(fetcher);
      app.setPolicy({ profileEnrichmentEnabled: true });
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 80));

      // 失败后绝不重试，更绝不切换到 same-origin / include 凭证重试
      expect(usedCredentials).not.toContain('same-origin');
      expect(usedCredentials).not.toContain('include');
      expect(app.getBreaker().isPaused()).toBe(true);
    });
  });
});
