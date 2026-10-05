# 0006. 平台归一化客观事实与用户动态过滤策略彻底解耦

## 决策背景与核心决定

最初设计中容易将具体的过滤条件（如“排除男性”、“28–36 岁”、“广东优先”）误写为系统的底层领域规则与硬编码常量。这会导致数据采集、缓存和评估逻辑强耦合，无法支持用户在界面上动态调整偏好，且容易造成语义混乱。

我们决定在系统架构中将**平台归一化客观事实（Normalized Facts）**与**用户过滤策略（Active Filter Policy）**进行彻底解耦：
1. **Normalized Facts（客观事实）**：仅描述中立的现实观测数据（如 `gender = male`、`age = 30`、`region = '广东'`），绝不预设好恶，不包含任何“排除/合格/加分”倾向。性别校准（Calibration）仅负责代码到 normalized gender label 枚举的解析，不决定是否排除。
2. **Active Filter Policy（过滤策略）**：完全独立的数据结构，承载用户的当前意志（`allowedGenders`、`ageRange`、`preferredRegions` 等），初始偏好仅作为 `Default Policy` 存在。
3. **Evaluation（计算层）**：由 `Evaluate(Facts, Policy)` 纯函数组合计算出 `Qualification State` 与 `Derived Priority`。任何一个事实（如 `male`）本身都不等于 `EXCLUDED`，只有当它违反当前 Policy 时才在决策中产生硬排除。

## 权衡与考量 (Trade-offs)

放弃了“在解析数据时顺便打上业务标签”的快捷实现，换取了主播画像缓存的纯净性（画像数据可长期安全缓存 24h，不因用户临时切换过滤偏好而失效），并从底层支撑了可配置过滤面板（Filter Panel）的实时自由编辑。
