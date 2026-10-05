# 0005. 解耦就地内容视图过滤与主播资格评级

## 决策背景与核心决定

用户提出了对直播标题与主播昵称进行关键词过滤的需求（如只看“艺术”相关直播）。但直播标题是单次开播的临时内容（单场次易失性属性），而主播资格（Qualification: TARGET / CANDIDATE / EXCLUDED）是基于主播主页画像（性别、地域、年龄）的持久化评估结果。

若将标题关键词直接映射为 `EXCLUDED` 或 `TARGET`，将造成一次标题的不匹配永久污染主播的资格状态与跨会话缓存。

我们决定将内容过滤完全定义为与主播资格解耦的**正交视图过滤器（Orthogonal View Filter）**：
- **Content Match** 仅输出 `OFF` / `MATCH` / `NO_MATCH` 三态，完全基于卡片当前已公开的标题与昵称做零网络开销的本地包含匹配；
- 关键词未命中（`NO_MATCH`）仅在当前视口呈现层（Presentation Layer）做视图级隐藏或折叠，清空关键词即可瞬时复原，**绝对不修改主播本身的 Qualification State，不影响 Profile 缓存**；
- 最终卡片视觉呈现由 `(Qualification State, Region Priority, Content Match, View Options)` 正交组合计算。

## 权衡与考量 (Trade-offs)

放弃了“通过关键词直接一票否决主播”的粗暴做法，换取了主播资格与会话缓存的绝对稳定性，保证关键词可以在 UI 上随时自由变更、重置而无需重新触发 Profile 抓取与评估。
