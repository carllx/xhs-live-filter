/**
 * 卡片呈现控制器
 * 严格遵循 ADR-0001：保持原生 DOM 几何空间与结构，绝不破坏网格流或物理删除节点
 */

export class CardPresenter {
  /**
   * 应用关键词匹配结果展示
   * @param cardElement 卡片原生容器
   * @param matched 是否匹配
   */
  static applyContentMatch(cardElement: HTMLElement, matched: boolean): void {
    if (matched) {
      cardElement.style.visibility = 'visible';
      cardElement.style.pointerEvents = 'auto';
      cardElement.removeAttribute('data-xhs-filter-hidden');
    } else {
      // 保持原生占位，隐藏内容和交互
      cardElement.style.visibility = 'hidden';
      cardElement.style.pointerEvents = 'none';
      cardElement.setAttribute('data-xhs-filter-hidden', 'true');
    }
  }

  /**
   * 恢复所有卡片的默认可见性
   */
  static resetContentMatch(cardElement: HTMLElement): void {
    cardElement.style.visibility = 'visible';
    cardElement.style.pointerEvents = 'auto';
    cardElement.removeAttribute('data-xhs-filter-hidden');
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
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '4px';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = 'bold';
      badge.style.color = '#fff';
      badge.style.zIndex = '10';
      badge.style.pointerEvents = 'none';
      badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
      // 保证父级具备定位上下文
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
