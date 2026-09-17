# 上架 WorkBuddy 开放平台：材料与提交清单

> 目标：把本仓库的技能发布到 WorkBuddy 市场，让别的用户在客户端「专家·技能·连接器 → 技能」里搜到并安装。
>
> 平台入口 <https://open.workbuddy.cn>。官方规范：<https://open.workbuddy.cn/docs/skill>，入驻指南：<https://open.workbuddy.cn/docs/onboarding>。

## 一、只有本人能做的两步（无法代做）

1. **实名认证**：首次入驻需完成个人认证 —— 真实姓名 + 身份证号 + 手机号 + 邮箱验证码，并**本人人脸识别**。
   （企业认证走营业执照 + 法人扫脸，个人发布技能不需要。）
2. **点「提交审核」和最后的「发布」**：这两步在平台后台，需要登录态与人工确认。

其余材料本仓库已全部备好。

## 二、上传用的包

| 文件 | 说明 |
|---|---|
| `dist/workbuddy-thread-context-1.0.0.zip` | **首选**。包内以技能名为根目录：`workbuddy-thread-context/{SKILL.md, references/, scripts/}` |
| `dist/workbuddy-thread-context-1.0.0-flat.zip` | 备选。根目录直接放 `SKILL.md`。**仅当首选包解析失败（提示缺少 SKILL.md 或目录层级不对）时换用** |

- 大小 ~11KB，限制 3MB，远低于上限。
- 重新生成：`python tools/build-skill-zip.py`
- 平台限制目录最多两层，包内不含任何凭据、本机路径、token。

## 三、展示信息（直接抄）

| 字段 | 填什么 |
|---|---|
| 市场展示名称 | `会话分支` |
| 市场展示分类 | `效率工具`、`办公协同`（可选加 `知识与学习`；至少 1 个，最多 5 个） |
| 服务类目 | `工具-办公` |
| 头像 | 上传 `assets/icon-512.png`（512×512 PNG，15KB；要求 512×512、JPG/PNG、≤500KB） |
| 版本号 | `1.0.0` |

**介绍文案**（对应平台「介绍」字段，可直接粘贴）：

> 把另一个会话的上下文搬进当前会话，并支持从任意一条消息处分叉——只带这条消息之前的历史，之后的不带，对标 Codex 桌面版的「Fork」。WorkBuddy 桌面版没有原生分支按钮，本技能用「锚点切片 + 交接稿」实现等价效果，且不改动原会话。附带关键词反查：只记得内容、忘了是哪个会话时，也能定位到具体时间点。只读本机会话记录，不联网、不上传。

**SKILL.md 里已写好的元信息**（平台从包里解析，页面不可改，要改就改文件重打包）：

```yaml
name: workbuddy-thread-context
display_name: 会话分支（跨线程上下文）
display_name_en: Thread Branch
description: 在会话之间搬运上下文。当用户贴会话 ID 问……时使用。核心是读本机会话落盘记录，按 ID 读、按关键词反查、按消息锚点切片分叉。
description_zh: 把另一个会话的上下文搬进当前会话，支持按消息锚点「分叉」……
description_en: Bring another WorkBuddy thread context into the current conversation...
category: productivity
version: 1.0.0
author: Strange
allowed-tools: Bash,Read
```

## 四、提交步骤

1. 打开 <https://open.workbuddy.cn> → 「立即入驻」→ 微信或手机号登录。
2. 完成个人认证（见第一节第 1 点）。
3. 左侧 `发布管理 → 技能` → 右上角「创建」。
4. 上传 `dist/workbuddy-thread-context-1.0.0.zip`。平台自动解包解析并生成技能 ID。
   - 解析失败：先换 `-flat` 包；仍失败就对照官方文档查目录层级，或发邮件 `openworkbuddy@tencent.com` / 扫开放平台首页二维码进开发者社群。
5. 「确认信息」页补齐第三节的展示信息，右侧预览核对名称、简介、头像。
6. 「提交审核」→ 核对汇总 → 提交。
7. 审核结果在开放平台**通知中心**（若与客户端同微信号注册，客户端的消息中心也会收到）。
8. 通过后回到 `发布管理 → 技能`，状态为「待发布」→ 点「发布」→ 选 **公开发布**（全部用户可见；「专用发布」只给自家 Buddy 应用用）。

审核时长口径不一：官方页面写约 7 个工作日，实操分享多为 1–3 个工作日（有 18 小时过审的案例）。以通知为准。

## 五、提交前自查（平台红线）

- [x] **不含任何真实 Token / 密钥 / 内部地址**：脚本只读本机 `projects/` 下的会话记录，不含任何端点、凭据、账号信息。
- [x] **不含本机绝对路径**：SKILL.md 与脚本用 `~` / `os.homedir()`，可用 `--home` 或 `WB_HOME` 覆盖；数据目录按 `.workbuddy` 与 `.workbuddy-ai` 自动探测。
- [x] **YAML 头字段齐全**：`description` / `description_zh` / `description_en` / `version` / `author` 都在；冒号后有空格；尽量不用引号。
- [x] **功能与介绍一致**：`description` 写清了用途与触发词，用户在对话里说「接着上次那聊」「从那条消息分叉」都能唤起。
- [x] **依赖为零**：只用 Node 内置模块（`fs` / `os` / `path`），不需要 `npm install`。
- [ ] **装一次真跑一遍**：上架前先在本地把 ZIP 解到 `~/.workbuddy/skills/`，用真实会话验证一次 `--points` 与 `--export`。

## 六、上架后的维护

- 改内容 → 后台「更新版本」→ 改 `SKILL.md` 里的 `version` → 重新打包上传。
- 同一张卡片上有「设置」和「下架」。
- 平台建议保持更新节奏（至少每 2 个月一次）。
