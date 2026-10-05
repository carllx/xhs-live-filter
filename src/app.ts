/**
 * xhs-live-filter 核心运行时 (Primary Runtime Seam)
 */

import { evaluate, EvaluationResult, matchContent } from './domain/evaluation';
import { createUnknownFacts, NormalizedFacts, NormalizedGender } from './domain/facts';
import { GenderCalibrationGate } from './domain/gender-calibration';
import { DEFAULT_POLICY, V01Policy } from './domain/policy';
import { extractCardInfo, ExtractedCardInfo } from './dom/card-extractor';
import { CardObserver } from './dom/card-observer';
import { CardPresenter } from './dom/card-presenter';
import { CircuitBreaker } from './network/breaker';
import { ProfileCache } from './network/cache';
import { ProfileFetcher } from './network/profile-fetcher';
import { ViewportScheduler } from './network/viewport-scheduler';
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
  private calibrationGate: GenderCalibrationGate;
  private breaker: CircuitBreaker;
  private scheduler: ViewportScheduler;

  constructor(
    customFetcher?: ProfileFetcher,
    calibrationGate?: GenderCalibrationGate,
    customBreaker?: CircuitBreaker
  ) {
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
    this.calibrationGate = calibrationGate || new GenderCalibrationGate();

    this.breaker =
      customBreaker ||
      new CircuitBreaker({
        onStateChange: () => this.updateStats(),
      });

    this.scheduler = new ViewportScheduler(this.breaker);

    this.ui = new FilterUI(
      {
        onKeywordChange: (kw) => this.handleKeywordChange(kw),
        onClearKeyword: () => this.handleKeywordChange(''),
        onPolicyChange: (partialPolicy) => this.handlePolicyChange(partialPolicy),
        onManualRecover: () => this.handleManualRecover(),
      },
      this.policy
    );

    this.ui.setCalibrationStatus(this.calibrationGate.getStatus());

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
    this.scheduler.destroy();
    this.cards.clear();
    this.factsMap.clear();
  }

  private handleCardDiscovered(cardElement: HTMLElement): void {
    if (this.cards.has(cardElement)) return;
    const info = extractCardInfo(cardElement);
    this.cards.set(cardElement, info);

    // 视口观察器挂载
    this.scheduler.observeCard(cardElement);

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
        cached.gender = this.calibrationGate.normalize(cached.rawGender);
        this.factsMap.set(info.userId, cached);
        this.applyCardEvaluation(info, cached);
      } else {
        // 加入视口感知调度器排队
        this.enqueueEnrichment(info.userId, cardElement);
      }
    }

    this.updateStats();
  }

  private enqueueEnrichment(userId: string, cardElement: HTMLElement): void {
    this.scheduler.enqueue({
      userId,
      cardElement,
      priority: this.scheduler.getCardPriority(cardElement),
      execute: async () => {
        try {
          const facts = await this.fetcher.fetchProfileFacts(userId);
          facts.gender = this.calibrationGate.normalize(facts.rawGender);

          this.cache.set(userId, facts);
          this.factsMap.set(userId, facts);

          // 重新评估并呈现该 userId 的所有卡片
          for (const info of this.cards.values()) {
            if (info.userId === userId) {
              this.applyCardEvaluation(info, facts);
            }
          }
        } catch (err: unknown) {
          const isRateLimited = (err as { isRateLimited?: boolean })?.isRateLimited;
          const isVerification = (err as { isVerification?: boolean })?.isVerification;

          if (isRateLimited || isVerification) {
            // 遇到 429 或验证码立即熔断暂停
            this.breaker.trip(isRateLimited ? 'HTTP 429 限流' : '出现验证码重定向');
          } else {
            console.warn(`[xhs-live-filter] Enrich user ${userId} failed (ordinary):`, err);
          }
        } finally {
          this.updateStats();
        }
      },
    });
  }

  private handleKeywordChange(keyword: string): void {
    this.policy.contentKeyword = keyword;
    StorageAdapter.set('contentKeyword', keyword);
    this.refreshContentMatches();
  }

  private handlePolicyChange(partialPolicy: Partial<V01Policy>): void {
    this.policy = { ...this.policy, ...partialPolicy };
    StorageAdapter.set('allowedGenders', this.policy.allowedGenders);
    StorageAdapter.set('preferredRegions', this.policy.preferredRegions);
    StorageAdapter.set('hideExcluded', this.policy.hideExcluded);

    this.refreshEvaluationsOnly();
  }

  /**
   * 用户手动点击 [恢复] 按钮触发单次受控探针
   * 严格执行 exactly one probe request，绝不启动自动循环
   */
  async handleManualRecover(): Promise<boolean> {
    return this.breaker.manualProbe(async () => {
      // 寻找视口内第一个未增强的 userId 作为探针目标
      let targetUserId: string | null = null;
      for (const info of this.cards.values()) {
        if (info.userId && !this.factsMap.has(info.userId) && !this.cache.get(info.userId)) {
          targetUserId = info.userId;
          break;
        }
      }
      if (!targetUserId) {
        // 如果没有未增强的卡片，直接恢复为 RUNNING
        return true;
      }

      try {
        const facts = await this.fetcher.fetchProfileFacts(targetUserId);
        facts.gender = this.calibrationGate.normalize(facts.rawGender);
        this.cache.set(targetUserId, facts);
        this.factsMap.set(targetUserId, facts);

        for (const info of this.cards.values()) {
          if (info.userId === targetUserId) {
            this.applyCardEvaluation(info, facts);
          }
        }
        return true;
      } catch (err: unknown) {
        const isRateLimited = (err as { isRateLimited?: boolean })?.isRateLimited;
        const isVerification = (err as { isVerification?: boolean })?.isVerification;
        if (isRateLimited || isVerification) {
          return false;
        }
        // 普通错误不阻止恢复
        return true;
      }
    });
  }

  calibrateGender(mapping: Record<string | number, NormalizedGender>): void {
    this.calibrationGate.calibrate(mapping);
    this.ui.setCalibrationStatus(this.calibrationGate.getStatus());

    for (const facts of this.factsMap.values()) {
      facts.gender = this.calibrationGate.normalize(facts.rawGender);
    }

    this.refreshEvaluationsOnly();
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

  private refreshEvaluationsOnly(): void {
    for (const info of this.cards.values()) {
      const facts = info.userId
        ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId)
        : createUnknownFacts();
      this.applyCardEvaluation(info, facts);
    }
    this.updateStats();
  }

  private refreshAll(): void {
    this.refreshContentMatches();
    this.refreshEvaluationsOnly();
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
      const facts = info.userId
        ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId)
        : createUnknownFacts();
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
      isPaused: this.breaker.isPaused(),
    };
    this.ui.updateStats(stats);
  }

  // 供测试与检查的接口
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

  getCalibrationGate(): GenderCalibrationGate {
    return this.calibrationGate;
  }

  getBreaker(): CircuitBreaker {
    return this.breaker;
  }

  getScheduler(): ViewportScheduler {
    return this.scheduler;
  }

  setPolicy(policy: Partial<V01Policy>): void {
    this.handlePolicyChange(policy);
  }
}
