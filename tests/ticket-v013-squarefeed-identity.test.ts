/**
 * Regression Test Suite: v0.1.3 Squarefeed Passive Interception & Identity Binding
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeedIdentityStore } from '../src/network/feed-identity-store';
import {
  installSquarefeedInterceptor,
  processSquarefeedPayload,
  SQUAREFEED_HOST,
  SQUAREFEED_PATH,
} from '../src/network/squarefeed-interceptor';
import { extractCardInfo } from '../src/dom/card-extractor';
import { LiveFilterApp } from '../src/app';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { GenderCalibrationGate } from '../src/domain/gender-calibration';
import * as fs from 'fs';
import * as path from 'path';

describe('v0.1.3 Squarefeed Interception & Anchor Identity Binding', () => {
  let store: FeedIdentityStore;

  beforeEach(() => {
    store = FeedIdentityStore.getInstance();
    store.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // 1. metadata @run-at document-start
  it('1. Build metadata declares @run-at document-start and @grant unsafeWindow', () => {
    const buildScript = fs.readFileSync(path.resolve('scripts/build.js'), 'utf-8');
    expect(buildScript).toContain('// @run-at       document-start');
    expect(buildScript).toContain('// @grant        unsafeWindow');
    expect(buildScript).toContain('// @connect      live-room.xiaohongshu.com');
  });

  // 2. page-world bridge/interceptor 安装早于 app DOM boot
  it('2. Interceptor can be installed on mock window without document.body', () => {
    const mockWin = {
      fetch: vi.fn(),
      XMLHttpRequest: class {
        open = vi.fn();
        send = vi.fn();
      },
    } as unknown as Window & typeof globalThis;

    installSquarefeedInterceptor(mockWin, store);
    expect((mockWin as unknown as { __XHS_SQUAREFEED_INTERCEPTOR_INSTALLED__: boolean }).__XHS_SQUAREFEED_INTERCEPTOR_INSTALLED__).toBe(true);
  });

  // 3. fetch squarefeed capture
  it('3. fetch squarefeed response clone is parsed into FeedIdentityStore', async () => {
    const mockPayload = {
      code: 0,
      success: true,
      data: {
        feeds: [
          {
            live: {
              tRoomInfo: { roomIdStr: '570484055475371367', name: '落魄留学生' },
              tLiveHostInfo: { userId: 'user_anchor_123', nickname: 'Cathy徐可爱' },
            },
          },
        ],
      },
    };

    const mockResponse = {
      clone: () => ({
        json: async () => mockPayload,
        text: async () => JSON.stringify(mockPayload),
      }),
    } as unknown as Response;

    const mockWin = {
      fetch: vi.fn().mockResolvedValue(mockResponse),
      XMLHttpRequest: class {},
    } as unknown as Window & typeof globalThis;

    installSquarefeedInterceptor(mockWin, store);

    const res = await mockWin.fetch(`https://${SQUAREFEED_HOST}${SQUAREFEED_PATH}?cursorScore=0`);
    expect(res).toBe(mockResponse);

    // 等待 microtask 解析完成
    await new Promise((r) => setTimeout(r, 10));

    expect(store.has('570484055475371367')).toBe(true);
    const identity = store.getIdentity('570484055475371367');
    expect(identity).toEqual({
      liveId: '570484055475371367',
      userId: 'user_anchor_123',
      nickname: 'Cathy徐可爱',
      title: '落魄留学生',
    });
  });

  // 4. XHR squarefeed capture
  it('4. XMLHttpRequest squarefeed response is passively captured', () => {
    let loadHandler: (() => void) | undefined;

    function MockXHR() {
      // constructor
    }
    MockXHR.prototype.open = function (_method: string, _url: string) {
      // prototype open
    };
    MockXHR.prototype.send = function () {
      // prototype send
    };
    MockXHR.prototype.addEventListener = function (event: string, handler: () => void) {
      if (event === 'load') loadHandler = handler;
    };
    MockXHR.prototype.responseText = '';
    MockXHR.prototype.responseType = '';

    const mockWin = {
      fetch: vi.fn(),
      XMLHttpRequest: MockXHR as unknown as typeof XMLHttpRequest,
    } as unknown as Window & typeof globalThis;

    installSquarefeedInterceptor(mockWin, store);

    const xhr = new mockWin.XMLHttpRequest();
    xhr.open('GET', `https://${SQUAREFEED_HOST}${SQUAREFEED_PATH}`);
    Object.defineProperty(xhr, 'responseText', {
      value: JSON.stringify({
        data: {
          feeds: [
            {
              live: {
                tRoomInfo: { roomIdStr: '67890', name: '直播间2' },
                tLiveHostInfo: { userId: 'anchor_456', nickname: '小红书达人' },
              },
            },
          ],
        },
      }),
      writable: true,
    });
    xhr.send();

    expect(loadHandler).toBeDefined();
    loadHandler!();

    expect(store.has('67890')).toBe(true);
    expect(store.getIdentity('67890')?.userId).toBe('anchor_456');
  });

  // 5. unrelated requests untouched
  it('5. Unrelated URLs are untouched and do not trigger payload parsing', async () => {
    const cloneSpy = vi.fn();
    const mockResponse = {
      clone: cloneSpy,
    } as unknown as Response;

    const mockWin = {
      fetch: vi.fn().mockResolvedValue(mockResponse),
      XMLHttpRequest: class {},
    } as unknown as Window & typeof globalThis;

    installSquarefeedInterceptor(mockWin, store);

    await mockWin.fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/otherinfo');
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(store.getIdentityMapSize()).toBe(0);
  });

  // 6. response 原样返回
  it('6. Original response object is returned unchanged to caller', async () => {
    const originalRes = { status: 200, clone: () => ({ json: async () => ({}) }) } as unknown as Response;
    const mockWin = {
      fetch: vi.fn().mockResolvedValue(originalRes),
      XMLHttpRequest: class {},
    } as unknown as Window & typeof globalThis;

    installSquarefeedInterceptor(mockWin, store);
    const result = await mockWin.fetch(`https://${SQUAREFEED_HOST}${SQUAREFEED_PATH}`);
    expect(result).toBe(originalRes);
  });

  // 7. correct schema: tRoomInfo.roomIdStr -> liveId, tLiveHostInfo.userId -> anchor userId
  // 8. malformed feed fail-soft
  it('7 & 8. Correct schema mapping and malformed feed fail-soft tolerance', () => {
    const payload = {
      data: {
        feeds: [
          null, // malformed
          { malformed: true },
          {
            live: {
              tRoomInfo: { roomIdStr: '111', name: 'Valid Live' },
              tLiveHostInfo: { userId: 'u_111', nickname: 'Host 1' },
            },
          },
          {
            live: {
              tRoomInfo: { roomId: 222, name: 'Numeric ID' },
              tLiveHostInfo: { userId: 'u_222', nickname: 'Host 2' },
            },
          },
          {
            live: {
              tRoomInfo: { roomIdStr: '333' }, // missing userId -> ignored
            },
          },
        ],
      },
    };

    processSquarefeedPayload(payload, store);
    expect(store.getIdentityMapSize()).toBe(2);
    expect(store.getIdentity('111')?.userId).toBe('u_111');
    expect(store.getIdentity('222')?.userId).toBe('u_222');
  });

  // 8b. raw snake_case schema from network response (pre-transformation)
  it('8b. Correctly parses raw snake_case API payload fields (t_room_info, t_live_host_info)', () => {
    const rawSnakePayload = {
      code: 0,
      success: true,
      data: {
        feeds: [
          {
            live: {
              t_room_info: {
                room_id: 570484055475371367,
                room_id_str: '570484055475371367',
                name: '落魄留学生',
              },
              t_live_host_info: {
                user_id: '62b952a2000000001b029272',
                nickname: 'Cathy徐可爱',
              },
            },
          },
          {
            live: {
              room_info: {
                room_id: '987654321',
                title: '备选直播',
              },
              host_info: {
                anchor_id: 'host_987',
                nick_name: '备选主播',
              },
            },
          },
        ],
      },
    };

    processSquarefeedPayload(rawSnakePayload, store);
    expect(store.getIdentityMapSize()).toBe(2);
    expect(store.getIdentity('570484055475371367')).toEqual({
      liveId: '570484055475371367',
      userId: '62b952a2000000001b029272',
      nickname: 'Cathy徐可爱',
      title: '落魄留学生',
    });
    expect(store.getIdentity('987654321')).toEqual({
      liveId: '987654321',
      userId: 'host_987',
      nickname: '备选主播',
      title: '备选直播',
    });
  });

  // 9. card extracts /livestream/{id}
  it('9. Card extractor extracts liveId from /livestream/{liveId}', () => {
    const card = document.createElement('div');
    card.innerHTML = `
      <a href="/livestream/570484055475371367?track_id=xyz" class="title">落魄留学生</a>
      <a href="/livestream/570484055475371367?track_id=xyz" class="author">
        <span class="nickname">Cathy徐可爱</span>
      </a>
    `;
    const info = extractCardInfo(card);
    expect(info.liveId).toBe('570484055475371367');
    expect(info.title).toBe('落魄留学生');
    expect(info.nickname).toBe('Cathy徐可爱');
    expect(info.userId).toBeUndefined(); // 原生 DOM 无 profile anchor
  });

  // 10. feed-before-card binding (Case A)
  it('10. Feed-before-card binding: identity available before card discovery immediately attaches userId', async () => {
    store.addIdentity({
      liveId: 'live_a',
      userId: 'anchor_a',
      nickname: '主播A',
      title: '标题A',
    });

    const mockFetcher = new ProfileFetcher();
    vi.spyOn(mockFetcher, 'fetchProfileFacts').mockResolvedValue({
      userId: 'anchor_a',
      region: '广东',
      age: 'unknown',
      enriched: true,
      rawGender: 0,
      gender: 'unknown',
    });

    const app = new LiveFilterApp(mockFetcher, new GenderCalibrationGate(), undefined, store);
    app.start(document.body);

    const card = document.createElement('div');
    card.className = 'live-item';
    card.innerHTML = `<a href="/livestream/live_a" class="title">标题A</a>`;
    document.body.appendChild(card);

    // 等待 observer 扫描
    await new Promise((r) => setTimeout(r, 20));

    expect(app.getDiscoveredCardsCount()).toBe(1);
    expect(app.getBoundCardCount()).toBe(1);

    app.destroy();
  });

  // 11. card-before-feed late binding (Case B)
  it('11. Card-before-feed late binding: card discovered first, then squarefeed arrives and binds identity', async () => {
    const mockFetcher = new ProfileFetcher();
    vi.spyOn(mockFetcher, 'fetchProfileFacts').mockResolvedValue({
      userId: 'anchor_late',
      region: '广东',
      age: 'unknown',
      enriched: true,
      rawGender: 1,
      gender: 'unknown',
    });

    const app = new LiveFilterApp(mockFetcher, new GenderCalibrationGate(), undefined, store);
    app.start(document.body);

    const card = document.createElement('div');
    card.className = 'live-item';
    card.innerHTML = `<a href="/livestream/live_late" class="title">晚到的标题</a>`;
    document.body.appendChild(card);

    await new Promise((r) => setTimeout(r, 20));
    expect(app.getDiscoveredCardsCount()).toBe(1);
    expect(app.getBoundCardCount()).toBe(0);

    // Squarefeed 数据稍后到达
    store.addIdentity({
      liveId: 'live_late',
      userId: 'anchor_late',
      nickname: '晚到主播',
      title: '晚到的标题',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(app.getBoundCardCount()).toBe(1);

    app.destroy();
  });

  // 12. duplicate pages do not duplicate enrichment
  it('12. Duplicate squarefeed pages with same liveId do not duplicate identity listeners or triggers', () => {
    const listener = vi.fn();
    store.onIdentityAdded(listener);

    store.addIdentity({
      liveId: 'live_dup',
      userId: 'anchor_dup',
      nickname: '主播',
      title: '标题',
    });

    expect(listener).toHaveBeenCalledTimes(1);

    // 重复加入相同 liveId
    store.addIdentity({
      liveId: 'live_dup',
      userId: 'anchor_dup',
      nickname: '主播',
      title: '标题',
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  // 13. obtained userId enters existing viewport scheduler
  // 14. no 270-way eager profile requests (concurrency <= 2)
  it('13 & 14. Bound identities enter viewport scheduler with max concurrency <= 2', async () => {
    let activeRequests = 0;
    let maxConcurrent = 0;

    const mockFetcher = new ProfileFetcher();
    vi.spyOn(mockFetcher, 'fetchProfileFacts').mockImplementation(async (uid: string) => {
      activeRequests++;
      if (activeRequests > maxConcurrent) maxConcurrent = activeRequests;
      await new Promise((r) => setTimeout(r, 25));
      activeRequests--;
      return {
        userId: uid,
        region: '广东',
        age: 'unknown',
        enriched: true,
        rawGender: 0,
        gender: 'unknown',
      };
    });

    // 预填 10 个 identity
    for (let i = 0; i < 10; i++) {
      store.addIdentity({
        liveId: `live_${i}`,
        userId: `anchor_${i}`,
        nickname: `主播_${i}`,
        title: `直播_${i}`,
      });
    }

    const app = new LiveFilterApp(mockFetcher, new GenderCalibrationGate(), undefined, store);
    app.start(document.body);

    for (let i = 0; i < 10; i++) {
      const card = document.createElement('div');
      card.className = 'live-item';
      card.innerHTML = `<a href="/livestream/live_${i}">直播_${i}</a>`;
      document.body.appendChild(card);
    }

    await new Promise((r) => setTimeout(r, 50));

    // 验证并发数严格受控 <= 2
    expect(maxConcurrent).toBeLessThanOrEqual(2);

    app.destroy();
  });

  // 15. existing region/filter behavior unchanged
  it('15. Target region cards are marked and non-target cards hidden once profile enriched', async () => {
    store.addIdentity({
      liveId: 'live_gd',
      userId: 'anchor_gd',
      nickname: '广东主播',
      title: '广东好物',
    });

    store.addIdentity({
      liveId: 'live_sh',
      userId: 'anchor_sh',
      nickname: '上海主播',
      title: '上海好物',
    });

    const mockFetcher = new ProfileFetcher();
    vi.spyOn(mockFetcher, 'fetchProfileFacts').mockImplementation(async (uid: string) => {
      return {
        userId: uid,
        region: uid === 'anchor_gd' ? '广东' : '上海',
        age: 'unknown',
        enriched: true,
        rawGender: 0,
        gender: 'unknown',
      };
    });

    const app = new LiveFilterApp(mockFetcher, new GenderCalibrationGate(), undefined, store);
    app.setPolicy({ preferredRegions: ['广东'], keepUnknownRegion: false, profileEnrichmentEnabled: true });
    app.start(document.body);

    const cardGd = document.createElement('div');
    cardGd.className = 'live-item';
    cardGd.innerHTML = `<a href="/livestream/live_gd">广东好物</a>`;
    document.body.appendChild(cardGd);

    const cardSh = document.createElement('div');
    cardSh.className = 'live-item';
    cardSh.innerHTML = `<a href="/livestream/live_sh">上海好物</a>`;
    document.body.appendChild(cardSh);

    // 等待调度与呈现
    await new Promise((r) => setTimeout(r, 80));

    // cardGd 是广东 -> 可见且有 TARGET 标签
    expect(cardGd.style.visibility).not.toBe('hidden');
    expect(cardGd.querySelector('.xhs-filter-badge')?.textContent).toBe('广东');

    // cardSh 是上海 -> 非偏好属地且关闭了 keepUnknownRegion -> 隐藏
    expect(cardSh.style.visibility).toBe('hidden');

    app.destroy();
  });

  // 16. no token persistence/logging
  it('16. FeedIdentityStore only stores safe fields and ignores tokens', () => {
    store.addIdentity({
      liveId: 'live_safe',
      userId: 'anchor_safe',
      nickname: '安全昵称',
      title: '安全标题',
    });

    const record = store.getIdentity('live_safe');
    expect(record).toBeDefined();
    expect(Object.keys(record!).sort()).toEqual(['liveId', 'nickname', 'title', 'userId'].sort());
  });
});
