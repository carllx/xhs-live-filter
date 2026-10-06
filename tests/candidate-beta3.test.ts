import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { ProfileFetcher } from '../src/network/profile-fetcher';
import { matchPreferredRegions, matchSingleRegion } from '../src/domain/region-matcher';
import { CardPresenter } from '../src/dom/card-presenter';
import { createLiveSquareFixture } from './fixtures/live-dom';

describe('v0.1.3-beta.3 Candidate Verification', () => {
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

  describe('1. 属地规范匹配算法 (Region Matcher)', () => {
    it('“广东”匹配“广东广州”、“广东省深圳市”，且严格排斥“广西南宁”', () => {
      expect(matchSingleRegion('广东', '广东广州')).toBe(true);
      expect(matchSingleRegion('广东', '广东省深圳市')).toBe(true);
      expect(matchSingleRegion('广东', '广东')).toBe(true);
      expect(matchSingleRegion('广东', '广西南宁')).toBe(false);
      expect(matchSingleRegion('广东', '广西桂林')).toBe(false);
    });

    it('“贵州”匹配“贵州贵阳”，排斥其它省份', () => {
      expect(matchSingleRegion('贵州', '贵州贵阳')).toBe(true);
      expect(matchSingleRegion('贵州', '贵州省遵义')).toBe(true);
      expect(matchSingleRegion('贵州', '四川成都')).toBe(false);
    });

    it('多省份列表匹配', () => {
      expect(matchPreferredRegions(['广东', '上海'], '广东广州')).toBe(true);
      expect(matchPreferredRegions(['广东', '上海'], '上海市黄浦区')).toBe(true);
      expect(matchPreferredRegions(['广东', '上海'], '北京朝阳')).toBe(false);
      expect(matchPreferredRegions([], '北京朝阳')).toBe(true); // 空列表不限属地
    });
  });

  describe('2. 展示属地与筛选属地解耦 & Badge 呈现', () => {
    it('用户筛选“广东”，主播公开属地“广东广州”匹配成功且 Badge 显示完整“广东广州”', async () => {
      const mockProfiles: Record<string, string> = {
        user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"广东广州"}}}};</script>',
        user_002: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":2,"ipLocation":"广西南宁"}}}};</script>',
        user_003: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"贵州贵阳"}}}};</script>',
      };

      const mockFetcher = new ProfileFetcher(async (url) => {
        const match = url.match(/\/user\/profile\/(.+)/);
        const uid = match ? match[1] : '';
        return { status: 200, text: mockProfiles[uid] || '<html></html>' };
      });

      app = new LiveFilterApp(mockFetcher);
      // 筛选仅广东，keepUnknownRegion = false
      app.setPolicy({ preferredRegions: ['广东'], keepUnknownRegion: false });
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 350));

      const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement; // 广东广州
      const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement; // 广西南宁
      const card3 = fixture.querySelector('[data-id="card-3"]') as HTMLElement; // 贵州贵阳

      // card1 应该可见，且 Badge 文本为完整公开事实“广东广州”
      expect(card1.classList.contains('xhs-filter-hidden')).toBe(false);
      const badge1 = card1.querySelector('.xhs-filter-badge');
      expect(badge1).not.toBeNull();
      expect(badge1?.textContent).toBe('广东广州');

      // card2 (广西南宁) 严格被排除并紧凑隐藏
      expect(card2.classList.contains('xhs-filter-hidden')).toBe(true);

      // card3 (贵州贵阳) 严格被排除并紧凑隐藏
      expect(card3.classList.contains('xhs-filter-hidden')).toBe(true);
    });

    it('当筛选多属地包含“贵州”时，“贵州贵阳”主播命中 TARGET 并展示“贵州贵阳”', async () => {
      const mockProfiles: Record<string, string> = {
        user_001: '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"贵州贵阳"}}}};</script>',
      };

      const mockFetcher = new ProfileFetcher(async (url) => {
        const match = url.match(/\/user\/profile\/(.+)/);
        const uid = match ? match[1] : '';
        return { status: 200, text: mockProfiles[uid] || '<html></html>' };
      });

      app = new LiveFilterApp(mockFetcher);
      app.setPolicy({ preferredRegions: ['贵州'] });
      app.start(fixture);

      await new Promise((r) => setTimeout(r, 300));

      const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
      expect(card1.classList.contains('xhs-filter-hidden')).toBe(false);
      expect(card1.querySelector('.xhs-filter-badge')?.textContent).toBe('贵州贵阳');
    });
  });

  describe('3. 紧凑重排 (Compact filtered layout)', () => {
    it('被过滤的卡片包含 .xhs-filter-hidden 类，未被过滤的卡片不包含该类且 DOM 节点结构完整', () => {
      const card = document.createElement('div');
      card.id = 'test-card';
      document.body.appendChild(card);

      // 1. 被排除
      CardPresenter.applyPresentation(
        card,
        true,
        { status: 'EXCLUDED', regionPriority: 0, genderMatch: true, regionMatch: false },
        { gender: 'unknown', region: '北京', age: 'unknown', enriched: true }
      );
      expect(card.classList.contains('xhs-filter-hidden')).toBe(true);
      expect(card.getAttribute('data-xhs-filter-hidden')).toBe('true');
      expect(card.parentNode).not.toBeNull();

      // 2. 恢复可见
      CardPresenter.applyPresentation(
        card,
        true,
        { status: 'TARGET', regionPriority: 1, genderMatch: true, regionMatch: true },
        { gender: 'unknown', region: '广东广州', age: 'unknown', enriched: true }
      );
      expect(card.classList.contains('xhs-filter-hidden')).toBe(false);
      expect(card.getAttribute('data-xhs-filter-hidden')).toBeNull();
      expect(card.querySelector('.xhs-filter-badge')?.textContent).toBe('广东广州');
    });
  });

  describe('4. ProfileFetcher 解析与 Fail-Open 保证', () => {
    it('正确解析各种常见公开个人页 HTML 与 JSON 格式', () => {
      const fetcher = new ProfileFetcher();

      // Case A: 标准 SSR __INITIAL_STATE__
      const htmlA = '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":1,"ipLocation":"贵州贵阳"}}}};</script>';
      const factsA = fetcher.parseProfileHtml('user_a', htmlA);
      expect(factsA.region).toBe('贵州贵阳');
      expect(factsA.rawGender).toBe(1);

      // Case B: 包含“中国”前缀清洗
      const htmlB = '<script>window.__INITIAL_STATE__={"user":{"userPageData":{"basicInfo":{"gender":2,"ipLocation":"中国 广东深圳"}}}};</script>';
      const factsB = fetcher.parseProfileHtml('user_b', htmlB);
      expect(factsB.region).toBe('广东深圳');

      // Case C: 正则文本匹配 IP 属地：广东广州
      const htmlC = '<div><span>IP 属地：广东广州</span></div>';
      const factsC = fetcher.parseProfileHtml('user_c', htmlC);
      expect(factsC.region).toBe('广东广州');

      // Case D: 纯 CSR 空页面 -> Fail-Open 返回 unknown
      const htmlD = '<script>window.__INITIAL_STATE__={"user":{"userPageData":{}}};</script>';
      const factsD = fetcher.parseProfileHtml('user_d', htmlD);
      expect(factsD.region).toBe('unknown');
    });
  });
});
