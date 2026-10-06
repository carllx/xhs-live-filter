import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { createLiveSquareFixture } from './fixtures/live-dom';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { GenderCalibrationGate } from '../src/domain/gender-calibration';

describe('Ticket #4: Gender Calibration Gate & Configurable Qualification', () => {
  let fixture: HTMLElement;
  let app: LiveFilterApp;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('xhs_filter_profileEnrichmentEnabled', JSON.stringify(true));
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

  it('单元测试：GenderCalibrationGate 默认 UNCALIBRATED 时严格 Fail-Open（归一化为 unknown）', () => {
    const gate = new GenderCalibrationGate();
    expect(gate.getStatus()).toBe('UNCALIBRATED');

    // 无论 raw code 是 0, 1, 2 还是其他，均返回 unknown
    expect(gate.normalize(0)).toBe('unknown');
    expect(gate.normalize(1)).toBe('unknown');
    expect(gate.normalize(2)).toBe('unknown');
    expect(gate.normalize('female')).toBe('unknown');

    // 只有在校准后才映射
    gate.calibrate({ 1: 'female', 2: 'male' });
    expect(gate.getStatus()).toBe('CALIBRATED');
    expect(gate.normalize(1)).toBe('female');
    expect(gate.normalize(2)).toBe('male');
    expect(gate.normalize(0)).toBe('unknown');
  });

  it('集成测试：未校准时，即便 rawGender 为不同值也全量 Fail-Open，不排除任何卡片', async () => {
    const mockProfiles: Record<string, string> = {
      user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":2,"ipLocation":"北京"}}}};</script>',
    };

    const mockFetcher = new ProfileFetcher(async (url) => {
      const match = url.match(/\/user\/profile\/(.+)/);
      const uid = match ? match[1] : '';
      return { status: 200, text: mockProfiles[uid] || '<html></html>' };
    });

    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);

    await new Promise((r) => setTimeout(r, 250));

    expect(app.getCalibrationGate().getStatus()).toBe('UNCALIBRATED');

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement;

    // 两张卡片均不被排除
    expect(card1.getAttribute('data-xhs-filter-excluded')).toBeNull();
    expect(card2.getAttribute('data-xhs-filter-excluded')).toBeNull();
  });

  it('集成测试：校准后违反 allowedGenders 的卡片被判定为 EXCLUDED 并弱化展示，hideExcluded 隐藏时保留 DOM 几何', async () => {
    const mockProfiles: Record<string, string> = {
      user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":2,"ipLocation":"北京"}}}};</script>',
    };

    const mockFetcher = new ProfileFetcher(async (url) => {
      const match = url.match(/\/user\/profile\/(.+)/);
      const uid = match ? match[1] : '';
      return { status: 200, text: mockProfiles[uid] || '<html></html>' };
    });

    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);
    await new Promise((r) => setTimeout(r, 300));

    // 初始 policy: allowedGenders = ['female', 'unknown']
    // 应用校准证据：1 为 female，2 为 male
    app.calibrateGender({ 1: 'female', 2: 'male' });

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement; // gender = female
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement; // gender = male

    // card1 符合 female，未排除，展示极小属地事实标签
    expect(card1.style.visibility).toBe('visible');
    const badge1 = card1.querySelector('.xhs-filter-badge');
    expect(badge1?.textContent).toBe('广东');

    // card2 为 male，不在 allowedGenders 内，真实隐藏 (保留 DOM 几何，display != none)
    expect(card2.style.visibility).toBe('hidden');
    expect(card2.style.display).not.toBe('none');
    expect(card2.parentNode).not.toBeNull();
  });

  it('集成测试：修改 Filter Policy 时纯计算已有 Facts，绝不重新发起 Profile 网络请求', async () => {
    const fetchFn = vi.fn().mockImplementation(async (_url: string) => {
      return {
        status: 200,
        text: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东"}}}};</script>',
      };
    });

    const mockFetcher = new ProfileFetcher(fetchFn);
    app = new LiveFilterApp(mockFetcher);
    app.start(fixture);
    await new Promise((r) => setTimeout(r, 250));

    // 记录初始网络请求次数（针对 3 个有 userId 的卡片各 1 次，共 3 次）
    const initialCallCount = fetchFn.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    // 调整策略：将属地筛选改为 ['上海']
    app.setPolicy({ preferredRegions: ['上海'] });

    // 网络请求次数没有增加！
    expect(fetchFn.mock.calls.length).toBe(initialCallCount);

    // 状态即时更新：原来是 TARGET (广东) 的 card1 不符合上海属地被隐藏且无无用 badge
    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    expect(card1.style.visibility).toBe('hidden');
    expect(card1.querySelector('.xhs-filter-badge')).toBeNull();
  });
});
