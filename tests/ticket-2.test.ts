import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiveFilterApp } from '../src/app';
import { createLiveSquareFixture } from './fixtures/live-dom';
import { StorageAdapter } from '../src/storage/storage';
import { matchContent } from '../src/domain/evaluation';

describe('Ticket #2: Local Keyword Filtering Experience (Primary Runtime Seam)', () => {
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

  it('单元测试：普通子串匹配（大小写不敏感，无 NLP，空关键词匹配全部）', () => {
    expect(matchContent('', '任意标题', '任意昵称')).toBe(true);
    expect(matchContent('   ', '任意标题', '任意昵称')).toBe(true);
    expect(matchContent('TypeScript', '前端 typescript 实战', '作者')).toBe(true);
    expect(matchContent('张三', '直播标题', '用户_张三_')).toBe(true);
    expect(matchContent('不存在的词', '标题', '昵称')).toBe(false);
  });

  it('集成测试：启动后正确发现 Live Cards 并渲染悬浮胶囊', () => {
    app = new LiveFilterApp();
    app.start(fixture);

    expect(app.getDiscoveredCardsCount()).toBe(4);
    const capsule = document.querySelector('.xhs-capsule');
    expect(capsule).not.toBeNull();
    expect(capsule?.textContent).toContain('(4/4)');
  });

  it('集成测试：用户在面板输入关键词，即时完成视图过滤并保留原生几何', () => {
    app = new LiveFilterApp();
    app.start(fixture);

    const ui = app.getUI();
    const panel = ui.getPanelElement();
    const input = panel.querySelector('.keyword-input') as HTMLInputElement;

    // 输入 "艺术"
    input.value = '艺术';
    input.dispatchEvent(new Event('input'));

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    const card2 = fixture.querySelector('[data-id="card-2"]') as HTMLElement;
    const card3 = fixture.querySelector('[data-id="card-3"]') as HTMLElement;
    const card4 = fixture.querySelector('[data-id="card-4"]') as HTMLElement;

    // Card 1（标题含艺术）和 Card 3（昵称含艺术）应匹配
    expect(card1.style.visibility).toBe('visible');
    expect(card1.getAttribute('data-xhs-filter-hidden')).toBeNull();

    expect(card3.style.visibility).toBe('visible');
    expect(card3.getAttribute('data-xhs-filter-hidden')).toBeNull();

    // Card 2 和 Card 4 不匹配，被隐藏（ADR-0001: 保留节点，占位隐藏）
    expect(card2.style.visibility).toBe('hidden');
    expect(card2.style.display).not.toBe('none'); // 绝不能 display: none
    expect(card2.getAttribute('data-xhs-filter-hidden')).toBe('true');

    expect(card4.style.visibility).toBe('hidden');
    expect(card4.style.display).not.toBe('none');
    expect(card4.getAttribute('data-xhs-filter-hidden')).toBe('true');

    // 胶囊统计更新为 (2/4)
    const capsule = document.querySelector('.xhs-capsule');
    expect(capsule?.textContent).toContain('(2/4)');
  });

  it('集成测试：清空关键词后所有卡片立即恢复显示', () => {
    app = new LiveFilterApp();
    app.start(fixture);

    const ui = app.getUI();
    const panel = ui.getPanelElement();
    const input = panel.querySelector('.keyword-input') as HTMLInputElement;
    const clearBtn = panel.querySelector('.clear-btn') as HTMLButtonElement;

    // 先输入过滤
    input.value = '编程';
    input.dispatchEvent(new Event('input'));

    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    expect(card1.style.visibility).toBe('hidden');

    // 点击清空
    clearBtn.click();

    // 所有卡片恢复
    const allCards = fixture.querySelectorAll('.live-card-item');
    for (const card of Array.from(allCards)) {
      expect((card as HTMLElement).style.visibility).toBe('visible');
      expect((card as HTMLElement).getAttribute('data-xhs-filter-hidden')).toBeNull();
    }
  });

  it('集成测试：关键词持久化存储并在下次启动时自动恢复过滤', () => {
    // 第一次启动并输入关键词
    app = new LiveFilterApp();
    app.start(fixture);

    const ui = app.getUI();
    const input = ui.getPanelElement().querySelector('.keyword-input') as HTMLInputElement;
    input.value = '登山';
    input.dispatchEvent(new Event('input'));

    expect(StorageAdapter.get('contentKeyword', '')).toBe('登山');
    app.destroy();

    // 重新实例化 App（模拟页面刷新）
    const app2 = new LiveFilterApp();
    app2.start(fixture);

    expect(app2.getKeyword()).toBe('登山');
    const card3 = fixture.querySelector('[data-id="card-3"]') as HTMLElement; // 周末户外徒步登山直播
    const card1 = fixture.querySelector('[data-id="card-1"]') as HTMLElement;
    expect(card3.style.visibility).toBe('visible');
    expect(card1.style.visibility).toBe('hidden');

    app2.destroy();
  });
});
