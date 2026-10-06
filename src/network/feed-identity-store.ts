/**
 * Squarefeed 响应中解析出的主播与直播元数据
 */
export interface FeedIdentity {
  liveId: string;
  userId: string;
  nickname: string;
  title: string;
}

export type FeedIdentityListener = (identity: FeedIdentity) => void;

/**
 * 轻量内存 Feed Identity Store
 */
export class FeedIdentityStore {
  private static instance: FeedIdentityStore;
  private identities: Map<string, FeedIdentity> = new Map(); // liveId -> FeedIdentity
  private listeners: Set<FeedIdentityListener> = new Set();
  private capturedFeedCount = 0;

  static getInstance(): FeedIdentityStore {
    if (!FeedIdentityStore.instance) {
      FeedIdentityStore.instance = new FeedIdentityStore();
    }
    return FeedIdentityStore.instance;
  }

  /**
   * 注册新身份监听器（用于 late-binding 关联卡片）
   */
  onIdentityAdded(listener: FeedIdentityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 存入解析好的身份信息，若为新 liveId 则触发监听通知
   */
  addIdentity(identity: FeedIdentity): void {
    if (!identity.liveId || !identity.userId) return;
    const isNew = !this.identities.has(identity.liveId);
    this.identities.set(identity.liveId, identity);
    if (isNew) {
      for (const listener of this.listeners) {
        try {
          listener(identity);
        } catch (e) {
          console.warn('[xhs-live-filter] Identity listener error:', e);
        }
      }
    }
  }

  getIdentity(liveId: string): FeedIdentity | undefined {
    return this.identities.get(liveId);
  }

  has(liveId: string): boolean {
    return this.identities.has(liveId);
  }

  incrementCapturedCount(count: number): void {
    this.capturedFeedCount += count;
  }

  // Diagnostics 只读统计
  getCapturedFeedCount(): number {
    return this.capturedFeedCount;
  }

  getIdentityMapSize(): number {
    return this.identities.size;
  }

  clear(): void {
    this.identities.clear();
    this.capturedFeedCount = 0;
  }
}
