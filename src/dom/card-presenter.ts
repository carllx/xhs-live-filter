/**
 * 卡片呈现控制器
 * 严格遵循 ADR-0001：保持原生 DOM 几何空间与结构，绝不破坏网格流或物理删除节点
 * 过滤导向呈现：
 * - 不符合条件的卡片占位隐藏（visibility: hidden, pointer-events: none）
 * - CANDIDATE 不展示任何普通/无用 Badge
 * - TARGET 仅展示极小的主播属地事实标签（例如：广东）
 */

import { EvaluationResult } from '../domain/evaluation';
import { NormalizedFacts } from '../domain/facts';

export class CardPresenter {
  private static styleInjected = false;

  /**
   * 确保注入隐藏样式规则（display: none !important），让网格/Flex 紧凑自动重排
   */
  static ensureStyleInjected(): void {
    if (this.styleInjected || typeof document === 'undefined') return;
    const styleId = 'xhs-live-filter-presenter-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .xhs-filter-hidden {
          display: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    this.styleInjected = true;
  }

  /**
   * 应用综合过滤结果（内容匹配 + 资格状态）
   * @param cardElement 卡片原生容器
   * @param contentMatched 关键词内容是否匹配
   * @param evalResult 领域评估结果
   * @param facts 主播事实
   */
  static applyPresentation(
    cardElement: HTMLElement,
    contentMatched: boolean,
    evalResult: EvaluationResult,
    facts: NormalizedFacts
  ): void {
    this.ensureStyleInjected();
    const isExcluded = evalResult.status === 'EXCLUDED';
    const isVisible = contentMatched && !isExcluded;

    if (!isVisible) {
      // 紧凑隐藏：通过 class 设置 display: none !important，触发原生网格重排，不留空洞
      cardElement.classList.add('xhs-filter-hidden');
      cardElement.style.visibility = 'hidden';
      cardElement.style.pointerEvents = 'none';
      cardElement.setAttribute('data-xhs-filter-hidden', 'true');
      this.removeBadge(cardElement);
      return;
    }

    // 符合全部条件的卡片恢复可见
    cardElement.classList.remove('xhs-filter-hidden');
    cardElement.style.visibility = 'visible';
    cardElement.style.pointerEvents = 'auto';
    cardElement.style.opacity = '1';
    cardElement.style.filter = 'none';
    cardElement.removeAttribute('data-xhs-filter-hidden');
    cardElement.removeAttribute('data-xhs-filter-excluded');

    // Badge 呈现策略：
    // CANDIDATE: 绝不展示任何"普通"标签，保持页面清爽
    // TARGET: 仅展示极小主播完整事实标签（例如：广东广州、贵州贵阳）
    if (evalResult.status === 'TARGET' && facts.region !== 'unknown') {
      this.setBadge(cardElement, facts.region, '#52c41a');
    } else {
      this.removeBadge(cardElement);
    }
  }

  /**
   * 兼容旧接口：仅内容匹配
   */
  static applyContentMatch(cardElement: HTMLElement, matched: boolean): void {
    this.ensureStyleInjected();
    if (matched) {
      cardElement.classList.remove('xhs-filter-hidden');
      cardElement.style.visibility = 'visible';
      cardElement.style.pointerEvents = 'auto';
      cardElement.removeAttribute('data-xhs-filter-hidden');
    } else {
      cardElement.classList.add('xhs-filter-hidden');
      cardElement.style.visibility = 'hidden';
      cardElement.style.pointerEvents = 'none';
      cardElement.setAttribute('data-xhs-filter-hidden', 'true');
    }
  }

  /**
   * 移除卡片徽标
   */
  static removeBadge(cardElement: HTMLElement): void {
    const badge = cardElement.querySelector('.xhs-filter-badge');
    if (badge) {
      badge.remove();
    }
  }

  /**
   * 附加或更新极小事实徽标（Badge）
   */
  static setBadge(cardElement: HTMLElement, text: string, color: string = '#52c41a'): void {
    let badge = cardElement.querySelector('.xhs-filter-badge') as HTMLElement;
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'xhs-filter-badge';
      badge.style.position = 'absolute';
      badge.style.top = '6px';
      badge.style.left = '6px';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '3px';
      badge.style.fontSize = '10px';
      badge.style.fontWeight = '600';
      badge.style.color = '#fff';
      badge.style.zIndex = '10';
      badge.style.pointerEvents = 'none';
      badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
      const position = window.getComputedStyle(cardElement).position;
      if (position === 'static') {
        cardElement.style.position = 'relative';
      }
      cardElement.appendChild(badge);
    }
    badge.textContent = text;
    badge.style.backgroundColor = color;
  }
}
