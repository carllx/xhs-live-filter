/**
 * beta.6 300013 业务限流安全停止与持久化闭锁专项回归测试
 * 覆盖：
 * 1. HTTP 200 JSON code=300013 => security stop
 * 2. JSON code=300013 => breaker PAUSED
 * 3. text "300013 + 访问频次异常" => security stop
 * 4. text "300013 + Too many requests" => security stop
 * 5. unrelated "300013" alone => NO false positive
 * 6. 300013 => pending queue cleared
 * 7. 300013 => no subsequent task starts
 * 8. 300013 => profileEnrichmentEnabled=false
 * 9. 300013 => persistent safety latch written
 * 10. app restart with latch => zero active requests
 * 11. passive squarefeed still works with latch
 * 12. manual recovery => exactly one anonymous probe
 * 13. failed probe with 300013 => remains PAUSED
 * 14. successful probe => clears latch but does NOT enable enrichment
 * 15. successful probe => no automatic batch queue
 * 16. existing beta.5 zero-default-request tests remain green
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { FeedIdentityStore } from '../src/network/feed-identity-store';
import { StorageAdapter } from '../src/storage/storage';
import { STORAGE_KEYS } from '../src/domain/policy';
import { createLiveSquareFixture } from './fixtures/live-dom';

describe('XHS 300013 Rate Limit & Persistent Safety Latch (v0.1.3-beta.6)', () => {
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

  // 1 & 2. HTTP 200 JSON code=300013 => security stop & breaker PAUSED
  it('1 & 2. HTTP 200 JSON code=300013 => ProfileFetcher throws isSecurityStop & breaker trips to PAUSED', async () => {
    const json300013 = JSON.stringify({
      code: 300013,
      success: false,
      msg: '访问频次异常，请勿频繁操作或重启试试',
    });

    const fetcher = new ProfileFetcher(async () => ({ status: 200, text: json300013 }));

    await expect(fetcher.fetchProfileFacts('user_300013')).rejects.toMatchObject({
      isSecurityStop: true,
      isRateLimited: true,
      code: 300013,
      reason: 'XHS 300013 rate limit',
    });

    app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
    app.setPolicy({ preferredRegions: ['广东'], profileEnrichmentEnabled: true });
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 60));

    expect(app.getBreaker().isPaused()).toBe(true);
  });

  // 3. text "300013 + 访问频次异常" => security stop
  it('3. text fallback: "300013 + 访问频次异常" => triggers 300013 security stop', async () => {
    const htmlText = '<html><div>错误代码：300013，访问频次异常，请稍后再试</div></html>';
    const fetcher = new ProfileFetcher(async () => ({ status: 200, text: htmlText }));

    await expect(fetcher.fetchProfileFacts('user_text_limit')).rejects.toMatchObject({
      isSecurityStop: true,
      isRateLimited: true,
      code: 300013,
      reason: 'XHS 300013 rate limit',
    });
  });

  // 4. text "300013 + Too many requests" => security stop
  it('4. text fallback: "300013 + Too many requests" => triggers 300013 security stop', async () => {
    const htmlText = '<html><div>Error 300013: Too many requests. Try again later.</div></html>';
    const fetcher = new ProfileFetcher(async () => ({ status: 200, text: htmlText }));

    await expect(fetcher.fetchProfileFacts('user_en_limit')).rejects.toMatchObject({
      isSecurityStop: true,
      isRateLimited: true,
      code: 300013,
      reason: 'XHS 300013 rate limit',
    });
  });

  // 5. unrelated "300013" alone => NO false positive
  it('5. unrelated "300013" alone in normal HTML => NO false positive (parses normally)', async () => {
    // 假设普通主播简介里包含 300013（如房间号/邮编/粉丝数），无限流语义
    const normalHtml = `
      <html>
        <script>
          window.__INITIAL_STATE__ = {
            "user": {
              "userPageData": {
                "basicInfo": {
                  "nickname": "主播300013",
                  "gender": 1,
                  "ipLocation": "广东"
                }
              }
            }
          };
        </script>
        <div>主播邮政编码是 300013，欢迎光临！</div>
      </html>
    `;
    const fetcher = new ProfileFetcher(async () => ({ status: 200, text: normalHtml }));

    const facts = await fetcher.fetchProfileFacts('user_normal');
    expect(facts.region).toBe('广东');
    expect(facts.enriched).toBe(true);
  });

  // 6 & 7 & 8 & 9. 300013 => pending queue cleared, no subsequent task starts, profileEnrichmentEnabled=false, persistent latch written
  it('6, 7, 8 & 9. 300013 => clears queue, stops subsequent tasks, disables enrichment, and writes persistent latch', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes('user_001')) {
        return {
          status: 200,
          text: JSON.stringify({ code: 300013, msg: '访问频次异常' }),
        };
      }
      return {
        status: 200,
        text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script></html>',
      };
    });

    const fetcher = new ProfileFetcher(fetchFn);
    app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
    app.setPolicy({ preferredRegions: ['广东'], profileEnrichmentEnabled: true });
    app.start(fixture);

    // 等待足够时间（如果没有阻断，原本会依次拉取 user_001, user_002, user_003 共 3 次）
    await new Promise((r) => setTimeout(r, 200));

    // 6 & 7: 仅发生 1 次请求，后续排队任务全部清空且不再启动
    expect(callCount).toBe(1);
    expect(app.getScheduler().getQueueLength()).toBe(0);

    // 8: profileEnrichmentEnabled 立即关闭
    expect(app.getPolicy().profileEnrichmentEnabled).toBe(false);

    // 9: 写入持久化安全闭锁
    const latch = app.getSafetyLatch();
    expect(latch).not.toBeNull();
    expect(latch?.code).toBe(300013);
    expect(latch?.reason).toBe('XHS 300013 rate limit');

    // Storage 中亦已持久化
    const savedLatch = StorageAdapter.get(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, null);
    expect(savedLatch).toMatchObject({ code: 300013 });
  });

  // 10. app restart with latch => zero active requests
  it('10. app restart with latch => zero active requests on boot even if preferredRegions is set', async () => {
    // 模拟之前持久化了 300013 闭锁，且用户之前曾存有 preferredRegions=['广东']
    StorageAdapter.set(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, {
      code: 300013,
      reason: 'XHS 300013 rate limit',
      detectedAt: Date.now() - 5000,
    });
    StorageAdapter.set(STORAGE_KEYS.PREFERRED_REGIONS, ['广东']);
    StorageAdapter.set(STORAGE_KEYS.PROFILE_ENRICHMENT_ENABLED, true); // 即使曾经存为 true

    const fetchFn = vi.fn().mockResolvedValue({ status: 200, text: '<html></html>' });
    const fetcher = new ProfileFetcher(fetchFn);

    const newApp = new LiveFilterApp(fetcher);
    // 重启后强制 profileEnrichmentEnabled 为 false
    expect(newApp.getPolicy().profileEnrichmentEnabled).toBe(false);
    expect(newApp.getBreaker().isPaused()).toBe(true);

    newApp.start(fixture);

    await new Promise((r) => setTimeout(r, 100));

    // 严格 0 次网络请求
    expect(fetchFn).toHaveBeenCalledTimes(0);

    // UI 显示已暂停与 300013 文案
    const panel = newApp.getUI().getPanelElement();
    const pausedWarning = panel.querySelector('.paused-warning') as HTMLElement;
    expect(pausedWarning.style.display).toBe('flex');
    expect(pausedWarning.textContent).toContain('300013');
    expect(pausedWarning.textContent).toContain('插件不会自动重试');

    newApp.destroy();
  });

  // 11. passive squarefeed still works with latch
  it('11. passive squarefeed still works normally even when latch is active', async () => {
    StorageAdapter.set(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, {
      code: 300013,
      reason: 'XHS 300013 rate limit',
      detectedAt: Date.now(),
    });

    const store = FeedIdentityStore.getInstance();
    store.clear();

    const fetchFn = vi.fn();
    const fetcher = new ProfileFetcher(fetchFn);

    app = new LiveFilterApp(fetcher, undefined, undefined, store);
    app.start(document.body);

    const card = document.createElement('div');
    card.className = 'live-item';
    card.innerHTML = `<a href="/livestream/live_latch_1">直播</a>`;
    document.body.appendChild(card);

    // squarefeed 被动拦截到来
    store.addIdentity({
      liveId: 'live_latch_1',
      userId: 'user_latch_1',
      title: '直播',
      nickname: '主播',
    });

    await new Promise((r) => setTimeout(r, 50));

    // 身份绑定成功，但无主动请求
    expect(app.getBoundCardCount()).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  // 12 & 13. manual recovery => exactly one anonymous probe; failed probe => remains PAUSED
  it('12 & 13. manual recovery executes exactly one probe; if 300013 repeats, remains PAUSED', async () => {
    let probeCalls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      probeCalls++;
      return {
        status: 200,
        text: JSON.stringify({ code: 300013, msg: '仍在限流中' }),
      };
    });

    // 设为存在 latch 的 paused 状态
    StorageAdapter.set(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, {
      code: 300013,
      reason: 'XHS 300013 rate limit',
      detectedAt: Date.now(),
    });

    const fetcher = new ProfileFetcher(fetchFn);
    app = new LiveFilterApp(fetcher);
    app.start(fixture);
    await new Promise((r) => setTimeout(r, 50));

    expect(probeCalls).toBe(0);

    // 用户点击恢复按钮
    const success = await app.handleManualRecover();
    expect(success).toBe(false);

    // 严格只发起 1 次探测
    expect(probeCalls).toBe(1);

    // 依旧保持 PAUSED 与 latch
    expect(app.getBreaker().isPaused()).toBe(true);
    expect(app.getSafetyLatch()).not.toBeNull();
    expect(app.getPolicy().profileEnrichmentEnabled).toBe(false);
  });

  // 14 & 15. successful probe => clears latch, but does NOT auto-enable enrichment or batch queue
  it('14 & 15. successful probe => clears latch, but does NOT auto-enable enrichment or batch queue', async () => {
    let probeCalls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      probeCalls++;
      return {
        status: 200,
        text: '<html><script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东广州"}}}};</script></html>',
      };
    });

    const fetcher = new ProfileFetcher(fetchFn);
    // 初始设置存在 latch
    StorageAdapter.set(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, {
      code: 300013,
      reason: 'XHS 300013 rate limit',
      detectedAt: Date.now(),
    });

    app = new LiveFilterApp(fetcher, undefined, undefined, undefined, { minIntervalMs: 20 });
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 50));
    expect(probeCalls).toBe(0);

    // 用户点击手动恢复
    const success = await app.handleManualRecover();
    expect(success).toBe(true);

    // 验证：严格只发生了该单次探测请求
    expect(probeCalls).toBe(1);

    // 验证：闭锁已清除，breaker 恢复为 RUNNING
    expect(app.getSafetyLatch()).toBeNull();
    expect(StorageAdapter.get(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, null)).toBeNull();
    expect(app.getBreaker().isPaused()).toBe(false);

    // 关键断言 14: profileEnrichmentEnabled 严格保持 false，绝对不自动开启
    expect(app.getPolicy().profileEnrichmentEnabled).toBe(false);

    // 关键断言 15: 继续等待，绝对没有自动发起后续卡片的 batch queue
    await new Promise((r) => setTimeout(r, 150));
    expect(probeCalls).toBe(1);
    expect(app.getScheduler().getQueueLength()).toBe(0);
  });
});
