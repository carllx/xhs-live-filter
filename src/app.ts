/**
 * xhs-live-filter 核心运行时 (Primary Runtime Seam)
 */

import { matchContent } from './domain/evaluation';
import { extractCardInfo, ExtractedCardInfo } from './dom/card-extractor';
import { CardPresenter } from './dom/card-presenter';
import { CardObserver } from './dom/card-observer';
import { StorageAdapter } from './storage/storage';
import { FilterUI, UIStats } from './ui/filter-ui';

export class LiveFilterApp {
  private cards: Map<HTMLElement, ExtractedCardInfo> = new Map();
  private observer: CardObserver;
  private ui: FilterUI;
  private currentKeyword: string = '';

  constructor() {
    // 从持久化存储读取关键词
    const savedKeyword = StorageAdapter.get<string>('contentKeyword', '');
    this.currentKeyword = savedKeyword;

    this.ui = new FilterUI({
      onKeywordChange: (kw) => this.handleKeywordChange(kw),
      onClearKeyword: () => this.handleKeywordChange(''),
    });

    this.observer = new CardObserver({
      onCardDiscovered: (card) => this.handleCardDiscovered(card),
    });
  }

  /**
   * 启动应用
   */
  start(root: HTMLElement = document.body): void {
    this.ui.mount(root);
    this.ui.setKeyword(this.currentKeyword);
    this.observer.start(root);
    this.refreshFiltering();
  }

  /**
   * 停止应用（主要用于测试环境清理）
   */
  destroy(): void {
    this.observer.stop();
    this.cards.clear();
  }

  private handleCardDiscovered(cardElement: HTMLElement): void {
    if (this.cards.has(cardElement)) return;
    const info = extractCardInfo(cardElement);
    this.cards.set(cardElement, info);
    this.evaluateSingleCard(info);
    this.updateStats();
  }

  private handleKeywordChange(keyword: string): void {
    this.currentKeyword = keyword;
    StorageAdapter.set('contentKeyword', keyword);
    this.refreshFiltering();
  }

  private evaluateSingleCard(info: ExtractedCardInfo): void {
    const matched = matchContent(this.currentKeyword, info.title, info.nickname);
    CardPresenter.applyContentMatch(info.cardElement, matched);
  }

  private refreshFiltering(): void {
    let matchedCount = 0;
    for (const info of this.cards.values()) {
      const matched = matchContent(this.currentKeyword, info.title, info.nickname);
      CardPresenter.applyContentMatch(info.cardElement, matched);
      if (matched) {
        matchedCount++;
      }
    }
    this.updateStats();
  }

  private updateStats(): void {
    let matchedCount = 0;
    for (const info of this.cards.values()) {
      if (matchContent(this.currentKeyword, info.title, info.nickname)) {
        matchedCount++;
      }
    }
    const stats: UIStats = {
      totalCards: this.cards.size,
      matchedCards: matchedCount,
    };
    this.ui.updateStats(stats);
  }

  // 供测试使用的检查接口
  getDiscoveredCardsCount(): number {
    return this.cards.size;
  }

  getUI(): FilterUI {
    return this.ui;
  }

  getKeyword(): string {
    return this.currentKeyword;
  }
}
