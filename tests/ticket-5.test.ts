import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { createLiveSquareFixture } from './fixtures/live-dom';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { CircuitBreaker } from '../src/network/breaker';
import { ViewportScheduler } from '../src/network/viewport-scheduler';

describe('Ticket #5: Safety Hardened Viewport Scheduling & Paused Probe Recovery', () => {
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

  it('单元测试：ViewportScheduler 保证最大并发 <= 2 且丢弃 STALE 卡片', async () => {
    const breaker = new CircuitBreaker({ onStateChange: () => {} });
    const scheduler = new ViewportScheduler(breaker);

    let activeConcurrency = 0;
    let maxObservedConcurrency = 0;

    const createMockTask = (id: string, card: HTMLElement, delay: number = 30) => ({
      userId: id,
      cardElement: card,
      priority: 'VISIBLE' as const,
      execute: async () => {
        activeConcurrency++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
        await new Promise((r) => setTimeout(r, delay));
        activeConcurrency--;
      },
    });

    const card1 = document.createElement('div');
    const card2 = document.createElement('div');
    const card3 = document.createElement('div');
    const cardStale = document.createElement('div');

    scheduler.observeCard(card1);
    scheduler.observeCard(card2);
    scheduler.observeCard(card3);
    scheduler.observeCard(cardStale);

    // 将 cardStale 标记为 STALE
    scheduler.setCardPriority(cardStale, 'STALE');

    // 压入 4 个任务
    scheduler.enqueue(createMockTask('u1', card1));
    scheduler.enqueue(createMockTask('u2', card2));
    scheduler.enqueue(createMockTask('u3', card3));
    scheduler.enqueue(createMockTask('u_stale', cardStale));

    // STALE 任务应在入队时被丢弃
    expect(scheduler.getQueueLength()).toBeLessThan(4);

    // 等待所有任务完成
    await new Promise((r) => setTimeout(r, 400));

    // 并发上限始终 <= 2
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(scheduler.getInFlightCount()).toBe(0);

    scheduler.destroy();
  });

  it('集成测试：遭遇 HTTP 429 立即熔断进入 PAUSED 状态，停止后续新请求，UI 显示风控警告', async () => {
    let requestCount = 0;
    const fetchFn = vi.fn().mockImplementation(async (_url: string) => {
      requestCount++;
      if (requestCount === 1) {
        // 第 1 个请求返回 429
        return { status: 429, text: 'Too Many Requests' };
      }
      return {
        status: 200,
        text: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      };
    });

    const mockFetcher = new ProfileFetcher(fetchFn);
    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);

    // 等待第一次请求触发 429
    await new Promise((r) => setTimeout(r, 100));

    // 确认进入 PAUSED 状态
    expect(app.getBreaker().isPaused()).toBe(true);

    // UI 显示风控警告
    const capsule = document.querySelector('.xhs-capsule') as HTMLElement;
    expect(capsule.textContent).toContain('已暂停 · 风控保护');
    expect(capsule.style.background).toContain('rgb(250, 140, 22)'); // #fa8c16

    const pausedWarning = document.querySelector('.paused-warning') as HTMLElement;
    expect(pausedWarning.style.display).toBe('flex');

    const countAfterTrip = fetchFn.mock.calls.length;

    // 继续等待一段时间，确认调度器处于暂停状态，绝对没有自动发起新请求或轮询重试
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchFn.mock.calls.length).toBe(countAfterTrip);
  });

  it('集成测试：用户手动点击 [恢复] 发起严格单次探测；失败时保持 PAUSED 且无后续自动请求', async () => {
    let probeCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      probeCount++;
      // 模拟服务端仍然持续 429
      return { status: 429, text: 'Too Many Requests' };
    });

    const mockFetcher = new ProfileFetcher(fetchFn);
    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 80));
    expect(app.getBreaker().isPaused()).toBe(true);
    const callsBeforeClick = fetchFn.mock.calls.length;

    // 模拟用户点击一次 [恢复] 按钮
    const recoverBtn = document.querySelector('.recover-btn') as HTMLButtonElement;
    recoverBtn.click();

    // 等待单次探针完成
    await new Promise((r) => setTimeout(r, 100));

    // 发起且仅发起了严格 1 次探测
    expect(fetchFn.mock.calls.length).toBe(callsBeforeClick + 1);

    // 探测失败，系统继续保持 PAUSED 状态
    expect(app.getBreaker().isPaused()).toBe(true);

    // 验证绝无后续自动请求
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchFn.mock.calls.length).toBe(callsBeforeClick + 1);
  });

  it('集成测试：用户手动点击 [恢复] 且单次探测成功时，平滑恢复 RUNNING 并继续调度', async () => {
    let requestCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      requestCount++;
      if (requestCount === 1) {
        // 首次请求触发 429 熔断
        return { status: 429, text: 'Too Many Requests' };
      }
      // 探针恢复及后续请求正常返回 200
      return {
        status: 200,
        text: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      };
    });

    const mockFetcher = new ProfileFetcher(fetchFn);
    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 80));
    expect(app.getBreaker().isPaused()).toBe(true);

    // 用户手动点击 [恢复]
    const recoverBtn = document.querySelector('.recover-btn') as HTMLButtonElement;
    recoverBtn.click();

    await new Promise((r) => setTimeout(r, 100));

    // 探测成功，平滑恢复 RUNNING
    expect(app.getBreaker().isPaused()).toBe(false);

    // 胶囊警告恢复正常
    const capsule = document.querySelector('.xhs-capsule') as HTMLElement;
    expect(capsule.textContent).toContain('直播过滤');
  });
});
