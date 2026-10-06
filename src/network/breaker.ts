/**
 * 风控熔断器与单次受控探针恢复状态机
 * 遵循 ADR-0004：遇到 429 或验证码立即熔断暂停
 * 严禁后台自动轮询探针或自动退避恢复；唯一恢复路径为用户手动点击 [恢复] 发起单次探针
 */

export type BreakerState = 'RUNNING' | 'PAUSED';

export interface BreakerCallbacks {
  onStateChange: (state: BreakerState) => void;
}

export class CircuitBreaker {
  private state: BreakerState = 'RUNNING';
  private callbacks: BreakerCallbacks;
  private isProbing: boolean = false;
  private pauseReason: string = '';

  constructor(callbacks: BreakerCallbacks) {
    this.callbacks = callbacks;
  }

  getState(): BreakerState {
    return this.state;
  }

  getReason(): string {
    return this.pauseReason;
  }

  isPaused(): boolean {
    return this.state === 'PAUSED';
  }

  /**
   * 触发限流熔断
   * @param reason 熔断触发原因
   */
  trip(reason: string): void {
    this.pauseReason = reason;
    if (this.state === 'PAUSED') return;
    this.state = 'PAUSED';
    console.warn(`[xhs-live-filter] CircuitBreaker TRIPPED to PAUSED: ${reason}`);
    this.callbacks.onStateChange(this.state);
  }

  /**
   * 用户手动点击 [恢复] 发起严格单次探测请求
   * @param probeFn 单次探测函数
   * @returns 探测是否成功
   */
  async manualProbe(probeFn: () => Promise<boolean>): Promise<boolean> {
    if (this.state !== 'PAUSED') {
      return true;
    }
    if (this.isProbing) {
      return false; // 防止重复并发点击
    }

    this.isProbing = true;
    try {
      console.log('[xhs-live-filter] Executing exactly one manual probe...');
      const success = await probeFn();
      if (success) {
        this.state = 'RUNNING';
        console.log('[xhs-live-filter] Probe succeeded. System restored to RUNNING.');
        this.callbacks.onStateChange(this.state);
        return true;
      } else {
        console.warn('[xhs-live-filter] Probe returned false. Remaining in PAUSED state.');
        return false;
      }
    } catch (err) {
      console.warn('[xhs-live-filter] Probe failed or still limited. Remaining in PAUSED state:', err);
      return false;
    } finally {
      this.isProbing = false;
    }
  }

  reset(): void {
    this.state = 'RUNNING';
    this.isProbing = false;
    this.callbacks.onStateChange(this.state);
  }
}
