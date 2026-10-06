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
    const savedKeepUnknownRegion = StorageAdapter.get<boolean>('keepUnknownRegion', DEFAULT_POLICY.keepUnknownRegion);
    const savedGenders = StorageAdapter.get<string[]>('allowedGenders', DEFAULT_POLICY.allowedGenders);
    const savedKeepUnknownGender = StorageAdapter.get<boolean>('keepUnknownGender', DEFAULT_POLICY.keepUnknownGender);

    this.policy = {
      contentKeyword: savedKeyword,
      preferredRegions: savedRegions,
      keepUnknownRegion: savedKeepUnknownRegion,
      allowedGenders: savedGenders,
      keepUnknownGender: savedKeepUnknownGender,
      hideExcluded: true,
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

    // 初始呈现（根据已有已知事实）
    if (!info.userId) {
      const unknownFacts = createUnknownFacts();
      this.applyCardEvaluation(info, unknownFacts);
    } else {
      const cached = this.cache.get(info.userId);
      if (cached) {
        cached.gender = this.calibrationGate.normalize(cached.rawGender);
        this.factsMap.set(info.userId, cached);
        this.applyCardEvaluation(info, cached);
      } else {
        // 未缓存时先按 unknown 呈现并加入调度排队
        const initialUnknown = createUnknownFacts(info.userId);
        this.applyCardEvaluation(info, initialUnknown);
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

          // 重新呈现该 userId 的所有卡片
          for (const info of this.cards.values()) {
            if (info.userId === userId) {
              this.applyCardEvaluation(info, facts);
            }
          }
        } catch (err: unknown) {
          const isRateLimited = (err as { isRateLimited?: boolean })?.isRateLimited;
          const isVerification = (err as { isVerification?: boolean })?.isVerification;

          if (isRateLimited || isVerification) {
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
    this.refreshAll();
  }

  private handlePolicyChange(partialPolicy: Partial<V01Policy>): void {
    this.policy = { ...this.policy, ...partialPolicy };
    StorageAdapter.set('allowedGenders', this.policy.allowedGenders);
    StorageAdapter.set('keepUnknownGender', this.policy.keepUnknownGender);
    StorageAdapter.set('preferredRegions', this.policy.preferredRegions);
    StorageAdapter.set('keepUnknownRegion', this.policy.keepUnknownRegion);

    this.refreshAll();
  }

  async handleManualRecover(): Promise<boolean> {
    return this.breaker.manualProbe(async () => {
      let targetUserId: string | null = null;
      for (const info of this.cards.values()) {
        if (info.userId && !this.factsMap.has(info.userId) && !this.cache.get(info.userId)) {
          targetUserId = info.userId;
          break;
        }
      }
      if (!targetUserId) {
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

    this.refreshAll();
  }

  private applyCardEvaluation(info: ExtractedCardInfo, facts: NormalizedFacts): void {
    const isCalibrated = this.calibrationGate.getStatus() === 'CALIBRATED';
    const result: EvaluationResult = evaluate(facts, this.policy, isCalibrated);
    const contentMatched = matchContent(this.policy.contentKeyword, info.title, info.nickname);
    CardPresenter.applyPresentation(info.cardElement, contentMatched, result, facts);
  }

  private refreshAll(): void {
    for (const info of this.cards.values()) {
      const facts = info.userId
        ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId)
        : createUnknownFacts();
      this.applyCardEvaluation(info, facts);
    }
    this.updateStats();
  }

  private updateStats(): void {
    let visibleCount = 0;
    const isCalibrated = this.calibrationGate.getStatus() === 'CALIBRATED';

    for (const info of this.cards.values()) {
      const facts = info.userId
        ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId)
        : createUnknownFacts();
      const evalRes = evaluate(facts, this.policy, isCalibrated);
      const contentMatched = matchContent(this.policy.contentKeyword, info.title, info.nickname);
      if (contentMatched && evalRes.status !== 'EXCLUDED') {
        visibleCount++;
      }
    }

    const stats: UIStats = {
      totalCards: this.cards.size,
      visibleCards: visibleCount,
      filteredCards: this.cards.size - visibleCount,
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
