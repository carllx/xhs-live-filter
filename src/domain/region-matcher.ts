/**
 * 属地规范匹配算法
 * 遵循原则：
 * 1. 展示属地与筛选属地彻底解耦：展示属地为原汁原味公开事实（如“广东广州”），筛选属地支持省级规范匹配。
 * 2. 匹配规则：若 preferredRegion 为“广东”，且主播事实属地以“广东”开头（或省份规范名），则匹配成功；
 * 3. 严格排斥同字不同省（如“广东”不得匹配“广西”）。
 * 4. 其它省份同理：如“贵州”匹配“贵州贵阳”，排斥非贵州属地。
 */

// 中国省级行政区规范简称/前缀列表
export const PROVINCES_MAP: Record<string, string[]> = {
  广东: ['广东', '广东省', '粤'],
  广西: ['广西', '广西壮族自治区', '桂'],
  北京: ['北京', '北京市', '京'],
  上海: ['上海', '上海市', '沪'],
  天津: ['天津', '天津市', '津'],
  重庆: ['重庆', '重庆市', '渝'],
  河北: ['河北', '河北省', '冀'],
  山西: ['山西', '山西省', '晋'],
  辽宁: ['辽宁', '辽宁省', '辽'],
  吉林: ['吉林', '吉林省', '吉'],
  黑龙江: ['黑龙江', '黑龙江省', '黑'],
  江苏: ['江苏', '江苏省', '苏'],
  浙江: ['浙江', '浙江省', '浙'],
  安徽: ['安徽', '安徽省', '皖'],
  福建: ['福建', '福建省', '闽'],
  江西: ['江西', '江西省', '赣'],
  山东: ['山东', '山东省', '鲁'],
  河南: ['河南', '河南省', '豫'],
  湖北: ['湖北', '湖北省', '鄂'],
  湖南: ['湖南', '湖南省', '湘'],
  海南: ['海南', '海南省', '琼'],
  四川: ['四川', '四川省', '川', '蜀'],
  贵州: ['贵州', '贵州省', '黔', '贵'],
  云南: ['云南', '云南省', '滇', '云'],
  陕西: ['陕西', '陕西省', '陕', '秦'],
  甘肃: ['甘肃', '甘肃省', '甘', '陇'],
  青海: ['青海', '青海省', '青'],
  台湾: ['台湾', '台湾省', '台'],
  内蒙古: ['内蒙古', '内蒙古自治区', '蒙'],
  西藏: ['西藏', '西藏自治区', '藏'],
  宁夏: ['宁夏', '宁夏回族自治区', '宁'],
  新疆: ['新疆', '新疆维吾尔自治区', '新'],
  香港: ['香港', '香港特别行政区', '港'],
  澳门: ['澳门', '澳门特别行政区', '澳'],
};

/**
 * 校验主播事实属地是否匹配某个用户偏好属地项
 * @param preferred 单个偏好属地（如“广东”、“上海”、“贵州”）
 * @param factRegion 主播公开事实属地（如“广东广州”、“贵州贵阳”、“上海市浦东新区”）
 */
export function matchSingleRegion(preferred: string, factRegion: string): boolean {
  const normPref = preferred.trim();
  const normFact = factRegion.trim();
  if (!normPref || !normFact || normFact === 'unknown') {
    return false;
  }

  // 1. 完全相同
  if (normPref === normFact) {
    return true;
  }

  // 2. 检查 preferred 是否对应已知省级行政区
  let matchedProvinceKey: string | undefined;
  for (const [key, aliases] of Object.entries(PROVINCES_MAP)) {
    if (key === normPref || aliases.includes(normPref)) {
      matchedProvinceKey = key;
      break;
    }
  }

  if (matchedProvinceKey) {
    // 获取该省所有别名/前缀
    const validPrefixes = PROVINCES_MAP[matchedProvinceKey];
    // 检查 factRegion 是否以该省的前缀开头
    const startsWithProvince = validPrefixes.some((prefix) => normFact.startsWith(prefix));
    if (startsWithProvince) {
      // 保护防混淆：例如“广”不能同时匹配“广东”和“广西”
      // 如果偏好是“广东”，而事实属地以“广西”开头，则严格不匹配
      for (const [otherKey, otherAliases] of Object.entries(PROVINCES_MAP)) {
        if (otherKey !== matchedProvinceKey) {
          if (otherAliases.some((alias) => normFact.startsWith(alias) && alias.length >= 2)) {
            // 命中了另一个省份的全名/前缀（例如“广西”），且该前缀与当前省不属于同一省
            if (!validPrefixes.some((p) => p.length >= 2 && normFact.startsWith(p))) {
              return false;
            }
          }
        }
      }
      return true;
    }
  }

  // 3. 通用子串前缀匹配（如用户输入自定义城市或国家）：
  // 如果 factRegion 以 normPref 开头，例如“广州”匹配“广州天河”
  if (normFact.startsWith(normPref)) {
    return true;
  }

  // 如果 preferred 包含在 factRegion 中（如用户输入“海珠”，fact 为“广东广州海珠”）
  if (normFact.includes(normPref)) {
    return true;
  }

  return false;
}

/**
 * 评估主播属地是否满足用户属地偏好列表
 * @param preferredRegions 用户设置的属地列表
 * @param factRegion 主播事实属地
 */
export function matchPreferredRegions(preferredRegions: string[], factRegion: string): boolean {
  if (preferredRegions.length === 0) {
    return true; // 不限属地
  }
  if (!factRegion || factRegion === 'unknown') {
    return false;
  }
  return preferredRegions.some((pref) => matchSingleRegion(pref, factRegion));
}
