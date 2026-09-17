# workbuddy-thread-context

把**另一个 WorkBuddy 会话的上下文**搬进当前会话，并且支持像 **Codex 桌面版的 Fork** 那样，从任意一条消息处分叉——只带这条消息之前的历史，之后的不带。

WorkBuddy 桌面版没有原生的「分支」按钮。这个技能用 **锚点切片 + 交接稿** 做到了等价的事，而且**不改动原会话**。

```bash
# 这个会话最后在聊什么
node skills/workbuddy-thread-context/scripts/thread.mjs --id 93530613 --tail 20

# 每条消息旁的分叉图标在哪（打锚点清单）
node skills/workbuddy-thread-context/scripts/thread.mjs --id 93530613 --points

# 从 #7 分叉：只带 #1–#7，之后的全部忘掉
node skills/workbuddy-thread-context/scripts/thread.mjs --id 93530613 --until 7 --export

# 在对话里点着分叉：把分叉点渲染成可点面板，不用记编号
node skills/workbuddy-thread-context/scripts/picker.mjs --id 93530613 --out picker.html --only user,notice
```

## 为什么需要它

新开一个会话，你就「失忆」了：不记得上周那个话题讨论到哪、结论是什么。WorkBuddy 里想接着聊，只能整条会话倒回来，把无关的几百轮一起背着走。

这个技能解决两件事：

1. **找回**——贴一个会话 ID，或者只给一句关键词 + 大概时间，直接定位到是哪个会话、哪个时间点。
2. **只带需要的部分**——在任意一条消息处切开，把前面那段做成一份「交接稿」读进新会话。后面那些走歪的、已作废的推理不会被带进来。

## 它怎么工作

不靠平台 API，也不靠检索服务——**直接读 WorkBuddy 写在你本机的会话记录**：

```
~/.workbuddy/projects/<工作区slug>/<会话id>.jsonl   # 每行一条记录
```

脚本把这行文件解析成「锚点」（`user` / `assistant` / `notice` 三类消息，按顺序编号），再按你选的范围切片、渲染成 Markdown 交接稿。

`notice` 是宿主投递的后台任务通知、hook 回执一类——它们也裹在 `role: user` 的记录里，但不是人说的话，所以单独归类。

## 在对话里点着分叉（分叉选择器）

记编号太麻烦。`picker.mjs` 把锚点清单渲染成一块**可点面板**：选一条消息、按一下按钮，分叉就开始了。

```bash
node skills/workbuddy-thread-context/scripts/picker.mjs --id 93530613 --out picker.html --only user,notice
```

- 三种模式：**保留到此**（只带该点之前的历史，等同 Codex Fork）、**只要之后**、**取区间**。另有内容过滤、只看我发的、换会话、显示全部锚点。
- 在 WorkBuddy 会话内渲染时，面板的按钮会把一句**确定的指令**回传给模型（形如 `分叉会话 93530613： --until 7 --export`），模型据此导出交接稿——等于给「新建分支」装了个按钮。
- 这份 HTML 也**可以直接用浏览器打开**。此时按钮不回传指令，而是把该跑的命令显示出来供你手动执行。
- `--only user,notice` 只把「人说的」和「系统通知」装进面板，体积约为全量的六成；助手回复锚点由面板上的「显示全部 ↗」触发重渲染时再装。

面板不读任何外部资源（CSS/JS/数据全部内联），离线可用。

## 安装

### 方式一：装进 WorkBuddy 技能目录（推荐）

把这个目录复制到 WorkBuddy 的技能目录：

```bash
# macOS / Linux
cp -r skills/workbuddy-thread-context ~/.workbuddy/skills/

# Windows（PowerShell）
Copy-Item -Recurse skills\workbuddy-thread-context "$env:USERPROFILE\.workbuddy\skills\"
```

国际版客户端的数据与技能目录是 `~/.workbuddy-ai`，两者可以都装一份。

### 方式二：从 WorkBuddy 市场安装

技能已上架 WorkBuddy 开放平台，在客户端左侧 `专家·技能·连接器` → `技能` 里搜索「**会话分支**」即可安装。

### 方式三：不安装，直接用脚本

脚本零依赖，有 Node 18+ 就能跑：

```bash
node skills/workbuddy-thread-context/scripts/thread.mjs --help
```

## 用法

| 你想做什么 | 命令 |
|---|---|
| 看近几天有哪些会话 | `--list --days 7` |
| 只记得内容，忘了是哪个会话 | `--search "关键词" --days 3` |
| 看某个会话的最后几轮 | `--id <id> --tail 20` |
| 列出可用的分叉点 | `--id <id> --points` |
| 在对话里点着分叉（渲染面板） | `picker.mjs --id <id> --out picker.html` |
| 拿机器可读的锚点清单 | `--id <id> --points --json --slim` |
| 从第 7 条消息分叉 | `--id <id> --until 7 --export` |
| 只要中间一段 | `--id <id> --from 10 --to 11 --export` |
| 按时间点分叉 | `--id <id> --until "09-17 15:30" --export` |
| 在对话里直接看，不落文件 | `--id <id> --tail 8` |

常用开关：`--no-noise`（去掉工具调用折叠块）、`--exportWidth N`（每条截断长度）、`--out 路径`、`--home <数据目录>` / 环境变量 `WB_HOME`。

## 与 Codex 桌面版的对照

| Codex | 本技能 |
|---|---|
| Fork（从某条消息起新会话，之后的不保留） | `--until <锚点> --export`，然后把它读进当前会话 |
| **消息旁的分叉图标** | **分叉选择器面板里点那一行**（`picker.mjs`） |
| 「在新工作树中创建分支」（代码也分叉） | 只 fork 上下文；代码回滚自己 `git reset --hard`——两件事分开 |
| `/side`（继承上下文的临时岔路） | `--tail 8` 就地看尾部讨论 |
| `@历史会话`（自动总结交接） | 不带范围的 `--export`，或读进来后自行压缩 |

## 边界

- 只覆盖**本机、未被清理**的会话；换了设备或历史被删掉就取不到。
- 会话文件是**持续追加**的，同一会话几分钟内条数会变，别拿旧快照下结论。
- 交接稿里的正文是原文，可能含敏感内容；默认落在 `~/.workbuddy/branches/`，请自行保管。

## 隐私

- **只读本机文件**：不联网、不调用任何接口、不上传任何内容。
- 不读取凭据：脚本只碰 `projects/` 下的会话记录，不涉及 `credentials/`、cookie、token。
- 导出的交接稿由你自己保管，别提交进公开仓库。

## 许可

MIT
