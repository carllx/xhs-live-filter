import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { ProfileFetcher } from '../src/network/profile-fetcher';

describe('Ticket #6: Bounded Live Acceptance & Release Verification', () => {
  let container: HTMLElement;
  let app: LiveFilterApp;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('xhs_filter_profileEnrichmentEnabled', JSON.stringify(true));
    document.body.innerHTML = '';

    // 构造模拟小红书直播/混排页面的 DOM 结构
    container = document.createElement('div');
    container.className = 'main-container feed-container';
    container.innerHTML = `
      <div class="header-nav">小红书直播与发现</div>
      <div class="cards-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
        <!-- 卡片 A: 标准直播卡片，带主播主页链接，属地广东 -->
        <div class="live-item feed-card" data-id="card-a">
          <a class="cover" href="/live/70001">
            <img src="https://example.com/coverA.jpg" alt="广州艺术生活专场" />
          </a>
          <div class="footer">
            <div class="title" title="广州艺术生活专场">广州艺术生活专场</div>
            <a class="author" href="/user/profile/user_gd_01">
              <span class="name">小月月</span>
            </a>
          </div>
        </div>

        <!-- 卡片 B: 视频混排卡片（带 /live/ 链接），属地北京 -->
        <div class="card-item" data-id="card-b">
          <a href="/live/70002" title="北京科技数码评测">
            <img src="https://example.com/coverB.jpg" alt="北京科技数码评测" />
          </a>
          <div class="info">
            <div class="author-name">老王聊数码</div>
            <a class="avatar-link" href="/user/profile/user_bj_02"></a>
          </div>
        </div>

        <!-- 卡片 C: 缺少 userId 的卡片 -->
        <div class="live-card-item" data-id="card-c">
          <a href="/live/70003">
            <div class="live-title">电台深夜助眠纯音乐</div>
          </a>
          <div class="author-info">
            <span class="user-name">无人值守电台</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (app) {
      app.destroy();
    }
    document.body.innerHTML = '';
  });

  it('验收标准 1-5: 启动、卡片发现、内容提取、关键词过滤、几何保护与清空恢复', () => {
    app = new LiveFilterApp();
    app.start(container);

    // 1. 胶囊与面板挂载成功
    const capsule = document.querySelector('.xhs-capsule');
    expect(capsule).not.toBeNull();
    const panel = app.getUI().getPanelElement();
    expect(panel).not.toBeNull();

    // 2. 识别到 3 张卡片
    expect(app.getDiscoveredCardsCount()).toBe(3);

    // 3. 关键词过滤
    const input = panel.querySelector('.keyword-input') as HTMLInputElement;
    input.value = '艺术';
    input.dispatchEvent(new Event('input'));

    const cardA = container.querySelector('[data-id="card-a"]') as HTMLElement;
    const cardB = container.querySelector('[data-id="card-b"]') as HTMLElement;

    // 卡片 A 匹配，可见
    expect(cardA.style.visibility).toBe('visible');
    // 卡片 B 不匹配，保持占位隐藏
    expect(cardB.style.visibility).toBe('hidden');
    expect(cardB.style.display).not.toBe('none');

    // 4. 原生点击事件与 DOM 节点未受破坏
    expect(cardA.querySelector('a')?.getAttribute('href')).toBe('/live/70001');

    // 5. 清空恢复
    const clearBtn = panel.querySelector('.clear-btn') as HTMLButtonElement;
    clearBtn.click();
    expect(cardB.style.visibility).toBe('visible');
  });

  it('验收标准 6-10: 无 userId 时 0 网络请求 Fail-Open，有效卡片 SSR 数据增强与广东优先 TARGET/CANDIDATE', async () => {
    const fetchedUrls: string[] = [];
    const mockFetcher = new ProfileFetcher(async (url) => {
      fetchedUrls.push(url);
      if (url.includes('user_gd_01')) {
        return {
          status: 200,
          text: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
        };
      }
      if (url.includes('user_bj_02')) {
        return {
          status: 200,
          text: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":2,"ipLocation":"北京"}}}};</script>',
        };
      }
      return { status: 404, text: 'Not found' };
    });

    app = new LiveFilterApp(mockFetcher);
    app.start(container);

    // 等待异步队列调度
    await new Promise((r) => setTimeout(r, 350));

    // Card C 没有 userId，绝不发起请求，且无任何无用 Badge
    expect(fetchedUrls.some((u) => u.includes('card-c') || u.includes('无人值守'))).toBe(false);
    const cardC = container.querySelector('[data-id="card-c"]') as HTMLElement;
    expect(cardC.style.visibility).toBe('visible');
    const badgeC = cardC.querySelector('.xhs-filter-badge');
    expect(badgeC).toBeNull(); // 无用 Badge 已彻底移除

    // Card A (广东) => TARGET，仅显示极小属地事实标签
    const cardA = container.querySelector('[data-id="card-a"]') as HTMLElement;
    expect(cardA.style.visibility).toBe('visible');
    const badgeA = cardA.querySelector('.xhs-filter-badge');
    expect(badgeA?.textContent).toBe('广东');

    // Card B (北京) => 不符合属地广东，真实过滤隐藏
    const cardB = container.querySelector('[data-id="card-b"]') as HTMLElement;
    expect(cardB.style.visibility).toBe('hidden');
    expect(cardB.querySelector('.xhs-filter-badge')).toBeNull();

    // 验证 Gender Calibration 当前保持在真实 UNCALIBRATED 状态
    expect(app.getCalibrationGate().getStatus()).toBe('UNCALIBRATED');

    // 验证两级缓存命中：再次触发时不产生重复网络请求
    const callCountBefore = fetchedUrls.length;
    // 销毁并重新启动模拟刷新
    app.destroy();
    const appRefreshed = new LiveFilterApp(mockFetcher);
    appRefreshed.start(container);
    await new Promise((r) => setTimeout(r, 100));

    // 请求数量未增加（全部命中 L2 缓存）
    expect(fetchedUrls.length).toBe(callCountBefore);
    appRefreshed.destroy();
  });
});
