# 0002. 解耦资格硬门禁与地域偏好评估

## 决策背景与核心决定

业务需求既包含一票否决式硬约束（如排除不符性别的对象、排除超龄），又包含非门禁式的地理亲和度梯度。若将所有规则混合在单层条件分支中，将导致状态判定爆炸且不易扩展。

我们决定将主播评估逻辑拆分为两个独立计算阶段：
1. **Qualification State（资格判定）**：结合当前 Policy 仅输出 `EXCLUDED` 或 `非 EXCLUDED`。
2. **Region Priority（地域亲和度）**：量化输出优先级数值，该数值完全由当前 Policy 中的 `preferredRegions` 有序列表动态派生（如首选地最高、次选地递减、未列出地为 0）。

最终由这两个正交维度的输出派生最终状态：
- `TARGET`: 非 EXCLUDED 且 Region Priority > 0
- `CANDIDATE`: 非 EXCLUDED 且 Region Priority == 0
- `EXCLUDED`: 命中 Qualification State == EXCLUDED

## 权衡与考量 (Trade-offs)

放弃了“为每个特定地区组合创造专属硬编码状态”的做法，使资格分类器（Classifier）完全依赖强类型策略，支持用户动态修改偏好城市列表而无需重写分类器状态机。
