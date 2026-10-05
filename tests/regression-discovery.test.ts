import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LiveFilterApp } from '../src/app';

describe('Regression Hotfix: CardObserver Discovery on Real LiveList Surface', () => {
  let container: HTMLElement;
  let app: LiveFilterApp;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';

    // 模拟真实 LiveList 现场：27 个卡片容器，使用 .live-item / .feed-card / .card-item，且没有 a[href*="/live/"]
    container = document.createElement('div');
    container.className = 'live-list-page';

    let cardsHtml = '';
    for (let i = 1; i <= 27; i++) {
      const classVariety = i % 3 === 0 ? 'live-item' : i % 3 === 1 ? 'feed-card' : 'card-item';
      cardsHtml += `
        <div class="${classVariety}" data-id="anchor-card-${i}">
          <div class="cover-wrapper">
            <img src="https://example.com/cover_${i}.jpg" alt="直播封面_${i}" />
          </div>
          <div class="card-info">
            <div class="title" title="热门主播直播实战分享_${i}">热门主播直播实战分享_${i}</div>
            <div class="author-name">主播昵称_${i}</div>
            <a class="profile-link" href="/user/profile/user_id_${i}"></a>
          </div>
        </div>
      `;
    }
    container.innerHTML = cardsHtml;
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (app) {
      app.destroy();
    }
    document.body.innerHTML = '';
  });

  it('真实回归验证：能够准确发现全部 27 个卡片容器，且胶囊不再显示 (0/0)', () => {
    app = new LiveFilterApp();
    app.start(container);

    // 验证发现的卡片总数为 27，不再为 0
    expect(app.getDiscoveredCardsCount()).toBe(27);

    // 胶囊文字不再是 (0/0)
    const capsule = document.querySelector('.xhs-capsule');
    expect(capsule).not.toBeNull();
    expect(capsule?.textContent).toContain('(27/27)');
    expect(capsule?.textContent).not.toContain('(0/0)');

    // 验证标题与主播昵称正常提取
    const card1 = container.querySelector('[data-id="anchor-card-1"]') as HTMLElement;
    expect(card1).not.toBeNull();
    expect(card1.style.visibility).toBe('visible');

    // 关键词过滤生效
    const panel = app.getUI().getPanelElement();
    const input = panel.querySelector('.keyword-input') as HTMLInputElement;
    input.value = '分享_1';
    input.dispatchEvent(new Event('input'));

    // 卡片 1, 10-19 等包含分享_1 的卡片应可见
    expect(card1.style.visibility).toBe('visible');

    // 卡片 2 不匹配被隐藏
    const card2 = container.querySelector('[data-id="anchor-card-2"]') as HTMLElement;
    expect(card2.style.visibility).toBe('hidden');
    expect(card2.style.display).not.toBe('none'); // ADR-0001
  });

  it('回归验证：MutationObserver 动态追加卡片继续发现，且 WeakSet 确保同一节点不重复计数', async () => {
    app = new LiveFilterApp();
    app.start(container);

    expect(app.getDiscoveredCardsCount()).toBe(27);

    // 动态追加 1 张新卡片
    const newCard = document.createElement('div');
    newCard.className = 'live-item feed-card'; // 同时命中两个类
    newCard.setAttribute('data-id', 'anchor-card-dynamic');
    newCard.innerHTML = `
      <div class="title">动态加载新卡片</div>
      <div class="author-name">新主播</div>
    `;
    container.appendChild(newCard);

    // 等待 MutationObserver 回调
    await new Promise((r) => setTimeout(r, 50));

    // 总数应准确增加 1，变成 28（不产生重复计数）
    expect(app.getDiscoveredCardsCount()).toBe(28);

    // 再次手动触发 scan(container)，验证 WeakSet 去重保障
    app['observer'].scan(container);
    expect(app.getDiscoveredCardsCount()).toBe(28);
  });
});
