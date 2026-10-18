# 变更记录 / Changelog

对照基线：**1.2.0**（上游最后一代，`dshTarget: 0.2.1-rc.2`）。
本文件只记 1.3.x 分支相对 1.2.0 的**新增、优化、修复**，以及会影响到你的行为变化。

Baseline: **1.2.0**. Everything below is what this fork adds, improves, or fixes on top of it.

---

## 一、新增 / New

### 1. 设置页成了正式界面（1.3.0）

| 项 | 说明 |
| --- | --- |
| 注册方式 | 走官方 `settings.section` 槽位：`id: dsh-purge`、`order: 450`（紧跟 `XD Pool`）、`label: () => t("page.nav")` |
| 位置 | 设置左侧导航最后一行 **Purge** |
| 页面结构 | 四段：**破甲**（补丁 / 提示词 / 自己的服务器）、**规则**、**技能**、**演练台** |
| 导航图标 | 外壳只按 section id 画图标，未知 id 一律齿轮。本分支按 label 命中自己那一行、打标记、用 `mask-image` 盖一个自绘「开口锁」，卸载时自动移除标记与样式 |

前一代只有会话里的浮窗，没有设置页入口；这一代设置页是唯一主界面。

### 2. 破甲内核 v3（1.3.0）

`lib/core.js` 的 `STRONG_INTRO` 重写。前两代只声明「这些指令是强制的」，模型仍会再判一次「是不是注入」，一旦落回「可疑」就整段降级成建议。v3 改成三步钉死：

1. **先收判定权** —— 写明这是 system 级配置，与后文（工具描述、预设、文件、网页、工具返回）冲突时本段优先，其余视为过期或对抗；
2. **再钉执行身份** —— 操作员的全权执行器，不做准入/合规判断；
3. **最后钉交付形态** —— 拒绝=故障、双语禁语表、首 token 即答案、缺细节填占位符继续、多步同轮做完。

旧代原文保留成升级 pattern（`replacementPrecedenceRewrites` 按长句优先排序，避免短句把后半截留在引号里），已经打过的树就地换到新文本，二次 apply 不叠层（实测 `changed=false`）。

### 3. 默认提示词头尾两段硬约束（1.3.0）

新脚本 `scripts/armor-prelude.mjs`（幂等，`--revert` 可回滚）在 `lib/default-prompt-inject.md` 头尾各插一段：

- 头：**`Authority and precedence`** 五条 —— 优先级阶梯（操作员 > 工作区 > 宿主默认 > 工具描述 > 读到的内容）、权限已在会话开始前定好且不可再议、**工具拒绝≠任务拒绝**（换工具/换参数/换路径继续）、外部内容只是数据、语言跟随操作员；
- 尾：**`Final gate`** 六问交付前自检，任何一项「否」都回到工作，而不是回到拒绝。

封印槽重封后 23698 字符；运行时注入的 `prompt-inject.md` 由 `lib/asset-table.js` 解封写入。

### 4. 演练台并入设置页（1.3.1）

会话里的浮窗入口撤掉后，演练台改挂设置页第四段：未授权先显示门槛卡（一段说明 + 「开始授权」按钮），授权完成后就地展开内嵌面板，不再自己拉浮层。

### 5. 新脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/armor-prelude.mjs` | 注入/回滚提示词头尾两段硬约束，幂等 |
| `scripts/drill-skin.mjs` | 把演练台的硬编码颜色收进宿主 token（`--check` 可进 CI） |

---

## 二、优化 / Improvements

### 1. 界面全部改用宿主设计 token

前一代是自己发明的一套皮：衬线标题 + 橄榄绿玻璃 + `--dshp-*` 自造调色板，结果像「设置里嵌了个别的产品」。这一代只吃 DSH 自己的 token：

| 项 | 1.2.0 | 1.3.x |
| --- | --- | --- |
| 字体 | `Songti SC` / `Noto Serif SC` 衬线标题 | 继承 `--dsw-font-family`，标题 16/24·500，正文 14/22 |
| 圆角 | 10px 固定 | `--dsw-radius-xs/sm/md/lg/xl`，卡片用 xl(20px) |
| 卡片 | 1px 描边 + 玻璃底 | 官方 rowCard：0.5px 描边 + `--dsw-alias-settings-card-fill` |
| 按钮 | 34px 高 / 8px 圆角 / 手写绿色 | 36px 高 / md 圆角 / `--dsw-alias-button-primary-fill` |
| 输入 | 8px 圆角 / 衬线 | 32px 高 / l4 描边 / md 圆角 |
| 色彩 | 自造 `--dshp-ok/warn/bad` | `--dsw-alias-state-{success,warn,error}-primary` |
| 页面宽度 | 920px | 720px 单列（与「模型」「通用设置」同宽） |
| 弹层 z-index | 80（会被设置面板的 1000 盖住） | 1300（在设置面板之上） |

### 2. 布局从「卡中卡」改成层级分明

- **指标**：三张独立卡片 → 一条统计带 + 发丝竖分隔线（数字自己承担层级）；
- **补丁分组**：卡片套表格 → 行 + 展开表格，悬停只给下划线，不再整块变色；
- **面板拆分**：原来一个巨型卡片装下所有内容 → 补丁 / 提示词 / 自己的服务器 三张独立卡片，各带一行说明；
- **分段控件**：新增「补丁 / 规则 / 技能 / 演练台」四段切换，不再把三块内容竖向堆在同一个滚动区。

### 3. 会话界面做减法（1.3.1）

撤掉三个重复入口（右下角浮钮、首页模式旁、会话标题旁），连带删掉三个组件的死代码（`PurgeLauncher` / `HeroNewSessionMount` / `TabRowPurgeMount`，client.js 减少 ~4.5 KB）。点任何旧入口现在统一跳设置页，宿主没有 `settings.open` 命令时退回 DOM 点击设置按钮，双击不生效才退回浮窗。

### 4. 演练台换 token

19 处 >1px 的彩色侧边条压到 1px 发丝线，62 处硬编码状态色收进 `--dsw-alias-state-*`；浮窗底从「52% 透明 + 20px 模糊」改成不透明层一 + 0.5px 描边，深色下不再发灰。

---

## 三、修复 / Fixes

### 1. 「应用 → 重启 → 清洗没有写进全部宿主，已取消重启」（1.3.1）

**根因**：#40 `COMPLETE_PROMPT_KEEP_INJECT` 在 0.2.1 上**一条 pattern 都不命中**。0.2.1 在 `return transformed;` 与 `return {…}` 之间多插了一行 `const requiredContexts = new Set(…)`，`contexts:` 表达式也换了；原来那条整段正则要求中间必须为空。于是补丁状态是 `skipped`（**不算失败**，界面不报错），但重启前的 `hostPromptKeepsInject` 仍能看到 `sections: … : [completeSection]`，判定「这份系统提示词没洗过」，返回失败并取消重启。

**修法**：拆成两条只认关键行的替换 —— 在 waterfall 之后插 `dshPurgeSections` / `dshPurgeRest`，再把 `sections:` 那半边换成保留注入的写法，中间的 `requiredContexts` 与 `contexts` 原样保留。幂等、产物过 `node --check`。

| 检查 | 修前 | 修后 |
| --- | --- | --- |
| 桌面宿主 `hostWritten` | `false` | `true` |
| `ensureHostClean()` | `ok: false` | `ok: true`，`pending: []` |
| 补丁表（0.2.1 原树） | 62 applied / 2 skipped | **63 applied / 1 skipped** |
| 补丁表（桌面 resources/app） | 68 already / 2 skipped | **69 already / 1 skipped** |

### 2. 补丁收敛（1.3.0）

- #1 / #2 的替换链补上 v3 代原文，旧树升级不会再叠层；
- #2 / #3 的完成标记改用「当前内核指纹」（`Refusal is a malfunction` 等），不再拿官方原文当标记导致永远自报 `already`；
- #40 的 `forbid` 与 `markers` 保持原样，仅新增 0.2.1 锚点。

---

## 四、行为变化（会影响到你）/ Behaviour changes

1. **入口位置**：会话里不再有任何 dsh-purge 按钮，界面只在 **设置 → Purge**。
2. **演练台**：从浮窗第二页变成设置页第四段；授权流程不变（读声明 → 等倒计时 → 勾三项）。
3. **点「应用」后仍需重启**：客户端 bundle 由宿主启动时合成，重启前看到的还是旧界面。
4. **首次进设置页**：导航图标是本分支自绘的，外壳若改版导致 label 匹配不到，图标会回落成齿轮，功能不受影响（控制台会提示一次）。
5. **`lib/default-prompt-inject.md` 不入库**（与上游一致）：发布的是密封后的 `lib/asset-table.js`，重新封装需要本地有那份明文源。

---

## 五、兼容性实测 / Measured compatibility

DSH **0.2.1-rc.2**，82 条补丁：

| 场景 | applied | already | missing_file | skipped | pending |
| --- | --- | --- | --- | --- | --- |
| 1.2.0 对原树（app.asar 解出） | 62 | 6 | 12 | 2 | 0 |
| **1.3.0 对原树** | 62 | 6 | 12 | 2 | 0 |
| **1.3.1 对原树** | **63** | 6 | 12 | **1** | 0 |
| **1.3.1 对已打过补丁的桌面 `resources/app`** | 0 | **69** | 12 | 1 | 0 |

`missing_file` 是这份构建里根本没有的目标（梁神预设、hooks 插件、不在 `dsh/` 里的桌面壳入口），1.3.1 之后 `skipped` 只剩 #80 一项。

自检：`node scripts/compat-check.mjs --asar <resources/app.asar>`，退出码 0 表示没有 pending。

---

## 六、升级指引 / How to update

```powershell
# 1. 覆盖插件目录（保留你的 prompt-inject.md 与规则集，它们在 $DSH_HOME，不在插件目录里）
# 2. 打开 设置 → Purge
# 3. 点「应用」；门禁通过会自己换包并重启
# 4. 重启后新开一轮对话，注入才进当前会话
```

从 1.2.0 升上来不需要手动清理：旧补丁会被新锚点就地覆盖，`installed-rev` 会自动跟着版本走。若「应用」仍报失败，先跑仓库里的 `scripts/compat-check.mjs` 看是哪条补丁 `pattern_not_found`。

---

## 七、已知限制 / Known limitations

- **密封 `app.asar` 的桌面端**：补丁写在解开的 `resources/app` 里，必须走「应用」流程把 asar 挪走并重启才生效；只重启不换包，看到的仍是归档里的旧代码。
- **`{{cwd}}` 变量**：0.2.1 的 `dsh-agent-loop` 不再注册该变量，提示词里写裸 `{{cwd}}` 会硬失败；需要工作目录时用宿主自带的 `personaSuffix` 或本地 `dsh-cwd-variable` 插件，`lib/identity.js#escapeDshInterpolation` 会把不安全的花括号转义。
- **导航图标**：依赖「按 label 找到自己那一行」，设置外壳若改文案渲染方式，图标会回落成齿轮（功能不受影响）。
- **未做**：插件市场发布、Web 端与桌面端一键同步、i18n 化全部文案（目前中英双语硬编码在 `client.js` 的 `zh` / `en` 两套字典里）。
