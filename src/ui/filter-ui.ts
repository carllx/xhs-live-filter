/**
 * 悬浮胶囊与过滤面板 UI (v0.1.2 过滤导向设计)
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
  visibleCards: number;
  filteredCards: number;
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
  private keepUnknownGenderCheckbox!: HTMLInputElement;
  private regionInput!: HTMLInputElement;
  private keepUnknownRegionCheckbox!: HTMLInputElement;
  private genderNoticeEl!: HTMLElement;
  private calibrationStatus: 'UNCALIBRATED' | 'CALIBRATED' = 'UNCALIBRATED';

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
      <span class="capsule-count" style="font-size: 11px; opacity: 0.9; margin-left: 2px;">(显示 0/0)</span>
    `;

    // 2. 过滤面板 (Filter Panel)
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'xhs-filter-panel';
    this.panelEl.style.cssText = `
      display: none;
      width: 310px;
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

      <!-- 内容关键词 -->
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #555;">内容关键词</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" class="keyword-input" placeholder="输入标题或昵称关键词..." style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none;" />
          <button class="clear-btn" style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;">清空</button>
        </div>
      </div>

      <!-- 属地筛选 (真实硬筛选) -->
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <label style="font-weight: 600; font-size: 12px; color: #555;">属地筛选 (留空不限)</label>
        </div>
        <input type="text" class="region-input" value="广东" placeholder="如：广东, 上海 (逗号分隔)" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none; margin-bottom: 6px;" />
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #666; cursor: pointer;">
          <input type="checkbox" class="keep-unknown-region" checked />
          <span>保留未知属地的主播 (Fail-Open)</span>
        </label>
      </div>

      <!-- 性别筛选 (真实性门禁) -->
      <div style="margin-bottom: 12px; padding: 8px; background: #fafafa; border-radius: 6px; border: 1px solid #f0f0f0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <label style="font-weight: 600; font-size: 12px; color: #555;">性别筛选</label>
          <span class="gender-notice" style="font-size: 10px; color: #fa8c16;">暂不可用 · 未校准</span>
        </div>
        <div class="gender-controls-container" style="display: flex; gap: 12px; font-size: 12px; color: #444; margin-bottom: 6px;">
          <label style="display: flex; align-items: center; gap: 4px; cursor: not-allowed; opacity: 0.6;">
            <input type="checkbox" class="gender-female" disabled /> 仅女性
          </label>
          <label style="display: flex; align-items: center; gap: 4px; cursor: not-allowed; opacity: 0.6;">
            <input type="checkbox" class="gender-male" disabled /> 仅男性
          </label>
        </div>
        <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #666; cursor: not-allowed; opacity: 0.6;">
          <input type="checkbox" class="keep-unknown-gender" checked disabled />
          <span>保留未知性别的主播</span>
        </label>
        <div class="gender-desc" style="font-size: 10px; color: #888; margin-top: 4px;">
          平台底层性别代码尚未完成权威对照，目前全量自动放行。
        </div>
      </div>

      <!-- 年龄区间 (置灰不可用) -->
      <div style="margin-bottom: 12px; opacity: 0.5;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #999;">年龄区间 (公开数据不可用 · 已禁用)</label>
        <input type="text" disabled value="不限 (Fail-Open)" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid #eee; border-radius: 6px; font-size: 12px; background: #fafafa; color: #aaa; cursor: not-allowed;" />
      </div>

      <!-- 统计信息 -->
      <div class="stats-section" style="padding: 8px; background: #f9f9f9; border-radius: 6px; font-size: 11px; color: #666; margin-bottom: 8px;">
        <span class="stats-text">当前显示 0 / 0 张卡片</span>
      </div>

      <!-- 风控保护警告 -->
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
    this.keepUnknownGenderCheckbox = this.panelEl.querySelector('.keep-unknown-gender') as HTMLInputElement;
    this.regionInput = this.panelEl.querySelector('.region-input') as HTMLInputElement;
    this.keepUnknownRegionCheckbox = this.panelEl.querySelector('.keep-unknown-region') as HTMLInputElement;
    this.genderNoticeEl = this.panelEl.querySelector('.gender-notice') as HTMLElement;

    if (initialPolicy) {
      this.syncPolicyToUI(initialPolicy);
    }

    // 事件绑定
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

    const handlePolicyUpdate = () => {
      const allowedGenders: string[] = [];
      if (this.femaleCheckbox.checked) allowedGenders.push('female');
      if (this.maleCheckbox.checked) allowedGenders.push('male');

      const regions = this.regionInput.value
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const keepUnknownRegion = this.keepUnknownRegionCheckbox.checked;
      const keepUnknownGender = this.keepUnknownGenderCheckbox.checked;

      if (this.events.onPolicyChange) {
        this.events.onPolicyChange({
          allowedGenders,
          keepUnknownGender,
          preferredRegions: regions,
          keepUnknownRegion,
        });
      }
    };

    this.femaleCheckbox.addEventListener('change', handlePolicyUpdate);
    this.maleCheckbox.addEventListener('change', handlePolicyUpdate);
    this.keepUnknownGenderCheckbox.addEventListener('change', handlePolicyUpdate);
    this.regionInput.addEventListener('input', handlePolicyUpdate);
    this.keepUnknownRegionCheckbox.addEventListener('change', handlePolicyUpdate);
  }

  syncPolicyToUI(policy: V01Policy): void {
    this.keywordInput.value = policy.contentKeyword;
    this.femaleCheckbox.checked = policy.allowedGenders.includes('female');
    this.maleCheckbox.checked = policy.allowedGenders.includes('male');
    this.keepUnknownGenderCheckbox.checked = policy.keepUnknownGender;
    this.regionInput.value = policy.preferredRegions.join(', ');
    this.keepUnknownRegionCheckbox.checked = policy.keepUnknownRegion;
  }

  setCalibrationStatus(status: 'UNCALIBRATED' | 'CALIBRATED'): void {
    this.calibrationStatus = status;
    const labels = this.panelEl.querySelectorAll('.gender-controls-container label, label:has(.keep-unknown-gender)');
    const desc = this.panelEl.querySelector('.gender-desc') as HTMLElement;

    if (status === 'CALIBRATED') {
      this.genderNoticeEl.textContent = '已启用';
      this.genderNoticeEl.style.color = '#52c41a';
      this.femaleCheckbox.disabled = false;
      this.maleCheckbox.disabled = false;
      this.keepUnknownGenderCheckbox.disabled = false;
      labels.forEach((l) => {
        (l as HTMLElement).style.opacity = '1';
        (l as HTMLElement).style.cursor = 'pointer';
      });
      desc.textContent = '已应用可靠平台对照标准，可精确筛选。';
    } else {
      this.genderNoticeEl.textContent = '暂不可用 · 未校准';
      this.genderNoticeEl.style.color = '#fa8c16';
      this.femaleCheckbox.disabled = true;
      this.maleCheckbox.disabled = true;
      this.keepUnknownGenderCheckbox.disabled = true;
      labels.forEach((l) => {
        (l as HTMLElement).style.opacity = '0.6';
        (l as HTMLElement).style.cursor = 'not-allowed';
      });
      desc.textContent = '平台底层性别代码尚未完成权威对照，目前全量自动放行。';
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
      countEl.textContent = `(${stats.visibleCards}/${stats.totalCards})`;
    }

    let statsDetail = `显示 ${stats.visibleCards} / ${stats.totalCards} 张卡片`;
    if (stats.filteredCards > 0) {
      statsDetail += `（过滤掉 ${stats.filteredCards} 张）`;
    }
    if (this.calibrationStatus === 'UNCALIBRATED') {
      statsDetail += ` · 性别筛选未生效 (Fail-Open)`;
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
