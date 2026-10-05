/**
 * 悬浮胶囊与可折叠过滤面板 UI
 */

import { V01Policy } from '../domain/policy';

export interface FilterUIEvents {
  onKeywordChange: (keyword: string) => void;
  onClearKeyword: () => void;
  onPolicyChange?: (policy: Partial<V01Policy>) => void;
  onTogglePanel?: (expanded: boolean) => void;
  onManualRecover?: () => void;
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

  // Policy UI elements
  private femaleCheckbox!: HTMLInputElement;
  private maleCheckbox!: HTMLInputElement;
  private unknownGenderCheckbox!: HTMLInputElement;
  private regionInput!: HTMLInputElement;
  private hideExcludedCheckbox!: HTMLInputElement;
  private calibrationBadgeEl!: HTMLElement;

  constructor(events: FilterUIEvents, initialPolicy?: V01Policy) {
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
      width: 300px;
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

      <!-- 关键词筛选 -->
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #555;">内容关键词</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" class="keyword-input" placeholder="输入标题或昵称关键词..." style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none;" />
          <button class="clear-btn" style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;">清空</button>
        </div>
      </div>

      <!-- 性别筛选 (Ticket #4) -->
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <label style="font-weight: 600; font-size: 12px; color: #555;">允许性别</label>
          <span class="calibration-badge" style="font-size: 10px; color: #fa8c16; background: #fff7e6; padding: 1px 6px; border-radius: 4px; border: 1px solid #ffd591;">门禁: UNCALIBRATED (Fail-Open)</span>
        </div>
        <div style="display: flex; gap: 12px; font-size: 12px; color: #444;">
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" class="gender-female" checked /> 女性
          </label>
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" class="gender-male" /> 男性
          </label>
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" class="gender-unknown" checked /> 未知/未校准
          </label>
        </div>
      </div>

      <!-- 偏好属地 (Ticket #3/4) -->
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #555;">偏好属地 (逗号分隔)</label>
        <input type="text" class="region-input" value="广东" placeholder="如：广东,上海" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none;" />
      </div>

      <!-- 年龄 (置灰不可用) -->
      <div style="margin-bottom: 12px; opacity: 0.6;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #999;">年龄区间 (公开数据不可用 · 已禁用)</label>
        <input type="text" disabled value="不限 (Fail-Open)" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid #eee; border-radius: 6px; font-size: 12px; background: #fafafa; color: #aaa; cursor: not-allowed;" />
      </div>

      <!-- 视图控制：hideExcluded (默认关闭) -->
      <div style="margin-bottom: 12px; padding-top: 6px; border-top: 1px dashed #eee;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #444; cursor: pointer;">
          <input type="checkbox" class="hide-excluded-checkbox" />
          <span>隐藏已排除主播 (默认低透明度保留)</span>
        </label>
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

    this.femaleCheckbox = this.panelEl.querySelector('.gender-female') as HTMLInputElement;
    this.maleCheckbox = this.panelEl.querySelector('.gender-male') as HTMLInputElement;
    this.unknownGenderCheckbox = this.panelEl.querySelector('.gender-unknown') as HTMLInputElement;
    this.regionInput = this.panelEl.querySelector('.region-input') as HTMLInputElement;
    this.hideExcludedCheckbox = this.panelEl.querySelector('.hide-excluded-checkbox') as HTMLInputElement;
    this.calibrationBadgeEl = this.panelEl.querySelector('.calibration-badge') as HTMLElement;

    if (initialPolicy) {
      this.syncPolicyToUI(initialPolicy);
    }

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

    // 策略修改触发纯评估
    const handlePolicyUpdate = () => {
      const allowedGenders: string[] = [];
      if (this.femaleCheckbox.checked) allowedGenders.push('female');
      if (this.maleCheckbox.checked) allowedGenders.push('male');
      if (this.unknownGenderCheckbox.checked) allowedGenders.push('unknown');

      const regions = this.regionInput.value
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const hideExcluded = this.hideExcludedCheckbox.checked;

      if (this.events.onPolicyChange) {
        this.events.onPolicyChange({
          allowedGenders,
          preferredRegions: regions,
          hideExcluded,
        });
      }
    };

    this.femaleCheckbox.addEventListener('change', handlePolicyUpdate);
    this.maleCheckbox.addEventListener('change', handlePolicyUpdate);
    this.unknownGenderCheckbox.addEventListener('change', handlePolicyUpdate);
    this.regionInput.addEventListener('input', handlePolicyUpdate);
    this.hideExcludedCheckbox.addEventListener('change', handlePolicyUpdate);
  }

  syncPolicyToUI(policy: V01Policy): void {
    this.keywordInput.value = policy.contentKeyword;
    this.femaleCheckbox.checked = policy.allowedGenders.includes('female');
    this.maleCheckbox.checked = policy.allowedGenders.includes('male');
    this.unknownGenderCheckbox.checked = policy.allowedGenders.includes('unknown');
    this.regionInput.value = policy.preferredRegions.join(', ');
    this.hideExcludedCheckbox.checked = policy.hideExcluded;
  }

  setCalibrationStatus(status: 'UNCALIBRATED' | 'CALIBRATED'): void {
    if (status === 'CALIBRATED') {
      this.calibrationBadgeEl.textContent = '门禁: CALIBRATED';
      this.calibrationBadgeEl.style.color = '#52c41a';
      this.calibrationBadgeEl.style.background = '#f6ffed';
      this.calibrationBadgeEl.style.borderColor = '#b7eb8f';
    } else {
      this.calibrationBadgeEl.textContent = '门禁: UNCALIBRATED (Fail-Open)';
      this.calibrationBadgeEl.style.color = '#fa8c16';
      this.calibrationBadgeEl.style.background = '#fff7e6';
      this.calibrationBadgeEl.style.borderColor = '#ffd591';
    }
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
