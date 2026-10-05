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

export class ViewportScheduler {
  private static readonly MAX_CONCURRENCY = 2;
  private static readonly THROTTLE_INTERVAL_MS = 50; // 请求启动节流间隔

  private observer: IntersectionObserver | null = null;
  private cardPriorityMap = new WeakMap<HTMLElement, ViewportPriority>();
  private queue: TaskItem[] = [];
  private inFlightCount = 0;
  private lastRequestStartTime = 0;
  private breaker: CircuitBreaker;
  private isProcessing = false;

  constructor(breaker: CircuitBreaker) {
    this.breaker = breaker;
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
    // 检查是否已经在队列中
    if (this.queue.some((t) => t.userId === task.userId)) {
      return;
    }
    task.priority = this.getCardPriority(task.cardElement);
    this.queue.push(task);
    this.reorderQueue();
    this.schedule();
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
        this.inFlightCount < ViewportScheduler.MAX_CONCURRENCY &&
        !this.breaker.isPaused()
      ) {
        // 请求启动节流检查
        const now = Date.now();
        const elapsed = now - this.lastRequestStartTime;
        if (elapsed < ViewportScheduler.THROTTLE_INTERVAL_MS) {
          const waitTime = ViewportScheduler.THROTTLE_INTERVAL_MS - elapsed;
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
        this.lastRequestStartTime = Date.now();

        // 异步执行，允许并发继续
        task
          .execute()
          .catch((err) => {
            console.warn(`[xhs-live-filter] Task for ${task.userId} failed:`, err);
          })
          .finally(() => {
            this.inFlightCount--;
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
