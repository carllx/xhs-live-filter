/**
 * xhs-live-filter 核心运行时 (Primary Runtime Seam)
 */

import { evaluate, EvaluationResult, matchContent } from './domain/evaluation';
import { createUnknownFacts, NormalizedFacts, NormalizedGender } from './domain/facts';
import { GenderCalibrationGate } from './domain/gender-calibration';
import { DEFAULT_POLICY, ProfileSafetyPause, STORAGE_KEYS, V01Policy } from './domain/policy';
import { extractCardInfo, ExtractedCardInfo } from './dom/card-extractor';
import { CardObserver } from './dom/card-observer';
import { CardPresenter } from './dom/card-presenter';
import { CircuitBreaker } from './network/breaker';
import { ProfileCache } from './network/cache';
import { ProfileFetcher } from './network/profile-fetcher';
import { FeedIdentityStore, FeedIdentity } from './network/feed-identity-store';
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
  private identityStore: FeedIdentityStore;
  private unsubscribeIdentityStore?: () => void;
  private boundCardCount = 0;
  private safetyPauseLatch: ProfileSafetyPause | null = null;

  constructor(
    customFetcher?: ProfileFetcher,
    calibrationGate?: GenderCalibrationGate,
    customBreaker?: CircuitBreaker,
    identityStore?: FeedIdentityStore,
    schedulerOptions?: { maxConcurrency?: number; minIntervalMs?: number },
    initialPolicy?: Partial<V01Policy>
  ) {
    // 读取持久化策略
    const savedKeyword = StorageAdapter.get<string>(STORAGE_KEYS.CONTENT_KEYWORD, '');
    const savedRegions = StorageAdapter.get<string[]>(STORAGE_KEYS.PREFERRED_REGIONS, DEFAULT_POLICY.preferredRegions);
    const savedKeepUnknownRegion = StorageAdapter.get<boolean>(STORAGE_KEYS.KEEP_UNKNOWN_REGION, DEFAULT_POLICY.keepUnknownRegion);
    const savedGenders = StorageAdapter.get<string[]>(STORAGE_KEYS.ALLOWED_GENDERS, DEFAULT_POLICY.allowedGenders);
    const savedKeepUnknownGender = StorageAdapter.get<boolean>(STORAGE_KEYS.KEEP_UNKNOWN_GENDER, DEFAULT_POLICY.keepUnknownGender);
    // 检查持久化安全闭锁 (Persistent Safety Latch, 如 300013)
    this.safetyPauseLatch = StorageAdapter.get<ProfileSafetyPause | null>(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, null);

    // 显式授权门禁：未显式开启、旧用户缺省、或存在 safety latch 时强制为 false
    let savedEnrichmentEnabled = StorageAdapter.get<boolean>(STORAGE_KEYS.PROFILE_ENRICHMENT_ENABLED, DEFAULT_POLICY.profileEnrichmentEnabled);
    if (this.safetyPauseLatch) {
      savedEnrichmentEnabled = false;
    }

    this.policy = {
      contentKeyword: savedKeyword,
      preferredRegions: savedRegions,
      keepUnknownRegion: savedKeepUnknownRegion,
      allowedGenders: savedGenders,
      keepUnknownGender: savedKeepUnknownGender,
      hideExcluded: true,
      profileEnrichmentEnabled: savedEnrichmentEnabled,
      ...initialPolicy,
    };
    if (this.safetyPauseLatch && !initialPolicy?.profileEnrichmentEnabled) {
      this.policy.profileEnrichmentEnabled = false;
    }

    this.cache = new ProfileCache();
    this.fetcher = customFetcher || new ProfileFetcher();
    this.calibrationGate = calibrationGate || new GenderCalibrationGate();
    this.identityStore = identityStore || FeedIdentityStore.getInstance();

    // 订阅 FeedIdentityStore 的新身份到来（Late-Binding: Card 先出现，Squarefeed 后到）
    this.unsubscribeIdentityStore = this.identityStore.onIdentityAdded((identity) => {
      this.handleLateIdentityBound(identity);
    });

    this.breaker =
      customBreaker ||
      new CircuitBreaker({
        onStateChange: () => this.updateStats(),
      });

    this.scheduler = new ViewportScheduler(this.breaker, schedulerOptions);

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

    // 若启动时存在安全闭锁，立即将 breaker 设为 PAUSED（此时 this.ui 已初始化）
    if (this.safetyPauseLatch) {
      this.breaker.trip(this.safetyPauseLatch.reason || 'XHS 300013 rate limit');
    }

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
    if (this.unsubscribeIdentityStore) {
      this.unsubscribeIdentityStore();
      this.unsubscribeIdentityStore = undefined;
    }
    this.observer.stop();
    this.scheduler.destroy();
    this.cards.clear();
    this.factsMap.clear();
  }

  private handleCardDiscovered(cardElement: HTMLElement): void {
    if (this.cards.has(cardElement)) return;
    const info = extractCardInfo(cardElement);

    // Case A: Squarefeed 先到，Identity Map 中已有该 liveId -> 立即绑定
    if (!info.userId && info.liveId && this.identityStore.has(info.liveId)) {
      const idRecord = this.identityStore.getIdentity(info.liveId);
      if (idRecord) {
        info.userId = idRecord.userId;
        if (!info.nickname && idRecord.nickname) info.nickname = idRecord.nickname;
        if (!info.title && idRecord.title) info.title = idRecord.title;
        this.boundCardCount++;
        console.log(`[xhs-live-filter] card identity bound: liveId=${info.liveId}`);
      }
    }

    this.cards.set(cardElement, info);

    // 视口观察器挂载
    this.scheduler.observeCard(cardElement);

    // 初始呈现与数据调度
    if (!info.userId) {
      // 身份尚未就绪（等待 Case B late binding）
      const unknownFacts = createUnknownFacts();
      this.applyCardEvaluation(info, unknownFacts);
    } else {
      this.processCardWithUserId(info);
    }

    this.updateStats();
  }

  /**
   * Late Binding (Case B): Card 先出现，Squarefeed 后到
   */
  private handleLateIdentityBound(identity: FeedIdentity): void {
    for (const info of this.cards.values()) {
      if (info.liveId === identity.liveId && !info.userId) {
        info.userId = identity.userId;
        if (!info.nickname && identity.nickname) info.nickname = identity.nickname;
        if (!info.title && identity.title) info.title = identity.title;
        this.boundCardCount++;
        console.log(`[xhs-live-filter] card identity bound: liveId=${identity.liveId}`);

        // 绑定成功，执行视口调度与呈现
        this.processCardWithUserId(info);
      }
    }
    this.updateStats();
  }

  private isEnrichmentNeeded(): boolean {
    // 显式授权门禁：未显式开启时，严格 Fail-Closed，产生 0 主动请求
    if (!this.policy.profileEnrichmentEnabled) {
      return false;
    }

    // 持久化安全闭锁门禁：若当前存在安全闭锁（如 300013），严禁启动任何主动请求
    if (this.safetyPauseLatch) {
      return false;
    }

    // 熔断保护门禁：若熔断器处于 PAUSED 状态，严禁启动任何主动请求
    if (this.breaker.isPaused()) {
      return false;
    }

    // 只有当当前策略实际需要 Profile Facts 时才启动网络请求：
    // 1. 设置了目标属地（preferredRegions.length > 0）
    // 2. 或性别门禁已校准（gender gate === CALIBRATED）
    const hasRegionFilter = this.policy.preferredRegions.length > 0;
    const isGenderCalibrated = this.calibrationGate.getStatus() === 'CALIBRATED';
    return hasRegionFilter || isGenderCalibrated;
  }

  private processCardWithUserId(info: ExtractedCardInfo): void {
    if (!info.userId) return;
    const cached = this.cache.get(info.userId);
    if (cached) {
      ProfileFetcher.recordCacheHit();
      cached.gender = this.calibrationGate.normalize(cached.rawGender);
      this.factsMap.set(info.userId, cached);
      this.applyCardEvaluation(info, cached);
    } else {
      const initialUnknown = createUnknownFacts(info.userId);
      this.applyCardEvaluation(info, initialUnknown);

      // 按需启动检查：若无需 profile 事实，绝不产生请求
      if (this.isEnrichmentNeeded()) {
        this.enqueueEnrichment(info.userId, info.cardElement);
      }
    }
  }

  private enqueueEnrichment(userId: string, cardElement: HTMLElement): void {
    if (!userId || !this.isEnrichmentNeeded()) return;

    // 全生命周期去重：cached / inFlight / queued
    if (this.cache.get(userId) || this.factsMap.has(userId) || this.scheduler.isInFlightOrQueued(userId)) {
      ProfileFetcher.recordDeduped();
      return;
    }

    this.scheduler.enqueue({
      userId,
      cardElement,
      priority: this.scheduler.getCardPriority(cardElement),
      execute: async () => {
        // 第二层门禁：任务出队执行前再次复核用户授权门禁、安全闭锁与熔断器状态
        if (!this.isEnrichmentNeeded()) {
          return;
        }

        try {
          const facts = await this.fetcher.fetchProfileFacts(userId);
          facts.gender = this.calibrationGate.normalize(facts.rawGender);

          this.cache.set(userId, facts);
          this.factsMap.set(userId, facts);

          // 重新呈现该 userId 的所有卡片（同一 userId 多张卡片共享同一次 enrichment）
          for (const info of this.cards.values()) {
            if (info.userId === userId) {
              this.applyCardEvaluation(info, facts);
            }
          }
        } catch (err: unknown) {
          const isSecurityStop = (err as { isSecurityStop?: boolean })?.isSecurityStop;
          const isRateLimited = (err as { isRateLimited?: boolean })?.isRateLimited;
          const isVerification = (err as { isVerification?: boolean })?.isVerification;
          const errCode = (err as { code?: number | string })?.code;
          const reason = (err as { reason?: string })?.reason || (isRateLimited ? 'HTTP 429 限流' : isVerification ? '出现验证码重定向' : '安全拦截');

          if (isSecurityStop || isRateLimited || isVerification) {
            ProfileFetcher.recordPaused(reason);

            // 如果是 300013 限流或包含 300013
            if (errCode === 300013 || errCode === '300013' || reason.includes('300013')) {
              this.safetyPauseLatch = {
                code: 300013,
                reason: 'XHS 300013 rate limit',
                detectedAt: Date.now(),
              };
              StorageAdapter.set(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, this.safetyPauseLatch);
            }

            // 安全关闭：profileEnrichmentEnabled 设为 false 并持久化
            this.policy.profileEnrichmentEnabled = false;
            StorageAdapter.set(STORAGE_KEYS.PROFILE_ENRICHMENT_ENABLED, false);

            // 清空所有尚未开始的待处理排队任务
            this.scheduler.clearPendingQueue();

            // CircuitBreaker 熔断
            this.breaker.trip(reason);

            // 同步 UI 状态与复选框
            this.ui.syncPolicyToUI(this.policy);
          } else {
            console.warn(`[xhs-live-filter] Enrich user failed (ordinary fail-open):`, err);
          }
        } finally {
          this.updateStats();
        }
      },
    });
  }

  private handleKeywordChange(keyword: string): void {
    this.policy.contentKeyword = keyword;
    StorageAdapter.set(STORAGE_KEYS.CONTENT_KEYWORD, keyword);
    this.refreshAll();
  }

  private handlePolicyChange(partialPolicy: Partial<V01Policy>): void {
    const wasEnrichmentNeeded = this.isEnrichmentNeeded();
    this.policy = { ...this.policy, ...partialPolicy };
    StorageAdapter.set(STORAGE_KEYS.ALLOWED_GENDERS, this.policy.allowedGenders);
    StorageAdapter.set(STORAGE_KEYS.KEEP_UNKNOWN_GENDER, this.policy.keepUnknownGender);
    StorageAdapter.set(STORAGE_KEYS.PREFERRED_REGIONS, this.policy.preferredRegions);
    StorageAdapter.set(STORAGE_KEYS.KEEP_UNKNOWN_REGION, this.policy.keepUnknownRegion);
    StorageAdapter.set(STORAGE_KEYS.PROFILE_ENRICHMENT_ENABLED, this.policy.profileEnrichmentEnabled);

    if (!this.policy.profileEnrichmentEnabled) {
      // 授权关闭：立即清除待处理排队任务，停止后续请求
      this.scheduler.clearPendingQueue();
    } else if (!wasEnrichmentNeeded && this.isEnrichmentNeeded()) {
      // 如果从“不需要”变为“需要 enrichment”，为当前未缓存卡片按需调度
      for (const info of this.cards.values()) {
        if (info.userId && !this.cache.get(info.userId) && !this.factsMap.has(info.userId)) {
          this.enqueueEnrichment(info.userId, info.cardElement);
        }
      }
    }

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
        // 无待处理卡片时直接视为探测成功，清除闭锁
        this.safetyPauseLatch = null;
        StorageAdapter.remove(STORAGE_KEYS.PROFILE_SAFETY_PAUSE);
        this.policy.profileEnrichmentEnabled = false;
        StorageAdapter.set(STORAGE_KEYS.PROFILE_ENRICHMENT_ENABLED, false);
        this.ui.syncPolicyToUI(this.policy);
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

        // 探测成功：清除持久化安全闭锁，但 profileEnrichmentEnabled 仍保持 false，不自动恢复 batch enrichment
        this.safetyPauseLatch = null;
        StorageAdapter.remove(STORAGE_KEYS.PROFILE_SAFETY_PAUSE);
        this.policy.profileEnrichmentEnabled = false;
        StorageAdapter.set(STORAGE_KEYS.PROFILE_ENRICHMENT_ENABLED, false);
        this.ui.syncPolicyToUI(this.policy);

        return true;
      } catch (err: unknown) {
        const isSecurityStop = (err as { isSecurityStop?: boolean })?.isSecurityStop;
        const isRateLimited = (err as { isRateLimited?: boolean })?.isRateLimited;
        const isVerification = (err as { isVerification?: boolean })?.isVerification;
        const errCode = (err as { code?: number | string })?.code;
        const reason = (err as { reason?: string })?.reason || '安全拦截';

        if (errCode === 300013 || errCode === '300013' || reason.includes('300013')) {
          this.safetyPauseLatch = {
            code: 300013,
            reason: 'XHS 300013 rate limit',
            detectedAt: Date.now(),
          };
          StorageAdapter.set(STORAGE_KEYS.PROFILE_SAFETY_PAUSE, this.safetyPauseLatch);
        }

        if (isSecurityStop || isRateLimited || isVerification) {
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

    const isPaused = this.breaker.isPaused() || !!this.safetyPauseLatch;
    const stats: UIStats = {
      totalCards: this.cards.size,
      visibleCards: visibleCount,
      filteredCards: this.cards.size - visibleCount,
      isPaused,
      pauseReason: this.safetyPauseLatch?.reason || this.breaker.getReason(),
      pauseCode: this.safetyPauseLatch?.code,
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

  getIdentityStore(): FeedIdentityStore {
    return this.identityStore;
  }

  getBoundCardCount(): number {
    return this.boundCardCount;
  }

  getSafetyLatch(): ProfileSafetyPause | null {
    return this.safetyPauseLatch;
  }

  setPolicy(policy: Partial<V01Policy>): void {
    this.handlePolicyChange(policy);
  }
}
