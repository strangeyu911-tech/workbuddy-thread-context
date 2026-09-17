---
name: workbuddy-thread-context
display_name: 会话分支（跨线程上下文）
display_name_en: Thread Branch
description: 在会话之间搬运上下文。当用户贴会话 ID 问「你能找到另一个会话吗」，或说「接着上次那个话题」「趁上次讨论到的那里继续」「只带其中一段过来」「像 Codex 那样从某条消息分叉」时使用。核心是读本机会话落盘记录，按 ID 读、按关键词反查、按消息锚点切片分叉。
description_zh: 把另一个会话的上下文搬进当前会话，支持按消息锚点「分叉」——只带某条消息之前的历史，之后的不带，对标 Codex 桌面版的 Fork。
description_en: Bring another WorkBuddy thread context into the current session, and fork it at any message anchor - keep the history up to that message and drop the rest.
category: productivity
version: 1.1.0
author: Strange
allowed-tools: Bash,Read
---

# 会话分支（跨线程上下文）

**触发**：用户在新会话里要求回忆另一个会话的内容，或要求「只带其中一段过来继续」（对标 Codex 桌面版的 Fork）。

**先说结论，别浪费时间试错**：

| 手段 | 可用性 |
|---|---|
| 平台内置跨会话检索 | ❌ 实测常返回 0，别据它下「历史里没有」的结论 |
| 用 traceId / conversationId 调某个工具 | ❌ 不存在这种工具。这两个值是遥测标识 |
| **直接读本机会话落盘记录** | ✅ **唯一可靠路径**，见下 |
| WorkBuddy 原生 fork / 分支按钮 | ❌ 没有。等价实现 = **锚点切片 + 交接稿**（下节） |

## 存储位置与结构

```
<WorkBuddy 数据目录>/projects/<工作区slug>/<会话id>.jsonl
```

- 数据目录默认 `~/.workbuddy`（国内版）或 `~/.workbuddy-ai`（国际版）；可用 `--home` 或环境变量 `WB_HOME` 指定。
- `<工作区slug>` = 工作区路径把 `\`、`:` 换成 `-`，例如 `D:\myproj` → `d-myproj`。
- 同一工作区目录里有历史会话文件**和当前 session 文件**（都是 `<uuid>.jsonl`）。判断哪个是目标：看修改时间、条数、以及文件里有没有目标关键词。
- 每行一条记录：`type ∈ message | reasoning | function_call | function_call_result | file-history-snapshot | ai-title`

### 取字段的坑（踩过）

| 想拿什么 | 在哪 |
|---|---|
| 用户消息 / 助手回复正文 | `content[].text` |
| **工具调用参数** | 记录顶层 **`arguments`**（字符串），**不在 `content` 里** |
| 工具返回结果 | `output[0].text` |
| 图表类工具的产物 | `output[0].text` 是转义 JSON，先 `JSON.parse` 再取内层字段 |
| 思考过程 | `rawContent[].text`（`reasoning_text`）或 `providerData.reasoning` |
| 时间 | `timestamp`（**毫秒**） |

需要精确解析记录结构时，读 @references/session-record-layout.md（记录类型、字段对照、坑）。

## 工具

脚本随本技能一起分发，用 Node 直接跑：

```bash
S="<本技能目录>/scripts/thread.mjs"      # 技能安装目录下
node "$S" --help
```

### 1）先认会话

```bash
node "$S" --list --days 7                        # 近 7 天有哪些会话
node "$S" --search "关键词" --days 3 --limit 5    # 没 ID 时：关键词反查是哪个会话、哪个时间点
node "$S" --id <id> --tail 20                     # 有 ID：先看它最后在聊什么
```

### 2）再选「分叉点」（= Codex 每条消息旁的分叉图标）

```bash
node "$S" --id <id> --points --max 60
```

输出形如 `#  7 | 09-17 16:34 | assistant | 这张图最关键的信息是……（56 字）`。
锚点三类：`user`（人说的）、`assistant`、`notice`（宿主投递的后台任务通知/hook 回执，**不是人说的**）。
时间一律是**本地时间**（不是 UTC）。工具调用与 harness 注入块已剥掉：user 消息先抽 `<user_query>` 里的真话（取**最后一组**）、再按前缀判注入块，最后剥掉 `@selection:"…"` / `<selection_quote>` 包装。
**摘要类记录（`<cb_summary>` / `<conversation_history_summary>`）整条丢弃**——它们内部引用了 `<user_query>` 字样，不丢会让正则横跨整个摘要乱匹配。

想拿机器可读的锚点（给界面用）：

```bash
node "$S" --id <id> --points --json --slim --max 300 --text 46
# → {"s":{会话},"r":[同级会话],"a":[[n,"MM-DD HH:MM",角色码,字数,摘要]],"t":截断数}
#    角色码 0=user 1=assistant 2=notice；--slim 比对象形式小 ~45%
```

### 3）分叉导出交接稿

```bash
node "$S" --id <id> --until 7 --export                  # 只带 #1–#7（忘掉后半段无效对话）
node "$S" --id <id> --from 10 --to 11 --export           # 只要中间这一段
node "$S" --id <id> --until "09-17 15:30" --export       # 也可按本地时间点分叉
node "$S" --id <id> --export                             # 不带范围 = 整条会话摘要式交接
```

- 默认落到 `~/.workbuddy/branches/<id8>-n<a>-<b>.md`，`--out 路径` 可指定。
- 交接稿 = 元信息（来源会话、分支范围、分叉语义、未纳入条数）+ 范围内每条消息正文；每条 assistant 消息下面用折叠块附「期间的工具调用」摘要，需要细节时不丢信息。
- `--no-noise` 去掉工具折叠块，`--exportWidth N` 调每条截断长度（默认 1200 字，超出保留头尾）。
- 写完用 Read 读进当前会话 = 从该点继续。**原会话不受影响**（与 Codex Fork 语义一致：只 fork 会话，不动源）。

## 分叉选择器：把「选分叉点」变成能点的界面（推荐入口）

别每次都让用户看编号报数字。跑一次生成器，把锚点清单渲染成**对话内的可点面板**：

```bash
P="<本技能目录>/scripts/picker.mjs"
node "$P" --id <id> --out "<临时目录>/picker.html" --only user,notice
```

然后按三步走：

1. **Read 那个 HTML**，把内容**原样**作为 `widget_code` 传给可视化渲染工具，标题用「会话分叉选择器」。不要改里面的 CSS/JS——它是自包含的。
2. 用户在面板上点一条消息、按「导出分支交接稿」，面板会回传一句**确定的指令**，形如
   `分叉会话 318118d1： --until 13 --export（保留 #1 → #13）`
   面板的「换会话」按钮回传的是 `渲染会话 <id8> 的分叉选择器`；「显示全部 ↗」回传的是重渲染且带助手锚点。
3. 收到这类指令**照字面执行**第 3 节的 CLI，再把交接稿路径 + 「新会话里怎么续上」一并回给用户。

面板内容：三种模式（保留到此 / 只要之后 / 取区间）、按内容过滤、只看我发的、换会话（同级最近 5 个）、显示全部锚点。默认「保留到此」= 只带该点之前的历史，与 Codex Fork 语义一致。

**为什么必须内联整段 HTML**：widget 读不到外部文件，HTML 只能整段传给渲染工具 —— 所以每次渲染约 9KB，这是本方案唯一的成本。用 `--only user,notice` 收窄体积（默认面板 ~16 个锚点 → 9KB；不加则 ~117 个 → 15KB）。助手回复锚点交给「显示全部 ↗」触发重渲染时再装。

**离线也能用**：这份 HTML 直接用浏览器打开也行。此时没有 `sendPrompt`，面板会把该跑的指令显示出来让人手动复制 —— 所以拿着它在哪里都能分叉。

## 与 Codex 桌面版的功能对照

| Codex | 本方案 |
|---|---|
| Fork（从某条消息起新会话，之后的不保留） | `--until <锚点> --export` → 读交接稿；界面版见「分叉选择器」 |
| 消息旁的分叉图标 | 面板里点那一行（`picker.mjs` 渲染） |
| 「在此工作空间中创建分支」/「新工作树中创建分支」 | 只 fork 上下文；代码回滚自己 `git reset --hard`（两件事分开） |
| `/side`（继承上下文的临时岔路） | `--tail 8` 只看尾部就地讨论，不导文件 |
| `@历史会话`（自动总结交接） | `--export`（不带范围）或让模型读交接稿后自行压缩 |

## 操作顺序（推荐）

1. 有 ID → `--id`；没 ID → `--search` 关键词定位会话与时间点。
2. **优先渲染分叉选择器**（上一节），让用户点；用户明确给了编号或时间就直接跳到 3。
3. `--until` / `--from` / `--to` + `--export` → Read 交接稿 → 在新会话里继续。
4. 回话时明说来源（「靠本机落盘切片，不是平台检索」），并区分「本次只带了 #1–#7」这种边界。

## 边界与失败处理

- 只覆盖**本机、未清理**的会话；跨设备取不到。
- 会话文件是**持续追加**的（同一会话几分钟内可能从 399 条涨到 429 条），别用旧快照下结论。
- 扫描靠 `--days` 收窄，避免读几十 MB 的大文件。
- 真找不到时**别编**。给用户三条路：① 直接粘结论；② 给关键词 + 大致时间再扫；③ 平时把结论写进工作区的 `memory/YYYY-MM-DD.md`，新会话自动带上。

## 主动降低「跨会话失忆」的习惯

做完实质工作就写工作区的 `.workbuddy/memory/YYYY-MM-DD.md`（追加），跨项目固定约定写 `MEMORY.md`。**memory 是自动注入的，比事后翻 jsonl 便宜得多** —— 先写记忆，再指望检索。

## 隐私与合规

- 只读**本机文件**；不联网、不调用任何接口、不上传任何内容、不写业务数据。
- 导出的交接稿可能含敏感正文，默认落在本机 `~/.workbuddy/branches/`，请自行保管，别提交进公开仓库。

## 版本

- **1.1.0** —— 加了**分叉选择器**（`scripts/picker.mjs`）：把锚点清单渲染成对话内可点面板，点一下即分叉，不用再手敲编号。配套改动：
  - `--points --json [--slim]` 机器可读输出（`--slim` 数组化，体积小 ~45%）
  - 锚点分三类：`user` / `assistant` / **`notice`**（后台任务通知、hook 回执 —— 之前被当成「我发的」）
  - **时间全部改成本地时间**。原来用 `toISOString()` 输出 UTC，显示时刻与墙上钟差 8 小时、按 `--until "MM-DD HH:MM"` 分叉会选错点
  - **摘要类记录整条丢弃**：`<cb_summary>` / `<conversation_history_summary>` 内部引用了 `<user_query>` 字样，会让正则横跨整个摘要乱匹配，产出垃圾锚点（实测一次 3 条）
  - user 消息取**最后一组** `<user_query>`（宿主把真话追加在记录末尾；取第一组时若前面有同名空标签会整条丢，实测丢过 7 条真话）
  - 剥掉 `@selection:"…"` 与 `<selection_quote>` 包装（引文正文保留）
- **1.0.1** —— user 消息先抽 `<user_query>` 再判注入块：两者可能落在同一条记录里，原来的顺序会把这类消息整条丢掉，锚点清单因此少一截。
- **1.0.0** —— 首版。按会话 ID 读取、关键词反查、锚点分叉导出；数据目录自动探测 `.workbuddy` / `.workbuddy-ai`，可用 `--home` 或 `WB_HOME` 指定。
