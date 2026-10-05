/**
 * 主播事实（Facts）领域模型
 * 遵循 ADR-0006：主播事实与用户过滤策略彻底解耦
 */

export type NormalizedGender = 'female' | 'male' | 'unknown';

export interface NormalizedFacts {
  userId?: string;
  /** 平台原始性别代码（保留原始观察，不丢失信息） */
  rawGender?: number | string;
  /** 归一化性别标签，在未校准（UNCALIBRATED）状态下始终为 unknown */
  gender: NormalizedGender;
  /** 粗粒度 IP 属地标签（境内省/自治区/直辖市级，境外国家/地区级） */
  region: string | 'unknown';
  /** 年龄字段（在公开 profile 中不可靠，始终为 unknown） */
  age: 'unknown';
  /** 是否成功完成数据增强 */
  enriched: boolean;
}

export function createUnknownFacts(userId?: string): NormalizedFacts {
  return {
    userId,
    rawGender: undefined,
    gender: 'unknown',
    region: 'unknown',
    age: 'unknown',
    enriched: false,
  };
}
