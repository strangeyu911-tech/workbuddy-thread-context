# 会话落盘记录（jsonl）的结构说明

> SKILL.md 里字段表的完整版。需要精确解析时看这里。

## 位置

```
<数据目录>/projects/<工作区slug>/<会话id>.jsonl
```

- 数据目录：`~/.workbuddy`（国内版）或 `~/.workbuddy-ai`（国际版）。
- 工作区 slug 由工作区绝对路径变换而来：反斜杠与冒号都替换成 `-`。
  `D:\全局项目库` → `d-全局项目库`；`C:\Users\me\WorkBuddy\2026-08-15-22-57-14` → `c-Users-me-WorkBuddy-2026-08-15-22-57-14`。
- 文件名就是会话 id（UUID），与客户端里会话的 id 一致。

## 每行一条 JSON 记录

| `type` | 含义 | 备注 |
|---|---|---|
| `message` | 一条消息（`role` = `user` / `assistant`） | 正文在 `content[].text`；「消息锚点」只数这个 |
| `reasoning` | 思考过程 | `rawContent[].text` 或 `providerData.reasoning` |
| `function_call` | 一次工具调用 | 工具名在 `name`，**参数在记录顶层 `arguments`（字符串）** |
| `function_call_result` | 工具返回 | 内容在 `output[0].text` |
| `file-history-snapshot` | 文件快照 | 与上下文无关，切片时忽略 |
| `ai-title` | 自动生成的会话标题 | 可用于展示 |

## 字段对照

| 想取什么 | 路径 |
|---|---|
| 消息正文 | `content[].text` |
| 工具调用参数 | **`arguments`**（顶层，字符串） |
| 工具返回 | `output[0].text` |
| 图表/富组件产物 | `output[0].text` 是**被转义的 JSON 字符串**，先 `JSON.parse` 再读内层字段 |
| 思考 | `rawContent[].text`（其中 `type === 'reasoning_text'`）或 `providerData.reasoning` |
| 时间戳 | `timestamp`（**毫秒**，不是秒） |

## 典型记录形状（示意，非真实内容）

```jsonl
{"type":"message","role":"user","timestamp":1789629466141,"content":[{"type":"text","text":"…"}]}
{"type":"reasoning","timestamp":1789629470000,"rawContent":[{"type":"reasoning_text","text":"…"}]}
{"type":"function_call","name":"Bash","arguments":"{\"command\":\"…\"}","timestamp":1789629471000}
{"type":"function_call_result","name":"Bash","timestamp":1789629472000,"output":[{"text":"…"}]}
{"type":"message","role":"assistant","timestamp":1789629473000,"content":[{"type":"text","text":"…"}]}
```

## `role: "user"` 的记录不止一种（关键）

`type=message` 且 `role=user` 的记录里，**只有一部分是人真的说的话**。实测至少四种形态：

| 形态 | 开头长什么样 | 处理 |
|---|---|---|
| 人说的话 | `<system-reminder data-role="user-context">…` 包裹，**末尾**追加 `<user_query>真话</user_query>` | 抽 `<user_query>` 的**最后一组**，即真话 |
| 对话摘要 | `<cb_summary>` / `<conversation_history_summary>` | **整条丢弃**（见下） |
| 其余注入块 | `<system-reminder …>` / `<additional_data>` / `<identity_context>` / `<user_info>`，且无 `<user_query>` | 丢弃 |
| 系统通知 | `<task-notification>` / `<user-prompt-submit-hook>`（经 `<user_query>` 投递） | 保留但**标成 `notice`**，别当成「人说的」 |

三条踩过的坑：

1. **摘要记录必须先丢**。`<cb_summary>` 的正文里引用了 `<user_query>` 字样，若直接跑正则，匹配会**横跨整个摘要**，产出一段没有意义的「锚点」（实测一次 3 条）。
2. **取最后一组而不是第一组** `<user_query>`。注入块里可能出现同名的空标签对，取第一组会让这条真实消息被整条丢掉（实测丢过 7 条）。
3. **抽 `<user_query>` 要排在「判注入块前缀」前面** —— 注入块与真话可能落在同一条记录里，先判前缀会连真话一起丢。

划词引用会在真话里塞包装：`@selection:"…"` 与 `<selection_quote …>…</selection_quote>`。**只剥包装和属性，引文正文要留**。

## 解析时的坑

- **坏行要跳过**：会话进行中追加写，最后一行可能被读成半截 JSON。逐行 `try/catch`。
- **不要用 `content` 找工具参数**：参数不在 `content` 里，只在 `arguments`。
- **不要用 `timestamp` 直接当秒**：它是毫秒；跨端对时间戳做比较前先确认单位。
- **时间戳是 UTC 毫秒，展示要转本地时区**。直接用 `toISOString()` 渲染会给出 UTC 时刻 —— 在国内会与实际墙上钟差 8 小时，按「MM-DD HH:MM」回查锚点就会选错点。
- **同目录还有兄弟文件**：`<会话id>.file-rollback.ndjson` 等。注意 **`.ndjson` 并不以 `.jsonl` 结尾**，按后缀过滤时它会被排除；但若按「文件名包含 id」来匹配，就会挑错文件（实测踩过一次：只读到 6 条记录）。匹配规则一律用 `includes(id) && endsWith('.jsonl')`。
- **文件是追加的**：同一会话几分钟内条数会变。要做一致性判断就先记下 mtime 与行数。
