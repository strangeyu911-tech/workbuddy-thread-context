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

## 解析时的坑

- **坏行要跳过**：会话进行中追加写，最后一行可能被读成半截 JSON。逐行 `try/catch`。
- **不要用 `content` 找工具参数**：参数不在 `content` 里，只在 `arguments`。
- **不要用 `timestamp` 直接当秒**：它是毫秒；跨端对时间戳做比较前先确认单位。
- **注入块要剥**：`user` 记录里可能夹着 harness 注入的说明块。**先抽 `<user_query>…</user_query>`**，抽不到再按开头标记（`<system-reminder>` / `<cb_summary>` / `<additional_data>` / `<identity_context>`）整条丢弃 —— 顺序反了会把「注入块与真话同行」的那些消息一起丢掉。
- **文件是追加的**：同一会话几分钟内条数会变。要做一致性判断就先记下 mtime 与行数。
