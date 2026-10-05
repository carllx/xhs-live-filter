/**
 * 内容子串匹配与领域评估
 * 严格遵循既定领域状态：TARGET, CANDIDATE, EXCLUDED
 * 遵循 ADR-0002 与 ADR-0006：事实与策略解耦，属地偏好只决定优先级，不产生硬排除
 */

import { NormalizedFacts } from './facts';
import { V01Policy } from './policy';

export type QualificationStatus = 'TARGET' | 'CANDIDATE' | 'EXCLUDED';

export interface EvaluationResult {
  status: QualificationStatus;
  regionPriority: number;
  reason?: string;
}

/**
 * 执行普通子串匹配（大小写不敏感，无 NLP，无模糊搜索）
 */
export function matchContent(keyword: string, title: string, nickname: string): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return true;
  }
  const targetTitle = (title || '').toLowerCase();
  const targetNickname = (nickname || '').toLowerCase();
  return targetTitle.includes(normalizedKeyword) || targetNickname.includes(normalizedKeyword);
}

/**
 * 纯函数评估：根据当前 Facts 和 Active Filter Policy 判定状态
 */
export function evaluate(facts: NormalizedFacts, policy: V01Policy): EvaluationResult {
  // 1. 资格检查：仅当 normalized gender 已知且不在允许列表中时，才判定为 EXCLUDED
  // unknown 严格 Fail-Open（不排除）
  if (facts.gender !== 'unknown' && !policy.allowedGenders.includes(facts.gender)) {
    return {
      status: 'EXCLUDED',
      regionPriority: 0,
      reason: `性别不匹配 (${facts.gender})`,
    };
  }

  // 2. 属地优先级计算（遵循 ADR-0002：属地不符绝不产生硬排除）
  let regionPriority = 0;
  if (facts.region !== 'unknown' && policy.preferredRegions.includes(facts.region)) {
    regionPriority = 1;
  }

  if (regionPriority > 0) {
    return {
      status: 'TARGET',
      regionPriority,
    };
  }

  return {
    status: 'CANDIDATE',
    regionPriority: 0,
  };
}
