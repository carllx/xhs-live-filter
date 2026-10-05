/**
 * xhs-live-filter 核心运行时 (Primary Runtime Seam)
 */

import { evaluate, EvaluationResult, matchContent } from './domain/evaluation';
import { createUnknownFacts, NormalizedFacts } from './domain/facts';
import { DEFAULT_POLICY, V01Policy } from './domain/policy';
import { extractCardInfo, ExtractedCardInfo } from './dom/card-extractor';
import { CardObserver } from './dom/card-observer';
import { CardPresenter } from './dom/card-presenter';
import { ProfileCache } from './network/cache';
import { ProfileFetcher } from './network/profile-fetcher';
import { StorageAdapter } from './storage/storage';
import { FilterUI, UIStats } from './ui/filter-ui';

export class LiveFilterApp {
  private cards: Map<HTMLElement, ExtractedCardInfo> = new Map();
  private factsMap: Map<string, NormalizedFacts> = new Map();
  private observer: CardObserver;
  private ui: FilterUI;
  private policy: V01Policy;
  private cache: ProfileCache;
  private fetcher: ProfileFetcher;
  private enrichmentQueue: string[] = [];
  private isEnriching: boolean = false;

  constructor(customFetcher?: ProfileFetcher) {
    // 读取持久化策略
    const savedKeyword = StorageAdapter.get<string>('contentKeyword', '');
    const savedRegions = StorageAdapter.get<string[]>('preferredRegions', DEFAULT_POLICY.preferredRegions);
    const savedGenders = StorageAdapter.get<string[]>('allowedGenders', DEFAULT_POLICY.allowedGenders);
    const savedHideExcluded = StorageAdapter.get<boolean>('hideExcluded', DEFAULT_POLICY.hideExcluded);

    this.policy = {
      contentKeyword: savedKeyword,
      preferredRegions: savedRegions,
      allowedGenders: savedGenders,
      hideExcluded: savedHideExcluded,
    };

    this.cache = new ProfileCache();
    this.fetcher = customFetcher || new ProfileFetcher();

    this.ui = new FilterUI({
      onKeywordChange: (kw) => this.handleKeywordChange(kw),
      onClearKeyword: () => this.handleKeywordChange(''),
      onManualRecover: () => this.handleManualRecover(),
    });

    this.observer = new CardObserver({
      onCardDiscovered: (card) => this.handleCardDiscovered(card),
    });
  }

  start(root: HTMLElement = document.body): void {
    this.ui.mount(root);
    this.ui.setKeyword(this.policy.contentKeyword);
    this.observer.start(root);
    this.refreshAll();
  }

  destroy(): void {
    this.observer.stop();
    this.cards.clear();
    this.factsMap.clear();
    this.enrichmentQueue = [];
  }

  private handleCardDiscovered(cardElement: HTMLElement): void {
    if (this.cards.has(cardElement)) return;
    const info = extractCardInfo(cardElement);
    this.cards.set(cardElement, info);

    // 1. 内容子串匹配
    this.evaluateContentMatch(info);

    // 2. 数据增强处理
    if (!info.userId) {
      // 无法提取 userId：0 请求，标记 unknown，Fail-Open
      const unknownFacts = createUnknownFacts();
      this.applyCardEvaluation(info, unknownFacts);
    } else {
      // 检查缓存
      const cached = this.cache.get(info.userId);
      if (cached) {
        this.factsMap.set(info.userId, cached);
        this.applyCardEvaluation(info, cached);
      } else {
        // 加入调度队列（保守并发 <= 1）
        if (!this.enrichmentQueue.includes(info.userId)) {
          this.enrichmentQueue.push(info.userId);
          this.processQueue();
        }
      }
    }

    this.updateStats();
  }

  private async processQueue(): Promise<void> {
    if (this.isEnriching || this.enrichmentQueue.length === 0) {
      return;
    }

    this.isEnriching = true;
    const userId = this.enrichmentQueue.shift()!;

    try {
      const facts = await this.fetcher.fetchProfileFacts(userId);
      this.cache.set(userId, facts);
      this.factsMap.set(userId, facts);

      // 重新评估所有该 userId 的卡片
      for (const info of this.cards.values()) {
        if (info.userId === userId) {
          this.applyCardEvaluation(info, facts);
        }
      }
    } catch (err) {
      // 若出现限流/验证码由后续 Ticket #4/#5 调度器熔断捕获，此处仅记录
      console.warn(`[xhs-live-filter] Enrich user ${userId} failed:`, err);
    } finally {
      this.isEnriching = false;
      this.updateStats();
      if (this.enrichmentQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  private handleKeywordChange(keyword: string): void {
    this.policy.contentKeyword = keyword;
    StorageAdapter.set('contentKeyword', keyword);
    this.refreshContentMatches();
  }

  private handleManualRecover(): void {
    // 供 Ticket #5 扩展恢复逻辑
  }

  private evaluateContentMatch(info: ExtractedCardInfo): void {
    const matched = matchContent(this.policy.contentKeyword, info.title, info.nickname);
    CardPresenter.applyContentMatch(info.cardElement, matched);
  }

  private applyCardEvaluation(info: ExtractedCardInfo, facts: NormalizedFacts): void {
    const result: EvaluationResult = evaluate(facts, this.policy);
    CardPresenter.applyEvaluation(info.cardElement, result, facts, this.policy.hideExcluded);
  }

  private refreshContentMatches(): void {
    for (const info of this.cards.values()) {
      this.evaluateContentMatch(info);
    }
    this.updateStats();
  }

  private refreshAll(): void {
    this.refreshContentMatches();
    for (const info of this.cards.values()) {
      const facts = info.userId ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId) : createUnknownFacts();
      this.applyCardEvaluation(info, facts);
    }
    this.updateStats();
  }

  private updateStats(): void {
    let matchedCount = 0;
    let targetCount = 0;
    let candidateCount = 0;
    let excludedCount = 0;

    for (const info of this.cards.values()) {
      if (matchContent(this.policy.contentKeyword, info.title, info.nickname)) {
        matchedCount++;
      }
      const facts = info.userId ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId) : createUnknownFacts();
      const evalRes = evaluate(facts, this.policy);
      if (evalRes.status === 'TARGET') {
        targetCount++;
      } else if (evalRes.status === 'CANDIDATE') {
        candidateCount++;
      } else if (evalRes.status === 'EXCLUDED') {
        excludedCount++;
      }
    }

    const stats: UIStats = {
      totalCards: this.cards.size,
      matchedCards: matchedCount,
      targetCards: targetCount,
      candidateCards: candidateCount,
      excludedCards: excludedCount,
    };
    this.ui.updateStats(stats);
  }

  // 供测试使用的接口
  getDiscoveredCardsCount(): number {
    return this.cards.size;
  }

  getUI(): FilterUI {
    return this.ui;
  }

  getCache(): ProfileCache {
    return this.cache;
  }

  getPolicy(): V01Policy {
    return this.policy;
  }

  getKeyword(): string {
    return this.policy.contentKeyword;
  }

  setPolicy(policy: Partial<V01Policy>): void {
    this.policy = { ...this.policy, ...policy };
    this.refreshAll();
  }
}
