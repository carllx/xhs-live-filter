/**
 * 本地存储适配器
 * 优先使用 GM_getValue / GM_setValue，回退至 localStorage
 */

declare function GM_getValue<T>(key: string, defaultValue?: T): T;
declare function GM_setValue<T>(key: string, value: T): void;

export class StorageAdapter {
  private static isGMSupported(): boolean {
    return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  }

  static get<T>(key: string, defaultValue: T): T {
    try {
      if (this.isGMSupported()) {
        return GM_getValue(key, defaultValue);
      }
      const raw = localStorage.getItem(`xhs_filter_${key}`);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
    } catch (e) {
      console.warn(`[xhs-live-filter] Read storage key '${key}' failed:`, e);
    }
    return defaultValue;
  }

  static set<T>(key: string, value: T): void {
    try {
      if (this.isGMSupported()) {
        GM_setValue(key, value);
        return;
      }
      localStorage.setItem(`xhs_filter_${key}`, JSON.stringify(value));
    } catch (e) {
      console.warn(`[xhs-live-filter] Write storage key '${key}' failed:`, e);
    }
  }

  static remove(key: string): void {
    try {
      if (this.isGMSupported()) {
        GM_setValue(key, null);
        return;
      }
      localStorage.removeItem(`xhs_filter_${key}`);
    } catch (e) {
      console.warn(`[xhs-live-filter] Remove storage key '${key}' failed:`, e);
    }
  }
}
