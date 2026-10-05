/**
 * 用户过滤与显示策略模型
 */

export interface V01Policy {
  /** 内容关键词过滤（普通子串匹配） */
  contentKeyword: string;
  /** 偏好地域列表，默认 ['广东'] */
  preferredRegions: string[];
  /** 允许的归一化性别列表，默认 ['female', 'unknown'] */
  allowedGenders: string[];
  /** 是否隐藏被排除的卡片（默认 false，以低透明度弱化保留） */
  hideExcluded: boolean;
}

export const DEFAULT_POLICY: V01Policy = {
  contentKeyword: '',
  preferredRegions: ['广东'],
  allowedGenders: ['female', 'unknown'],
  hideExcluded: false,
};

/**
 * Ticket #2 窄范围持久化数据结构：仅包含 contentKeyword
 */
export interface LocalFocusConfig {
  contentKeyword: string;
}
