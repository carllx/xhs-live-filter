/**
 * beta.5 显式授权门禁与默认 0 主动请求回归测试
 * 覆盖：
 * 1. Fresh install 默认 profileEnrichmentEnabled=false，即使 preferredRegions=['广东']，主动 profile requests = 0
 * 2. 存量迁移用户缺失 profileEnrichmentEnabled 键时，严格 Fail-Closed 为 false，0 请求
 * 3. 勾选授权前，无论怎样设置属地，0 请求
 * 4. 仅在用户显式勾选授权后，才启动视口队列与网络请求
 * 5. 排队进行中，用户取消勾选授权，清空待处理队列，阻断在途任务执行，无后续请求
 * 6. 未授权状态下，被动捕获的 squarefeed 身份正常绑定
 * 7. 未授权状态下，已有缓存数据正常过滤并展示 TARGET Badge
 * 8. 未授权状态下，未缓存数据保持 Fail-Open 正常展示
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { FeedIdentityStore } from '../src/network/feed-identity-store';
import { createLiveSquareFixture } from './fixtures/live-dom';

describe('Safety Consent Regression (v0.1.3-beta.5)', () => {
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

  it('1. Fresh install 默认 profileEnrichmentEnabled=false，默认启动 0 主动网络请求', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, text: '<html></html>' });
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher);
    // 验证默认 policy
    expect(app.getPolicy().profileEnrichmentEnabled).toBe(false);
    expect(app.getPolicy().preferredRegions).toEqual(['广东']);

    app.start(fixture);

    await new Promise((r) => setTimeout(r, 100));

    // 默认启动严格 0 请求
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it('2. 存量迁移保护：本地存有 preferredRegions 但缺失 profileEnrichmentEnabled 键，严格 Fail-Closed 为 false', async () => {
    localStorage.setItem('xhs_filter_preferredRegions', JSON.stringify(['广东']));
    localStorage.setItem('xhs_filter_contentKeyword', JSON.stringify('直播'));
    // 注意：未写入 xhs_filter_profileEnrichmentEnabled

    const fetchFn = vi.fn().mockResolvedValue({ status: 200, text: '<html></html>' });
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher);
    expect(app.getPolicy().profileEnrichmentEnabled).toBe(false);
    expect(app.getPolicy().preferredRegions).toEqual(['广东']);

    app.start(fixture);

    await new Promise((r) => setTimeout(r, 100));
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it('3. 仅调整属地或关键词而不开启授权复选框，始终保持 0 请求', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200, text: '<html></html>' });
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher);
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchFn).toHaveBeenCalledTimes(0);

    // 调整属地为多种组合
    app.setPolicy({ preferredRegions: ['广东', '上海', '北京'] });
    await new Promise((r) => setTimeout(r, 80));
    expect(fetchFn).toHaveBeenCalledTimes(0);

    // 设置关键词
    app.setPolicy({ contentKeyword: '美妆' });
    await new Promise((r) => setTimeout(r, 80));
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it('4. 显式勾选授权复选框后，才按队列调度发起网络请求', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东广州"}}}};</script></html>',
    });
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchFn).toHaveBeenCalledTimes(0);

    // 显式开启授权
    app.setPolicy({ profileEnrichmentEnabled: true });

    await new Promise((r) => setTimeout(r, 200));
    expect(fetchFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('5. 排队进行中取消授权，清空排队队列并阻断后续请求', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 40));
      return {
        status: 200,
        text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
      };
    });
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
    app.start(fixture);

    // 开启授权开始执行第 1 个任务
    app.setPolicy({ profileEnrichmentEnabled: true });
    await new Promise((r) => setTimeout(r, 10));

    // 立即关闭授权
    app.setPolicy({ profileEnrichmentEnabled: false });

    // 等待足够长的时间（若没有清空队列，原本会执行完所有 3 个卡片）
    await new Promise((r) => setTimeout(r, 200));

    // 确认关闭授权后，排队任务被清空，后续请求被阻断
    expect(callCount).toBeLessThan(3);
  });

  it('6. 未授权状态下，被动捕获的 squarefeed 身份正常绑定 (Passive capture is independent)', async () => {
    const store = FeedIdentityStore.getInstance();
    store.clear();

    const fetchFn = vi.fn();
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher, undefined, undefined, store);
    app.start(document.body);

    const card = document.createElement('div');
    card.className = 'live-item';
    card.innerHTML = `<a href="/livestream/live_test_123">直播测试</a>`;
    document.body.appendChild(card);

    // 模拟被动 squarefeed 拦截到来
    store.addIdentity({
      liveId: 'live_test_123',
      userId: 'user_anchor_999',
      title: '直播测试',
      nickname: '测试主播',
    });

    await new Promise((r) => setTimeout(r, 50));

    // 验证身份绑定成功，但 0 主动网络请求
    expect(app.getBoundCardCount()).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it('7. 未授权状态下，缓存中已有的 facts 正常用于过滤和 TARGET 标记', async () => {
    const fetchFn = vi.fn();
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher);
    // 写入缓存已有的广东主播 facts
    app.getCache().set('user_001', {
      userId: 'user_001',
      region: '广东广州',
      rawGender: 0,
      gender: 'unknown',
      age: 'unknown',
      enriched: true,
    });

    app.start(fixture);

    await new Promise((r) => setTimeout(r, 50));

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    expect(card1.style.visibility).toBe('visible');
    const badge = card1.querySelector('.xhs-filter-badge');
    expect(badge?.textContent).toBe('广东广州');
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it('8. 未授权状态下，未缓存卡片保持 Fail-Open (显示且无无用 Badge)', async () => {
    const fetchFn = vi.fn();
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher);
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 50));

    // card-1, card-2, card-3 均无缓存且未授权，保持 Fail-Open 可见
    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement;
    expect(card1.style.visibility).toBe('visible');
    expect(card2.style.visibility).toBe('visible');
    expect(card1.querySelector('.xhs-filter-badge')).toBeNull();
    expect(card2.querySelector('.xhs-filter-badge')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });
});
