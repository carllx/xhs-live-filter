/**
 * 卡片呈现控制器
 * 严格遵循 ADR-0001：保持原生 DOM 几何空间与结构，绝不破坏网格流或物理移除节点
 */

import { EvaluationResult } from '../domain/evaluation';
import { NormalizedFacts } from '../domain/facts';

export class CardPresenter {
  /**
   * 应用关键词匹配结果展示
   */
  static applyContentMatch(cardElement: HTMLElement, matched: boolean): void {
    if (matched) {
      cardElement.style.visibility = 'visible';
      cardElement.style.pointerEvents = 'auto';
      cardElement.removeAttribute('data-xhs-filter-hidden');
    } else {
      cardElement.style.visibility = 'hidden';
      cardElement.style.pointerEvents = 'none';
      cardElement.setAttribute('data-xhs-filter-hidden', 'true');
    }
  }

  /**
   * 应用领域评估结果（TARGET / CANDIDATE / EXCLUDED）
   * @param cardElement 卡片 DOM
   * @param evalResult 评估结果
   * @param facts 主播事实
   * @param hideExcluded 是否主动隐藏被排除卡片
   */
  static applyEvaluation(
    cardElement: HTMLElement,
    evalResult: EvaluationResult,
    facts: NormalizedFacts,
    hideExcluded: boolean = false
  ): void {
    // 1. 处理排除态（EXCLUDED）
    if (evalResult.status === 'EXCLUDED') {
      if (hideExcluded) {
        cardElement.style.visibility = 'hidden';
        cardElement.style.pointerEvents = 'none';
        cardElement.setAttribute('data-xhs-filter-excluded', 'hidden');
      } else {
        // 默认弱化显示，保留原生几何占位 (ADR-0001)
        cardElement.style.visibility = 'visible';
        cardElement.style.pointerEvents = 'auto';
        cardElement.style.opacity = '0.25';
        cardElement.style.filter = 'grayscale(1)';
        cardElement.setAttribute('data-xhs-filter-excluded', 'dimmed');
      }
      this.setBadge(cardElement, '⛔ 已排除', '#8c8c8c');
      return;
    }

    // 2. 清除弱化效果
    cardElement.style.opacity = '1';
    cardElement.style.filter = 'none';
    cardElement.removeAttribute('data-xhs-filter-excluded');

    // 3. TARGET (优先) vs CANDIDATE (普通)
    if (evalResult.status === 'TARGET') {
      const regionLabel = facts.region !== 'unknown' ? `🎯 ${facts.region}` : '🎯 偏好';
      this.setBadge(cardElement, regionLabel, '#52c41a'); // 绿色高亮
    } else {
      // CANDIDATE
      const regionLabel = facts.region !== 'unknown' ? `⚪ ${facts.region}` : '⚪ 普通';
      this.setBadge(cardElement, regionLabel, '#1890ff'); // 蓝色或淡蓝
    }
  }

  /**
   * 附加或更新卡片徽标（Badge）
   */
  static setBadge(cardElement: HTMLElement, text: string, color: string = '#ff2442'): void {
    let badge = cardElement.querySelector('.xhs-filter-badge') as HTMLElement;
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'xhs-filter-badge';
      badge.style.position = 'absolute';
      badge.style.top = '8px';
      badge.style.left = '8px';
      badge.style.padding = '2px 8px';
      badge.style.borderRadius = '4px';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = 'bold';
      badge.style.color = '#fff';
      badge.style.zIndex = '10';
      badge.style.pointerEvents = 'none';
      badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
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
