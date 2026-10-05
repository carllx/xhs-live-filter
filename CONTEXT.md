# xhs-live-filter Domain Context

小红书 PC Web 网页端直播聚焦与互动发现增强脚本。在页面已有直播候选卡片集合中，通过画像事实归一化、用户动态过滤策略与就地内容匹配，帮助用户优先聚焦更适合互动的目标主播。

## Architecture & Data Pipeline

```text
Raw Platform Data (SSR HTML / Live Card DOM)
                      ↓
Normalized Facts (客观事实，绝不含倾向或排除判定)
  ├── Live Card Facts:  title, nickname, roomId
  └── Anchor Facts:     gender (female|male|unknown), age (number|unknown), region (string|unknown)
                      ↓
Active Filter Policy (用户可调策略配置，含 Default Policy)
  ├── contentKeyword:   string (空即 OFF)
  ├── allowedGenders:   ['female', 'unknown']
  ├── ageRange:         { min: 28, max: 36, failOpenOnUnavailable: true }
  ├── preferredRegions: ['广东'] (依序派生优先级)
  └── displayOptions:   { hideExcluded: boolean }
                      ↓
Evaluation (纯函数计算决策)
  ├── Content Match:       OFF | MATCH | NO_MATCH (正交视图匹配)
  ├── Qualification State: TARGET | CANDIDATE | EXCLUDED (硬门禁判定与偏好派生)
  └── Derived Priority:    数值 (由 Policy 偏好顺序派生，> 0 为 TARGET)
                      ↓
Presentation Layer (最终卡片视觉呈现与 UI 状态同步)
```

---

## Language

### 1. 实体与客观事实（Facts）

**Anchor (主播)**:
小红书直播间的主持人/创作者，对应一个唯一的 userId。
_Avoid_: 播主, UP主, 房主

**Live Card (直播卡片)**:
小红书网页端渲染的直播展示单元（如 `/livelist` 或搜索混排流中），承载封面、标题、主播昵称及直播间链接。
_Avoid_: 视频块, 列表项

**Normalized Facts (归一化客观事实)**:
从平台数据中无损清洗出的客观事实集合，完全中立，不包含任何“排除/合格/加分”倾向：
- `gender`: `female` | `male` | `unknown`（经校准后解析出的 normalized gender label，未校准时一律为 `unknown`）；
- `age`: `number` | `unknown`（当前平台公开数据不可靠时恒为 `unknown`）；
- `region`: `string` | `unknown`（如“广东”、“上海”、“日本”；表示平台公开的粗粒度 IP-location label，境内为省/直辖市/自治区级，境外为国家/地区级，非精确城市、非物理位置或 GPS）；
- `title`: `string`（直播标题）；
- `nickname`: `string`（主播昵称）。
_Avoid_: 过滤字段, 主播画像

**Gender Calibration (性别码校准)**:
仅负责解析平台底层原始代码（`rawGender: 0/1/2`）所对应的 normalized gender label（`female | male | unknown`）。校准只解释平台字段枚举含义，不对用户真实生理属性做推断，也**绝不决定“是否允许该性别”**。
_Avoid_: 性别过滤, 性别偏好

---

### 2. 策略模型（Filter Policy）

**Filter Policy (过滤策略)**:
独立于平台事实的用户可配置策略对象。包含：
- **`allowedGenders`**: 允许保留的性别集合；
- **`ageRange`**: 允许保留的年龄区间；
- **`preferredRegions`**: 偏好地域有序列表（顺序直接决定派生优先级）；
- **`contentKeyword`**: 当前视图关键词过滤词；
- **`displayOptions`**: 界面显隐控制选项。
_Avoid_: 业务常量, 过滤硬规则

**Default Filter Policy (默认策略)**:
v0.1 系统出厂预设的策略配置（`allowedGenders: ['female', 'unknown']`, `ageRange: [28, 36] (fail-open)`, `preferredRegions: ['广东']`, `contentKeyword: ''`）。这些是策略默认值，不是不可变的领域规则。
_Avoid_: 系统规则, 核心逻辑

---

### 3. 评估决策（Evaluation）

**Qualification State (资格状态)**:
针对主播画像事实应用当前 Policy 后的评级结果：
- **EXCLUDED**: 主播事实命中了当前 Policy 的 Hard Exclusion（例如：事实性别为男性，且当前 Policy 不允许男性；或事实年龄确凿超出当前 Policy 范围）；
- **TARGET**: 主播未被排除，且 Derived Region Priority > 0（即命中 preferredRegions 中任意一项；列表顺序仅决定 TARGET 内部的派生优先级高低）；
- **CANDIDATE**: 主播未被排除，且 Derived Region Priority == 0（未命中 preferredRegions 中的任何项，如其他地区或未知）。
_Avoid_: 准入状态, 过滤结果

**Content Match (内容匹配状态)**:
完全独立于主播资格（Qualification）的正交视图状态。仅基于当前卡片事实中的 `title` 与 `nickname` 针对当前 Policy 的 `contentKeyword` 做本地文本包含匹配：
- **OFF**: 当前 Policy 关键词为空；
- **MATCH**: 标题或昵称包含关键词；
- **NO_MATCH**: 标题和昵称均未包含关键词。
_Avoid_: 标题合格, 关键词排除

**Fail-Open (故障安全放行)**:
当某项事实数据未校准、缺失、未公开或不可靠时（如当前年龄数据），系统策略必须默认不排除、继续保留进入候选池，严禁假装已匹配。
_Avoid_: 默认通过, 空值跳过

---

### 4. 交互与控制（UI Surface）

**Filter Surface (过滤控制面)**:
- **Collapsed Capsule (收起胶囊)**: 右下角常驻，展示当前 Policy 应用后的实时评估统计；
- **Expandable Filter Panel (展开面板)**: 承载并编辑当前 Active Filter Policy；
- **Disabled State Truth**: 针对目前平台事实无法可靠获取的能力（如年龄），UI 必须显式呈现为 `disabled / unavailable`，严禁伪造可用假象。

**Presentation (最终视觉呈现)**:
由 `(Qualification State, Content Match, Display Options)` 正交组合计算：
- `NO_MATCH` 且关键词激活：在当前视图中隐藏或折叠；
- `EXCLUDED`: 保持原有几何尺寸，极度灰度弱化（用户勾选隐藏已排除时方折叠）；
- `TARGET`: 边框高亮 + 事实徽标（如 `🎯 广东 · 女`）；
- `CANDIDATE`: 原生外观，轻度降权。

---

### 5. 能力真实性原则（Capability Truth）

**Capability Truth (能力边界真实性)**:
Filter Policy 可以表达的配置项与颗粒度，不得超出当前已验证事实源实际支持的精度与真实性：
- 当前唯一已验证的地域来源为公开 profile 的 `ipLocation`，仅支持省级/国家级 coarse IP label，不支持城市级（如“广州”“深圳”）。因此 v0.1 Policy 默认仅设为 `['广东']`，严禁通过 IP、昵称、简介等间接信号脑补猜测城市。未来只有在独立验证出公开可靠的城市级事实源后，才允许扩展加入城市级选项；
- 若某项能力在当前平台事实源不可靠或不可得（如年龄），UI 必须显式置灰（Disabled / Unavailable），Evaluation 严禁任何主观推断并严格执行 Fail-Open，不制造假象。
