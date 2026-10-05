/**
 * 内容子串匹配与领域评估
 */

/**
 * 执行普通子串匹配（大小写不敏感，无 NLP，无模糊搜索）
 * @param keyword 用户输入的关键词
 * @param title 直播标题
 * @param nickname 主播昵称
 * @returns 是否命中关键词
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
