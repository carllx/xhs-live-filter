/**
 * 性别校准门禁 (Gender Calibration Gate)
 * 严格遵循 ADR-0003：平台原始枚举值与推断解耦，Fail-Open 优先
 * UNCALIBRATED 是合法可发布状态；未校准时一律推断为 unknown；禁止凭空臆断
 */

import { NormalizedGender } from './facts';

export type CalibrationStatus = 'UNCALIBRATED' | 'CALIBRATED';

export class GenderCalibrationGate {
  private status: CalibrationStatus = 'UNCALIBRATED';
  private mapping: Map<string, NormalizedGender> = new Map();

  constructor(status: CalibrationStatus = 'UNCALIBRATED', mapping?: Record<string | number, NormalizedGender>) {
    this.status = status;
    if (mapping) {
      for (const [code, val] of Object.entries(mapping)) {
        this.mapping.set(String(code), val);
      }
    }
  }

  getStatus(): CalibrationStatus {
    return this.status;
  }

  /**
   * 应用经过平台公开核验的映射证据切换至 CALIBRATED
   * @param mapping 经公开核验的映射字典
   */
  calibrate(mapping: Record<string | number, NormalizedGender>): void {
    this.mapping.clear();
    for (const [code, val] of Object.entries(mapping)) {
      this.mapping.set(String(code), val);
    }
    this.status = 'CALIBRATED';
  }

  resetToUncalibrated(): void {
    this.status = 'UNCALIBRATED';
    this.mapping.clear();
  }

  /**
   * 将原始性别代码归一化为领域性别事实
   * 在 UNCALIBRATED 状态下，严格返回 'unknown'，Fail-Open
   */
  normalize(rawGender?: number | string): NormalizedGender {
    if (this.status !== 'CALIBRATED' || rawGender === undefined || rawGender === null) {
      return 'unknown';
    }

    const key = String(rawGender);
    if (this.mapping.has(key)) {
      return this.mapping.get(key)!;
    }

    return 'unknown';
  }
}
