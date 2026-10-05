/**
 * 两级 Profile 缓存体系 (Two-tier Cache)
 * L1: 内存缓存
 * L2: Userscript 持久存储 (StorageAdapter)
 * TTL = 24h, 容量保护 = 2000 项
 */

import { NormalizedFacts } from '../domain/facts';
import { StorageAdapter } from '../storage/storage';

export interface CacheEntry {
  facts: NormalizedFacts;
  cachedAt: number; // 毫秒时间戳
}

export class ProfileCache {
  private static readonly TTL_MS = 24 * 60 * 60 * 1000; // 24小时
  private static readonly MAX_ENTRIES = 2000;
  private static readonly STORAGE_KEY = 'profile_cache_v1';

  private l1Map = new Map<string, CacheEntry>();

  constructor() {
    this.loadL2();
  }

  /**
   * 从 L1 或 L2 获取有效缓存项
   */
  get(userId: string): NormalizedFacts | null {
    if (!userId) return null;

    const now = Date.now();

    // 1. 检查 L1
    const l1Entry = this.l1Map.get(userId);
    if (l1Entry) {
      if (now - l1Entry.cachedAt < ProfileCache.TTL_MS) {
        return l1Entry.facts;
      } else {
        this.l1Map.delete(userId);
      }
    }

    return null;
  }

  /**
   * 写入成功解析的 Profile Facts
   */
  set(userId: string, facts: NormalizedFacts): void {
    if (!userId || !facts.enriched) {
      // 仅允许缓存成功解析的事实
      return;
    }

    const entry: CacheEntry = {
      facts,
      cachedAt: Date.now(),
    };

    // 内存容量保护淘汰
    if (this.l1Map.size >= ProfileCache.MAX_ENTRIES) {
      const oldestKey = this.l1Map.keys().next().value;
      if (oldestKey) {
        this.l1Map.delete(oldestKey);
      }
    }

    this.l1Map.set(userId, entry);
    this.persistL2();
  }

  /**
   * 加载 L2 持久化存储
   */
  private loadL2(): void {
    const rawData = StorageAdapter.get<Record<string, CacheEntry>>(ProfileCache.STORAGE_KEY, {});
    const now = Date.now();
    for (const [key, entry] of Object.entries(rawData)) {
      if (entry && typeof entry.cachedAt === 'number' && now - entry.cachedAt < ProfileCache.TTL_MS) {
        this.l1Map.set(key, entry);
      }
    }
  }

  /**
   * 持久化到 L2
   */
  private persistL2(): void {
    const record: Record<string, CacheEntry> = {};
    for (const [key, entry] of this.l1Map.entries()) {
      record[key] = entry;
    }
    StorageAdapter.set(ProfileCache.STORAGE_KEY, record);
  }

  clear(): void {
    this.l1Map.clear();
    StorageAdapter.set(ProfileCache.STORAGE_KEY, {});
  }

  size(): number {
    return this.l1Map.size;
  }
}
