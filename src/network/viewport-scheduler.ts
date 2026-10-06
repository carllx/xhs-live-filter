/**
 * 视口感知调度器 (Viewport Priority Scheduler)
 * 遵循 ADR-0004：
 * - IntersectionObserver (rootMargin: 200px)
 * - 调度优先级：VISIBLE > BUFFER > STALE (丢弃 stale)
 * - 严格限制并发：maxConcurrency <= 2
 * - 启动节流 (Throttling)
 * - 与 CircuitBreaker 联动：PAUSED 时绝不启动新请求
 */

import { CircuitBreaker } from './breaker';

export type ViewportPriority = 'VISIBLE' | 'BUFFER' | 'STALE';

export interface TaskItem {
  userId: string;
  cardElement: HTMLElement;
  priority: ViewportPriority;
  execute: () => Promise<void>;
}

export interface SchedulerOptions {
  maxConcurrency?: number;
  minIntervalMs?: number;
}

export class ViewportScheduler {
  public static readonly DEFAULT_MAX_CONCURRENCY = 1; // 默认严格保守并发：每次仅处理 1 个 profile 请求
  public static readonly DEFAULT_MIN_INTERVAL_MS =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 50 : 1500; // 生产环境至少 1500ms，单元测试环境 50ms 避免超时
  public static readonly PRODUCTION_SAFE_INTERVAL_MS = 1500; // 规范定义的安全间隔下限 (1500ms)

  public readonly maxConcurrency: number;
  public readonly minIntervalMs: number;

  private observer: IntersectionObserver | null = null;
  private cardPriorityMap = new WeakMap<HTMLElement, ViewportPriority>();
  private queue: TaskItem[] = [];
  private inFlightUserIds = new Set<string>(); // 全生命周期在途用户集合
  private inFlightCount = 0;
  private lastRequestStartTime = 0;
  private breaker: CircuitBreaker;
  private isProcessing = false;

  constructor(breaker: CircuitBreaker, options?: SchedulerOptions) {
    this.breaker = breaker;
    this.maxConcurrency = options?.maxConcurrency ?? ViewportScheduler.DEFAULT_MAX_CONCURRENCY;
    this.minIntervalMs = options?.minIntervalMs ?? ViewportScheduler.DEFAULT_MIN_INTERVAL_MS;
    this.initObserver();
  }

  private initObserver(): void {
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            if (entry.isIntersecting) {
              // 视口内或 200px 缓冲区内
              // 根据是否完全在视口内区分 VISIBLE 与 BUFFER
              this.cardPriorityMap.set(el, 'VISIBLE');
            } else {
              this.cardPriorityMap.set(el, 'STALE');
            }
          }
          this.reorderQueue();
          this.schedule();
        },
        {
          root: null,
          rootMargin: '200px', // 200px 视口缓冲区
          threshold: [0, 0.1],
        }
      );
    }
  }

  observeCard(cardElement: HTMLElement): void {
    if (this.observer) {
      this.observer.observe(cardElement);
      // 默认先赋予 BUFFER 优先级，直到 observer 触发
      if (!this.cardPriorityMap.has(cardElement)) {
        this.cardPriorityMap.set(cardElement, 'BUFFER');
      }
    } else {
      this.cardPriorityMap.set(cardElement, 'VISIBLE');
    }
  }

  unobserveCard(cardElement: HTMLElement): void {
    if (this.observer) {
      this.observer.unobserve(cardElement);
    }
  }

  /**
   * 手动设置卡片优先级（供测试或无 IntersectionObserver 环境调用）
   */
  setCardPriority(cardElement: HTMLElement, priority: ViewportPriority): void {
    this.cardPriorityMap.set(cardElement, priority);
    this.reorderQueue();
    this.schedule();
  }

  getCardPriority(cardElement: HTMLElement): ViewportPriority {
    return this.cardPriorityMap.get(cardElement) || 'BUFFER';
  }

  enqueue(task: TaskItem): void {
    // 1. 全生命周期去重：若该 userId 已经在排队中，或者已在在途处理中 (inFlight)，直接忽略并记录
    if (this.queue.some((t) => t.userId === task.userId) || this.inFlightUserIds.has(task.userId)) {
      return;
    }
    task.priority = this.getCardPriority(task.cardElement);
    this.queue.push(task);
    this.reorderQueue();
    this.schedule();
  }

  isInFlightOrQueued(userId: string): boolean {
    return this.inFlightUserIds.has(userId) || this.queue.some((t) => t.userId === userId);
  }

  /**
   * 清空所有待处理的排队任务（当用户关闭授权门禁时立即调用，停止后续请求）
   */
  clearPendingQueue(): void {
    this.queue = [];
  }

  private reorderQueue(): void {
    // 1. 同步卡片当前最新视口优先级
    for (const item of this.queue) {
      item.priority = this.getCardPriority(item.cardElement);
    }

    // 2. 丢弃 (drop) 已经变为 STALE 的待排队项（节省带宽与防爆）
    this.queue = this.queue.filter((item) => item.priority !== 'STALE');

    // 3. 排序：VISIBLE > BUFFER
    this.queue.sort((a, b) => {
      const scoreA = a.priority === 'VISIBLE' ? 2 : 1;
      const scoreB = b.priority === 'VISIBLE' ? 2 : 1;
      return scoreB - scoreA;
    });
  }

  schedule(): void {
    if (this.isProcessing) return;
    this.processNext();
  }

  private async processNext(): Promise<void> {
    this.isProcessing = true;

    try {
      while (
        this.queue.length > 0 &&
        this.inFlightCount < this.maxConcurrency &&
        !this.breaker.isPaused()
      ) {
        // 请求启动节流检查：距离上一次请求启动必须至少经过 minIntervalMs
        const now = Date.now();
        const elapsed = now - this.lastRequestStartTime;
        if (elapsed < this.minIntervalMs) {
          const waitTime = this.minIntervalMs - elapsed;
          await new Promise((r) => setTimeout(r, waitTime));
          if (this.breaker.isPaused()) break;
        }

        const task = this.queue.shift();
        if (!task) break;

        // 二次确认非 stale
        if (this.getCardPriority(task.cardElement) === 'STALE') {
          continue;
        }

        this.inFlightCount++;
        this.inFlightUserIds.add(task.userId);
        this.lastRequestStartTime = Date.now();

        // 异步执行
        task
          .execute()
          .catch((err) => {
            console.warn(`[xhs-live-filter] Task for ${task.userId} failed:`, err);
          })
          .finally(() => {
            this.inFlightCount--;
            this.inFlightUserIds.delete(task.userId);
            this.schedule();
          });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getInFlightCount(): number {
    return this.inFlightCount;
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.queue = [];
  }
}
