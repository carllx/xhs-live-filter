import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { createLiveSquareFixture } from './fixtures/live-dom';

describe('v0.1.2 UX / Filtering Correction & Truthful Controls', () => {
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

  it('1. UNCALIBRATED 状态下 Gender controls 真实 disabled 且提示暂不可用，Fail-Open 成立', () => {
    app = new LiveFilterApp();
    app.start(fixture);

    const ui = app.getUI();
    const panel = ui.getPanelElement();
    const femaleCb = panel.querySelector('.gender-female') as HTMLInputElement;
    const maleCb = panel.querySelector('.gender-male') as HTMLInputElement;
    const notice = panel.querySelector('.gender-notice') as HTMLElement;

    // 验证控件处于禁用态且文案诚实
    expect(femaleCb.disabled).toBe(true);
    expect(maleCb.disabled).toBe(true);
    expect(notice.textContent).toContain('暂不可用');

    // 胶囊显示为紧凑计数 (4/4)，面板显示过滤导向文本
    const capsule = document.querySelector('.xhs-capsule');
    expect(capsule?.textContent).toContain('(4/4)');
    const statsText = panel.querySelector('.stats-text');
    expect(statsText?.textContent).toContain('显示 4 / 4');
  });

  it('2. CANDIDATE 不再显示“普通”Badge，TARGET 仅显示极小属地事实标签', async () => {
    const mockProfiles: Record<string, string> = {
      user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":0,"ipLocation":"上海"}}}};</script>',
    };

    const mockFetcher = new ProfileFetcher(async (url) => {
      const match = url.match(/\/user\/profile\/(.+)/);
      const uid = match ? match[1] : '';
      return { status: 200, text: mockProfiles[uid] || '<html></html>' };
    });

    // 默认属地筛选：不限属地时测试 CANDIDATE 徽标
    app = new LiveFilterApp(mockFetcher);
    app.setPolicy({ preferredRegions: [] }); // 不过滤属地，全部为 CANDIDATE
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 250));

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement;

    // 验证 CANDIDATE 卡片上没有任何“普通” Badge
    expect(card1.querySelector('.xhs-filter-badge')).toBeNull();
    expect(card2.querySelector('.xhs-filter-badge')).toBeNull();
    expect(card1.textContent).not.toContain('⚪ 普通');
    expect(card2.textContent).not.toContain('⚪ 普通');
  });

  it('3. 属地筛选：设为广东时，非广东卡片真实隐藏；保留未知属地开关有效', async () => {
    const mockProfiles: Record<string, string> = {
      user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":0,"ipLocation":"上海"}}}};</script>',
      user_003: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
    };

    const mockFetcher = new ProfileFetcher(async (url) => {
      const match = url.match(/\/user\/profile\/(.+)/);
      const uid = match ? match[1] : '';
      return { status: 200, text: mockProfiles[uid] || '<html></html>' };
    });

    app = new LiveFilterApp(mockFetcher);
    // 默认 preferredRegions = ['广东'], keepUnknownRegion = true
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 300));

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement; // 广东
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement; // 上海
    const card3 = fixture.querySelector('[data-id="card-3"]') as HTMLElement; // 广东
    const card4 = fixture.querySelector('[data-id="card-4"]') as HTMLElement; // 未知属地

    // card1, card3 (广东) 可见，且带极小属地事实标签
    expect(card1.style.visibility).toBe('visible');
    expect(card1.querySelector('.xhs-filter-badge')?.textContent).toBe('广东');
    expect(card3.style.visibility).toBe('visible');
    expect(card3.querySelector('.xhs-filter-badge')?.textContent).toBe('广东');

    // card2 (上海) 不符合广东，真实隐藏！通过 xhs-filter-hidden 紧凑隐藏，节点不从 DOM 删除
    expect(card2.classList.contains('xhs-filter-hidden')).toBe(true);
    expect(card2.parentNode).not.toBeNull();

    // card4 (未知属地) 在 keepUnknownRegion=true 下默认保留可见
    expect(card4.style.visibility).toBe('visible');

    // 用户主动关闭“保留未知属地”开关
    app.setPolicy({ keepUnknownRegion: false });

    // card4 立即被隐藏
    expect(card4.style.visibility).toBe('hidden');
    // card1 依然可见
    expect(card1.style.visibility).toBe('visible');
  });

  it('4. 校准后 Gender 真实过滤，且与 Keyword、Region 呈 AND Composition 规则', async () => {
    const mockProfiles: Record<string, string> = {
      user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>', // 李小花 (艺术), 女, 广东
      user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":2,"ipLocation":"广东"}}}};</script>', // 张大伟 (编程), 男, 广东
      user_003: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"上海"}}}};</script>', // 王艺术 (户外), 女, 上海
    };

    const mockFetcher = new ProfileFetcher(async (url) => {
      const match = url.match(/\/user\/profile\/(.+)/);
      const uid = match ? match[1] : '';
      return { status: 200, text: mockProfiles[uid] || '<html></html>' };
    });

    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);
    await new Promise((r) => setTimeout(r, 300));

    // 应用平台真实校准映射证据：1 为 female, 2 为 male
    app.calibrateGender({ 1: 'female', 2: 'male' });

    // 设置策略：仅允许 female，且属地仅允许广东，且关键词为“艺术”
    app.setPolicy({
      allowedGenders: ['female'],
      keepUnknownGender: false,
      preferredRegions: ['广东'],
      keepUnknownRegion: false,
      contentKeyword: '艺术',
    });

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement; // 艺术 + 女 + 广东 => 符合全部三项
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement; // 编程 + 男 + 广东 => 关键词与性别均不符
    const card3 = fixture.querySelector('[data-id="card-3"]') as HTMLElement; // 艺术 + 女 + 上海 => 属地不符

    // 只有 card1 完全符合 AND 组合，可见
    expect(card1.style.visibility).toBe('visible');
    expect(card2.style.visibility).toBe('hidden');
    expect(card3.style.visibility).toBe('hidden');

    // 统计显示：胶囊 (1/4)，面板“显示 1 / 4”
    const capsule = document.querySelector('.xhs-capsule');
    expect(capsule?.textContent).toContain('(1/4)');
    const panel = app.getUI().getPanelElement();
    const statsText = panel.querySelector('.stats-text');
    expect(statsText?.textContent).toContain('显示 1 / 4');
  });
});
