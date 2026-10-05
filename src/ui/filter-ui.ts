/**
 * 悬浮胶囊与可折叠过滤面板 UI
 */

export interface FilterUIEvents {
  onKeywordChange: (keyword: string) => void;
  onClearKeyword: () => void;
  onTogglePanel?: (expanded: boolean) => void;
  onManualRecover?: () => void;
  onPolicyChange?: () => void;
}

export interface UIStats {
  totalCards: number;
  matchedCards: number;
  targetCards?: number;
  candidateCards?: number;
  excludedCards?: number;
  isPaused?: boolean;
}

export class FilterUI {
  private container: HTMLElement;
  private capsuleEl: HTMLElement;
  private panelEl: HTMLElement;
  private keywordInput: HTMLInputElement;
  private statsTextEl: HTMLElement;
  private recoverBtn: HTMLButtonElement;
  private events: FilterUIEvents;
  private isExpanded: boolean = false;

  constructor(events: FilterUIEvents) {
    this.events = events;
    this.container = document.createElement('div');
    this.container.id = 'xhs-live-filter-root';
    this.container.style.cssText = `
      position: fixed;
      top: 80px;
      right: 24px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      color: #333;
    `;

    // 1. 悬浮胶囊 (Collapsed Capsule)
    this.capsuleEl = document.createElement('div');
    this.capsuleEl.className = 'xhs-capsule';
    this.capsuleEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      background: #ff2442;
      color: #fff;
      padding: 6px 14px;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(255, 36, 66, 0.35);
      user-select: none;
      transition: all 0.2s ease;
    `;
    this.capsuleEl.innerHTML = `
      <span class="capsule-icon" style="font-size: 14px;">🎯</span>
      <span class="capsule-title" style="font-weight: 600;">直播过滤</span>
      <span class="capsule-count" style="font-size: 11px; opacity: 0.9; margin-left: 2px;">(0/0)</span>
    `;

    // 2. 过滤面板 (Filter Panel)
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'xhs-filter-panel';
    this.panelEl.style.cssText = `
      display: none;
      width: 280px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      border: 1px solid #eee;
      margin-top: 8px;
      padding: 14px;
      box-sizing: border-box;
    `;
    this.panelEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-weight: 700; font-size: 14px; color: #111;">直播过滤器</span>
        <button class="panel-close-btn" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #888;">✕</button>
      </div>

      <div style="margin-bottom: 10px;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #555;">内容关键词</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" class="keyword-input" placeholder="输入标题或昵称关键词..." style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none;" />
          <button class="clear-btn" style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;">清空</button>
        </div>
      </div>

      <div class="stats-section" style="padding: 8px; background: #f9f9f9; border-radius: 6px; font-size: 11px; color: #666; margin-bottom: 8px;">
        统计: <span class="stats-text">0 卡片</span>
      </div>

      <div class="paused-warning" style="display: none; padding: 6px 8px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px; font-size: 11px; color: #d46b08; margin-bottom: 8px; justify-content: space-between; align-items: center;">
        <span>⚠️ 已暂停 · 风控保护</span>
        <button class="recover-btn" style="padding: 2px 8px; background: #fa8c16; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">恢复</button>
      </div>
    `;

    this.container.appendChild(this.capsuleEl);
    this.container.appendChild(this.panelEl);

    // 绑定内部元素
    this.keywordInput = this.panelEl.querySelector('.keyword-input') as HTMLInputElement;
    const clearBtn = this.panelEl.querySelector('.clear-btn') as HTMLButtonElement;
    const closeBtn = this.panelEl.querySelector('.panel-close-btn') as HTMLButtonElement;
    this.statsTextEl = this.panelEl.querySelector('.stats-text') as HTMLElement;
    this.recoverBtn = this.panelEl.querySelector('.recover-btn') as HTMLButtonElement;

    // 事件监听
    this.capsuleEl.addEventListener('click', () => this.togglePanel());
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePanel(false);
    });

    this.keywordInput.addEventListener('input', () => {
      this.events.onKeywordChange(this.keywordInput.value);
    });

    clearBtn.addEventListener('click', () => {
      this.keywordInput.value = '';
      this.events.onClearKeyword();
    });

    this.recoverBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.events.onManualRecover) {
        this.events.onManualRecover();
      }
    });
  }

  mount(root: HTMLElement = document.body): void {
    if (!document.getElementById('xhs-live-filter-root')) {
      root.appendChild(this.container);
    }
  }

  setKeyword(keyword: string): void {
    this.keywordInput.value = keyword;
  }

  getKeyword(): string {
    return this.keywordInput.value;
  }

  togglePanel(expanded?: boolean): void {
    this.isExpanded = expanded !== undefined ? expanded : !this.isExpanded;
    this.panelEl.style.display = this.isExpanded ? 'block' : 'none';
    if (this.events.onTogglePanel) {
      this.events.onTogglePanel(this.isExpanded);
    }
  }

  updateStats(stats: UIStats): void {
    const countEl = this.capsuleEl.querySelector('.capsule-count');
    if (countEl) {
      countEl.textContent = `(${stats.matchedCards}/${stats.totalCards})`;
    }

    let statsDetail = `发现 ${stats.totalCards} 张卡片，匹配 ${stats.matchedCards} 张`;
    if (stats.targetCards !== undefined && stats.candidateCards !== undefined) {
      statsDetail += ` (🎯 ${stats.targetCards} 优先 | ⚪ ${stats.candidateCards} 普通)`;
    }
    if (stats.excludedCards !== undefined && stats.excludedCards > 0) {
      statsDetail += ` [⛔ 排除 ${stats.excludedCards}]`;
    }
    this.statsTextEl.textContent = statsDetail;

    const pausedEl = this.panelEl.querySelector('.paused-warning') as HTMLElement;
    if (pausedEl) {
      if (stats.isPaused) {
        pausedEl.style.display = 'flex';
        this.capsuleEl.style.background = '#fa8c16';
        const capsuleTitle = this.capsuleEl.querySelector('.capsule-title');
        if (capsuleTitle) capsuleTitle.textContent = '已暂停 · 风控保护';
      } else {
        pausedEl.style.display = 'none';
        this.capsuleEl.style.background = '#ff2442';
        const capsuleTitle = this.capsuleEl.querySelector('.capsule-title');
        if (capsuleTitle) capsuleTitle.textContent = '直播过滤';
      }
    }
  }

  getPanelElement(): HTMLElement {
    return this.panelEl;
  }

  getCapsuleElement(): HTMLElement {
    return this.capsuleEl;
  }
}
