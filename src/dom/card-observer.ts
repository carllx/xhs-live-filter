/**
 * 卡片 DOM 观察器
 * 负责在直播列表页持续发现与追踪 Live Cards
 */

export interface CardObserverCallbacks {
  onCardDiscovered: (card: HTMLElement) => void;
}

export class CardObserver {
  private observer: MutationObserver | null = null;
  private knownCards = new WeakSet<HTMLElement>();
  private callbacks: CardObserverCallbacks;

  constructor(callbacks: CardObserverCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * 启动观察器
   * @param root 要观察的根节点，默认 document.body
   */
  start(root: HTMLElement = document.body): void {
    // 1. 先扫描页面已有卡片
    this.scan(root);

    // 2. 监听后续动态添加的卡片
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            this.scan(node);
          }
        }
      }
    });

    this.observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * 扫描指定子树下的潜在直播卡片
   */
  scan(root: HTMLElement): void {
    // 匹配可能的直播卡片选择器
    const selector = '.live-card-item, [class*="live-card"], a[href*="/live/"]';
    
    // 检查自身是否为卡片
    if (this.isCardElement(root) && !this.knownCards.has(root)) {
      this.knownCards.add(root);
      this.callbacks.onCardDiscovered(root);
    }

    const matches = root.querySelectorAll(selector);
    for (const match of Array.from(matches)) {
      const card = this.resolveCardContainer(match as HTMLElement);
      if (card && !this.knownCards.has(card)) {
        this.knownCards.add(card);
        this.callbacks.onCardDiscovered(card);
      }
    }
  }

  private isCardElement(el: HTMLElement): boolean {
    return el.classList.contains('live-card-item') ||
           el.getAttribute('class')?.includes('live-card') ||
           false;
  }

  private resolveCardContainer(el: HTMLElement): HTMLElement {
    // 往上寻找卡片最外层容器
    const container = el.closest('.live-card-item, [class*="live-card"]');
    if (container instanceof HTMLElement) {
      return container;
    }
    // 如果没有包裹层，直接使用当前元素或其父级
    return el;
  }
}
