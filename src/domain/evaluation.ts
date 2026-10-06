/**
 * 内容子串匹配与领域评估
 * 严格遵循既定领域状态：TARGET, CANDIDATE, EXCLUDED
 * 过滤判定：visible = contentMatch AND genderMatch AND regionMatch
 */

import { NormalizedFacts } from './facts';
import { V01Policy } from './policy';

export type QualificationStatus = 'TARGET' | 'CANDIDATE' | 'EXCLUDED';

export interface EvaluationResult {
  status: QualificationStatus;
  regionPriority: number;
  genderMatch: boolean;
  regionMatch: boolean;
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
 * 纯函数评估：根据当前 Facts 和 Active Filter Policy 判定资格与可见性
 * @param facts 主播归一化事实
 * @param policy 过滤策略
 * @param isCalibrated 性别门禁是否已校准（未校准时性别筛选自动 Fail-Open 为 true）
 */
export function evaluate(
  facts: NormalizedFacts,
  policy: V01Policy,
  isCalibrated: boolean = false
): EvaluationResult {
  // 1. 性别匹配判定 (Gender Match)
  let genderMatch = true;
  if (!isCalibrated) {
    // 门禁未校准时，性别筛选能力不可用，严格 Fail-Open
    genderMatch = true;
  } else {
    // 已校准状态
    if (facts.gender === 'unknown') {
      genderMatch = policy.keepUnknownGender;
    } else {
      genderMatch = policy.allowedGenders.includes(facts.gender);
    }
  }

  // 2. 属地匹配判定 (Region Match)
  let regionMatch = true;
  const hasRegionFilter = policy.preferredRegions.length > 0;
  if (hasRegionFilter) {
    if (facts.region === 'unknown') {
      regionMatch = policy.keepUnknownRegion;
    } else {
      regionMatch = policy.preferredRegions.includes(facts.region);
    }
  }

  // 3. 综合判定状态
  if (!genderMatch || !regionMatch) {
    return {
      status: 'EXCLUDED',
      regionPriority: 0,
      genderMatch,
      regionMatch,
      reason: !genderMatch ? `性别不符 (${facts.gender})` : `属地不符 (${facts.region})`,
    };
  }

  // 命中属地筛选列表时赋予 TARGET，其余（如未知属地保留或未限属地）为 CANDIDATE
  const isTargetRegion = facts.region !== 'unknown' && policy.preferredRegions.includes(facts.region);
  if (isTargetRegion) {
    return {
      status: 'TARGET',
      regionPriority: 1,
      genderMatch,
      regionMatch,
    };
  }

  return {
    status: 'CANDIDATE',
    regionPriority: 0,
    genderMatch,
    regionMatch,
  };
}
