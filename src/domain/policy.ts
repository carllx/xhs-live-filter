/**
 * 用户过滤与显示策略模型
 */

export interface V01Policy {
  /** 内容关键词过滤（普通子串匹配） */
  contentKeyword: string;
  /** 目标属地筛选列表（为空表示不限属地），默认 ['广东'] */
  preferredRegions: string[];
  /** 保留未知属地的主播卡片（Fail-Open 开关），默认 true */
  keepUnknownRegion: boolean;
  /** 允许的归一化性别列表（仅在 CALIBRATED 时生效），默认 ['female'] */
  allowedGenders: string[];
  /** 保留未知性别的主播卡片（Fail-Open 开关），默认 true */
  keepUnknownGender: boolean;
  /** 是否隐藏被排除的卡片（保持兼容），默认 true */
  hideExcluded: boolean;
}

export const DEFAULT_POLICY: V01Policy = {
  contentKeyword: '',
  preferredRegions: ['广东'],
  keepUnknownRegion: true,
  allowedGenders: ['female'],
  keepUnknownGender: true,
  hideExcluded: true,
};
