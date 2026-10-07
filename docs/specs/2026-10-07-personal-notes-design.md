# 个人笔记 设计文档

- 文档日期：2026-10-07
- 需求来源：`提示词/个人笔记提示词.txt`、`提示词/ai润色提示词.txt`、`提示词/提示词-模板.txt`
- 视觉来源：`图片素材/个人笔记主页.jpg`、`图片素材/个人笔记-主页截图.jpg`、`图片素材/个人笔记-笔记背景.jpg`
- 当前状态：待评审（评审通过后进入实施计划）

---

## Context

`prompt2/` 目录目前只有需求提示词与素材图，**没有任何代码**。本次为从零实现一个可本地运行的「个人笔记」Web 应用。

需要落地的能力分三层：

1. **基础笔记应用**（来自 `个人笔记提示词.txt`）：注册登录、个人主页、笔记管理（写 / 存草稿 / 列表 / 详情）、分享（链接 + 可选密码）、评论、收藏、关于页、Markdown 渲染。
2. **AI 润色**（来自 `ai润色提示词.txt`）：在写笔记页划词选中文本 → 右键菜单「AI 润色」→ 弹出左右对照窗口 → 「确认替换」把润色结果写回选中位置。该提示词要求「必须调用外部大模型 API」。
3. **交付形态**（来自 `提示词-模板.txt`）：需要补充「业务流程」章节描述；字符编码统一 UTF-8，禁用 GBK。

视觉方向已由素材图锁定：奶油白底 + 金棕点缀的暖调极简风格，标题使用中文衬线大字，笔记纸面使用羊皮纸纹理。

### 已确认的关键决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | AI 大模型接入方式 | **Mock 为默认 provider，同时提供可配置切换的真实调用**。提示词要求「必须接入外部大模型」，而实施环境不保证有可用 API Key，因此后端做 provider 抽象：`AI_PROVIDER=mock`（默认，纯离线）或 `AI_PROVIDER=openai`（OpenAI 兼容协议，读 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`）。两者可切换而不改路由层代码。 |
| 2 | 「查看笔记历史」的含义 | **我的全部笔记列表**（含草稿），**不做版本历史**。 |
| 3 | 笔记可见性与评论权限 | 笔记**默认私有**；仅通过**分享链接**可被他人查看（可设密码）；**游客可评论**（填昵称），登录用户评论记录 user_id。 |
| 4 | Markdown 渲染位置 | **前端本地 vendored 渲染**（marked.js），渲染结果经 DOMPurify 净化。 |
| 5 | 写笔记页编辑区形态 | **Markdown 文本域（左）+ 实时预览（右）分栏**。划词与右键替换都作用在 `<textarea>` 上，可用 `selectionStart/selectionEnd` 精确替换。 |
| 6 | 分享链接语义 | **实时视图**：`shares` 表只存 token 与密码，内容指向笔记当前内容；密码解锁与评论区在**同一页面**内完成。 |
| 7 | 主页卖点文案 | **保留截图四宫格版式与图标，文案改为与实际功能一致**（不做「标签管理」功能，也不宣传「云端同步」这类未实现能力）。 |
| 8 | 交付物 | **完整代码 + README + `start.bat` 一键启动**。 |

---

## Goals

- 提供完整可本地运行、可演示的「个人笔记」应用，覆盖上文全部 12 项基础功能 + AI 润色。
- 后端所有接口统一返回 `{"code": "...", "message": "中文提示", "data": ...}`，前端只展示 `message`。
- 全程 UTF-8：源码、模板、数据库连接、响应头、静态文件均显式声明 UTF-8。
- 依赖全部锁定精确版本，pip 走国内镜像；前端第三方库本地 vendored，**断网也能完整运行**。
- AI 润色在无 API Key 的环境下依然可完整演示（Mock provider 返回确定性的规则化润色结果）。
- 视觉还原素材图：主页还原截图版式，笔记详情使用羊皮纸纹理且正文对比度达标。
- 提供 `tests/smoke_test.py`，以接口断言覆盖全部关键路径。

## Non-Goals

以下明确**不在本次范围**，实施阶段不得擅自补做：

- 邮箱验证、找回密码、验证码、第三方登录
- 头像上传（仅文字信息与 bio）
- 公开笔记广场 / 笔记发现 / 搜索 / 标签 / 分类
- WYSIWYG 富文本编辑
- 笔记版本历史、逐行 diff、回滚
- 点赞、关注、@ 提醒、评论回复嵌套、评论审核后台
- 真实生产部署（HTTPS、多进程、Nginx、Docker）
- AI 流式输出（SSE）、多轮对话、润色风格选择器
- 移动端 App、PWA、推送

---

## Recommended Approach

**单体 Flask 应用 + 原生前端 + SQLite 单文件**，分三层落地：

1. **后端按职责拆 Blueprint**：`auth`（注册登录）、`profile`（个人信息与收藏）、`notes`（笔记 CRUD、收藏、分享管理）、`share`（公开分享页与评论）、`ai`（润色）。数据访问用标准库 `sqlite3` + 一层薄封装（`query` / `execute` 两个函数 + 行工厂），**不引入 ORM**。
2. **AI 润色做 provider 抽象**：`core/ai/base.py` 定义 `PolishProvider.polish(text) -> str`，`mock.py` 与 `openai_compat.py` 各实现一份，由配置选择。这样既满足「本期只做 Mock 可演示」，又让真实接入只是换个环境变量，且不与提示词的硬性要求冲突。
3. **前端零构建**：Jinja2 模板负责页面骨架，每页一个 ES module 脚本负责交互，第三方库（marked.js、DOMPurify.js）vendored 到 `static/vendor/`，用本地路径引用。不引入 npm / 打包器。

选择该方案的理由：需求本身是中小型 CRUD 应用 + 一个前端交互弹窗，引入 ORM、构建工具、前后端分离框架都会带来远超收益的复杂度；而「不引入框架」的代价仅是手写 ~10 条 SQL，且能保证离线可运行、依赖可锁、环境可复现。

## Alternatives Considered

| 方案 | Pros | Cons | 决策 |
|------|------|------|------|
| **单体 Flask + 原生前端 + sqlite3** | 零构建、依赖最少、离线可跑、易审计；与用户既有项目风格一致 | 手写 SQL、无自动迁移；前端无组件复用 | **采纳** |
| Flask + SQLAlchemy | 模型清晰、关系显式 | 多一层依赖与版本锁负担；本需求表结构简单（5 表、无复杂 join），收益有限 | 否决 |
| Flask API + Vue/React SPA | 前端体验好、组件化 | 需 npm 构建链、破坏离线可运行、与「原生 html+js+css」技术栈要求冲突 | 否决（与提示词冲突） |
| 后端渲染 Markdown（Python markdown 库） | 前端更轻、SEO 友好 | 实时预览需多一次请求；仍需 XSS 白名单处理 | 否决（用户选前端渲染） |
| AI 润色直接写死调用某一服务商 | 代码最少 | 无法离线演示；换供应商需改代码 | 否决（用户选 Mock 默认 + 可配开关） |

---

## Architecture

```
prompt2/
├─ app.py                     # 入口：create_app() + 开发服务器启动
├─ config.py                  # 配置：SECRET_KEY、DB_PATH、AI_PROVIDER、AI_BASE_URL 等
├─ requirements.txt           # 锁定精确版本，pip 走清华源
├─ start.bat                  # 一键启动：依赖检查 → 安装 → 端口探测 → 启动 → 开浏览器
├─ README.md                  # 运行说明、演示账号、AI 配置说明
├─ core/
│  ├─ db.py                   # sqlite3 连接管理、query/execute 薄封装、建表与初始化
│  ├─ security.py             # 密码哈希校验、登录态装饰器、分享密码哈希
│  ├─ responses.py            # ok() / fail(code, message) 统一响应构造
│  └─ ai/
│     ├─ base.py              # PolishProvider 抽象 + get_provider() 工厂
│     ├─ mock.py              # MockProvider：离线规则化润色
│     └─ openai_compat.py     # OpenAICompatProvider：真实调用
├─ routes/
│  ├─ auth.py                 # /api/auth/*
│  ├─ profile.py              # /api/profile、/api/favorites
│  ├─ notes.py                # /api/notes/*
│  ├─ share.py                # /api/share/*（公开）
│  ├─ ai.py                   # /api/ai/*
│  └─ pages.py                # 页面路由（渲染 Jinja2 模板）
├─ templates/                 # base.html / index / login / register / profile /
│                             # notes_list / note_edit / note_detail / share / about
├─ static/
│  ├─ css/style.css           # 设计令牌 + 全部页面样式
│  ├─ js/                     # 每页一个模块 + markdown.js + editor.js + polish.js
│  ├─ vendor/                 # marked.min.js、purify.min.js（本地锁定版本）
│  └─ img/                    # 从 图片素材/ 复制并压缩后的素材
├─ data/notebook.db           # SQLite（首次启动自动建库建表）
├─ tests/smoke_test.py        # 接口断言
└─ docs/specs/                # 本设计文档
```

**模块归属边界**

- `core/db.py` 是唯一直接持有 sqlite3 连接与 SQL 的模块；`routes/*` 只调用它暴露的 `query` / `execute`。
- `core/security.py` 是唯一处理密码哈希与登录态判断的模块；`routes/*` 通过 `@login_required` / `current_user()` 使用。
- `core/responses.py` 是唯一构造响应体的地方；任何路由都不得手写 `{"code": ...}` 字面量。
- `core/ai/` 是唯一与外部大模型交互的模块；`routes/ai.py` 只负责参数校验、长度限制与错误码映射。
- 前端 `static/js/polish.js` 只负责弹窗 UI 与文本替换；它通过 `editor.js` 暴露的选区接口读写文本域，不直接操作 DOM 结构。

---

## 数据模型

SQLite，`PRAGMA foreign_keys = ON`，`PRAGMA journal_mode = WAL`。所有时间戳用 `TEXT` 存 ISO-8601 UTC 字符串。

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  content_md   TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX idx_notes_user_status ON notes(user_id, status, updated_at DESC);

CREATE TABLE shares (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id       INTEGER NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  password_hash TEXT,              -- NULL = 无需密码
  created_at    TEXT NOT NULL
);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL = 游客
  nickname   TEXT NOT NULL,        -- 游客必填；登录用户取其用户名
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_note ON comments(note_id, created_at);

CREATE TABLE favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, note_id)
);
```

**关键建模说明**

- 一个笔记最多一条 `shares` 记录（`UNIQUE(note_id)`），「重新生成链接」= 更新 token；「取消分享」= 删除该行。分享删除不删笔记。
- 分享为实时视图，因此 `shares` 不存内容快照；作者编辑笔记后，分享页刷新即见新内容。
- 评论**只挂在笔记上**，不区分来源；访客打开分享页评论时写入 `user_id = NULL` + 页面表单填写的 `nickname`。作者本人打开自己的分享页评论，按登录用户处理。
- 删除笔记时级联删除 `shares` / `comments` / `favorites`（依赖 `ON DELETE CASCADE` + 开启外键约束）。
- `favorites` 只能收藏**自己**的笔记（提示词中收藏属于个人主页能力），收藏他人分享的笔记属非目标。

---

## API 与错误码

### 统一响应

```json
{ "code": "OK", "message": "操作成功", "data": { } }
```

- 成功：`code = "OK"`，HTTP 200（创建成功用 201）。
- 失败：`code` 为大写蛇形常量，`message` 为**面向用户的中文提示**，HTTP 状态码取语义值（400/401/403/404/409/500）。
- 前端统一在处理层读取 `message` 并展示；只有 `message` 允许出现在用户可见的错误提示中。

### 错误码表

| code | HTTP | message（前端展示） | 触发场景 |
|------|------|--------------------|---------|
| `OK` | 200 | 操作成功 | 成功 |
| `INVALID_PARAMS` | 400 | 请求参数不完整或格式不正确 | 缺字段、类型错、非法枚举值 |
| `EMAIL_EXISTS` | 409 | 该邮箱已被注册 | 注册邮箱重复 |
| `EMAIL_INVALID` | 400 | 请输入有效的邮箱地址 | 邮箱格式不合法 |
| `USERNAME_REQUIRED` | 400 | 请输入用户名 | 用户名空白 |
| `PASSWORD_TOO_SHORT` | 400 | 密码长度至少 6 位 | 密码过短 |
| `PASSWORD_MISMATCH` | 400 | 两次输入的密码不一致 | 确认密码不符 |
| `LOGIN_FAILED` | 401 | 邮箱或密码错误 | 登录失败（不区分账号是否存在） |
| `AUTH_REQUIRED` | 401 | 请先登录 | 未登录访问受保护接口 |
| `FORBIDDEN` | 403 | 无权操作该笔记 | **保留码**：当前实现统一以 `NOTE_NOT_FOUND` 处理越权，避免探测他人笔记是否存在；此码仅为未来细粒度权限预留 |
| `NOTE_NOT_FOUND` | 404 | 笔记不存在 | id 不存在或已被删除 |
| `NOTE_TITLE_REQUIRED` | 400 | 请填写笔记标题 | 发布时标题为空 |
| `COMMENT_EMPTY` | 400 | 评论内容不能为空 | 空评论 |
| `NICKNAME_REQUIRED` | 400 | 请填写昵称后再评论 | 游客未填昵称 |
| `COMMENT_TOO_LONG` | 400 | 评论内容不能超过 500 字 | 超长 |
| `SHARE_NOT_FOUND` | 404 | 分享链接无效或已取消 | token 不存在 |
| `SHARE_PASSWORD_REQUIRED` | 401 | 该分享需要密码 | 访问加锁分享未提供密码 |
| `SHARE_PASSWORD_WRONG` | 401 | 分享密码错误 | 密码校验失败 |
| `AI_EMPTY_TEXT` | 400 | 请先选中需要润色的文本 | 空文本 |
| `AI_TOO_LONG` | 400 | 选中的文本过长，请分段润色 | 超过 2000 字 |
| `AI_UNAVAILABLE` | 502 | AI 服务暂时不可用，请稍后重试 | 未配置 Key / 上游报错 |
| `AI_TIMEOUT` | 504 | AI 服务响应超时，请重试 | 上游超时 |
| `NOT_FOUND` | 404 | 页面不存在 | 页面路由未匹配 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误，请稍后重试 | 未捕获异常 |

### 接口清单

**认证**（`routes/auth.py`）

| 方法 | 路径 | 入参 | 说明 |
|------|------|------|------|
| POST | `/api/auth/register` | email, username, password, confirm_password | 注册成功后直接登录 |
| POST | `/api/auth/login` | email, password | 建立 session |
| POST | `/api/auth/logout` | — | 清 session |
| GET | `/api/auth/me` | — | 返回当前用户或 `data.user = null` |

**个人信息与收藏**（`routes/profile.py`）

| 方法 | 路径 | 入参 | 说明 |
|------|------|------|------|
| PUT | `/api/profile` | username, bio | 更新个人信息 |
| GET | `/api/favorites` | — | 我收藏的笔记列表 |
| POST | `/api/notes/<id>/favorite` | — | 切换收藏（收藏/取消），返回 `data.favorited` |

**笔记**（`routes/notes.py`，全部要求登录）

| 方法 | 路径 | 入参 | 说明 |
|------|------|------|------|
| GET | `/api/notes` | `status=all\|draft\|published` | 我的笔记列表，按 updated_at 倒序 |
| POST | `/api/notes` | title, content_md, status | 新建（`status=draft` 可空标题） |
| GET | `/api/notes/<id>` | — | 详情 |
| PUT | `/api/notes/<id>` | title, content_md, status | 更新 |
| DELETE | `/api/notes/<id>` | — | 删除（级联） |
| POST | `/api/notes/<id>/share` | password（可空） | 生成/更新分享链接，返回 token 与完整 URL |
| DELETE | `/api/notes/<id>/share` | — | 取消分享 |

**分享与评论**（`routes/share.py`，公开，无需登录）

| 方法 | 路径 | 入参 | 说明 |
|------|------|------|------|
| GET | `/api/share/<token>` | — | 返回笔记内容；若需密码且未解锁，返回 `SHARE_PASSWORD_REQUIRED` |
| POST | `/api/share/<token>/unlock` | password | 校验密码，成功后在 session 中记录 `unlocked_shares` |
| GET | `/api/share/<token>/comments` | — | 评论列表（时间正序）；分享设有密码且未解锁时返回 `SHARE_PASSWORD_REQUIRED` |
| POST | `/api/share/<token>/comments` | nickname（游客必填）, content | 发表评论；分享设有密码且未解锁时返回 `SHARE_PASSWORD_REQUIRED` |

**AI 润色**（`routes/ai.py`，要求登录）

| 方法 | 路径 | 入参 | 说明 |
|------|------|------|------|
| GET | `/api/ai/status` | — | 返回 `data.provider`、`data.available`，前端据此决定是否提示「当前为演示模式」 |
| POST | `/api/ai/polish` | text | 返回 `data.polished`、`data.provider` |

**页面路由**（`routes/pages.py`）

| 路径 | 模板 | 说明 |
|------|------|------|
| `/` | index.html | 主页落地页 |
| `/login` `/register` | login.html / register.html | 已登录则 302 到 `/profile` |
| `/profile` | profile.html | 个人信息 + 我的笔记 + 我的收藏 + 分享管理 |
| `/notes` | notes_list.html | 笔记列表（前端切换 全部/已发布/草稿） |
| `/notes/new` `/notes/<id>/edit` | note_edit.html | 编辑页（分栏 + 润色） |
| `/notes/<id>` | note_detail.html | 羊皮纸详情页 |
| `/share/<token>` | share.html | 公开分享页（密码锁 + 评论） |
| `/about` | about.html | 关于页 |
| 404 | 404.html | 中文提示 + 返回主页 |

---

## Interface Design Contract

### Experience and Journeys

**目标用户**：想随手记录灵感、并在需要时把笔记分享给他人的中文个人用户。界面要传达「安静、专注、纸感」，避免后台管理系统的冷硬感。

**界面的核心工作**：让「写下想法 → 润色打磨 → 发布或分享」这条路径在 3 次点击内完成。

**主要旅程**

1. **首次到访**：`/` 主页 → 阅读价值主张 → 点「开始记录」→ `/register` → 注册成功自动登录 → 跳 `/notes/new`。
2. **写作与润色**：`/notes/new` → 输入标题与 Markdown → 右侧实时预览 → 划词选中一段 → 右键「AI 润色」→ 弹窗对比 → 「确认替换」→ 文本与预览同步更新 → 点「发布」→ 跳 `/notes/<id>` 羊皮纸详情页。
3. **草稿续写**：`/notes` 列表 → 「草稿」筛选 → 点开续写 → 「保存草稿」。
4. **分享**：`/notes/<id>` → 「分享」→ 可选设密码 → 复制链接 → 未登录访问者打开 `/share/<token>` → 输入密码解锁 → 阅读 → 填昵称 + 评论。
5. **收藏与回访**：任何笔记详情页点「收藏」→ `/profile` 的「我的收藏」查看。
6. **恢复路径**：注册邮箱重复 → 表单下方中文提示「该邮箱已被注册」+「去登录」链接；分享密码错误 → 就地提示并保留输入框；AI 失败 → 弹窗内提示 + 「重试」按钮，取消则原文零改动。

### Layout and Responsive Behavior

**主页 `/`（还原截图）**

```
┌──────────────────────────────────────────────────────────────┐
│ [笔记本图标] 个人笔记             登录    注册    关于        │  ← 顶栏：白底、细下边框
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  记录生活 · 书写成长♡               ┌────────────────────┐    │
│  遇见美好                          │  暖光书桌实拍图     │    │
│  ~~~~~~~（金色手绘下划线）          │  咖啡 / 花 / 笔记本 │    │
│                                    │                    │    │
│  个人笔记是一款简洁优雅的在线笔记应用，│                    │    │
│  帮助你随时随地记录灵感……           └────────────────────┘    │
│                                                              │
│  [ 开始记录 ]  [ 了解更多 ]                                   │
│                                                              │
│  ◯简洁易用   ◯分享协作   ◯隐私保护   ◯评论互动                 │
│  界面清新…    一键分享…     数据加密…    交流讨论…              │
└──────────────────────────────────────────────────────────────┘
```

**笔记编辑页 `/notes/new`（分栏 + 润色）**

```
┌──────────────────────────────────────────────────────────────┐
│ ← 返回    [标题输入框..............]   [保存草稿] [发布]      │
├───────────────────────────────┬──────────────────────────────┤
│  Markdown 源码  (textarea)     │  实时预览                     │
│                               │                              │
│  ## 今天的想法                 │  今天的想法  (衬线标题)        │
│  这是一段需要润色的文字|        │  这是一段需要润色的文字        │
│                               │                              │
│        ┌──────────────┐       │                              │
│        │   AI 润色    │ ← 自定义右键菜单（仅选中非空时显示）   │
│        └──────────────┘       │                              │
└───────────────────────────────┴──────────────────────────────┘

        ↓ 点击「AI 润色」后弹出模态

┌──────────────────────────────────────────────────────┐
│                  AI 文本润色                          │
├──────────────────────────┬───────────────────────────┤
│  原文                     │  润色结果                  │
│  ┌────────────────────┐  │  ┌─────────────────────┐  │
│  │ 只读，浅灰底        │  │  │ 可编辑，白底金边框   │  │
│  │                    │  │  │                     │  │
│  └────────────────────┘  │  └─────────────────────┘  │
├──────────────────────────┴───────────────────────────┤
│                              [ 取消 ]  [ 确认替换 ]   │
└──────────────────────────────────────────────────────┘
```

**响应式规则**

| 断点 | 行为 |
|------|------|
| ≥1024px（桌面） | 主页 Hero 左右两栏；编辑页左右分栏各 50%；详情页正文最大宽 760px 居中 |
| 768–1023px（平板） | 主页 Hero 图缩小并保持右侧；编辑页改为 55/45；弹窗左右分栏各 50% |
| <768px（手机） | 主页 Hero 改为单列，图在文案**下方**；编辑页改为「编辑 / 预览」标签页切换（不叠两栏）；润色弹窗改为上下堆叠，底栏按钮全宽；顶栏导航收成汉堡菜单，展开为纵向列表；羊皮纸背景改为 `background-size: cover` + 内边距收窄；所有可点区域 ≥ 44×44px |

### Visual System

**视觉方向理由**：笔记的核心隐喻是「纸」。素材图给出的暖奶油底 + 金棕点缀，指向「安静的纸与光」，与真实的书写场景（咖啡、笔记本、花）同源；中文衬线标题呼应纸面书写感。因此不采用冷色 SaaS 面板风格，也不使用渐变装饰。

**签名元素**：**羊皮纸纸面**。笔记详情页与编辑页预览区共用同一张羊皮纸纹理（`static/img/parchment.jpg`），配金色手绘标题下划线；全站仅此一处做视觉强调，其余元素保持克制（纯色、细边框、无阴影堆叠）。

**设计令牌**（`static/css/style.css` 顶部 `:root`，全站唯一定义处）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--bg` | `#F7F4EE` | 页面底色 |
| `--surface` | `#FFFFFF` | 卡片 / 输入框 |
| `--primary` | `#B89B6A` | **装饰性**金棕：图标底色、徽标、手绘下划线、装饰边框（不承载文字） |
| `--primary-strong` | `#7A5C2E` | **承载文字**的金棕：主按钮填充、正文链接、focus 描边（满足 ≥ 4.5:1） |
| `--primary-strong-hover` | `#6A4F26` | 主按钮 hover / active |
| `--accent` | `#F2C94C` | 装饰点缀（爱心、装饰箭头） |
| `--text` | `#3D3730` | 主文字 |
| `--text-muted` | `#6F665C` | 次要文字、说明（对比度 5.13:1） |
| `--border` | `#E8E1D5` | 分隔线、卡片描边 |
| `--parchment-ink` | `#4A3B2A` | 羊皮纸正文文字 |
| `--danger` | `#9E4A34` | 删除、错误提示（对比度 5.49:1） |
| `--radius` | `10px` | 卡片圆角（按钮 8px） |
| `--space-1..6` | `4 / 8 / 12 / 16 / 24 / 40px` | 间距梯度 |
| `--shadow` | `0 2px 12px rgba(61,55,48,.08)` | 唯一阴影，仅用于浮层与弹窗 |

**字体角色**

| 角色 | 字体栈 |
|------|--------|
| 标题（中文衬线） | `"Songti SC","STSong","SimSun","Noto Serif SC",serif` |
| 英文手写装饰 | `"Segoe Script","Bradley Hand",cursive` |
| 正文 / UI | `-apple-system,"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif` |
| 代码 / Markdown 源码 | `"Cascadia Mono",Consolas,"Courier New",monospace` |

全部为系统字体栈，**不加载任何 Web Font**，保证离线与首屏速度。字号：Hero 标题 44/56px（移动端 32px）、页面标题 28px、正文 15px、辅助 13px；行高正文 1.7、标题 1.25。

**形状与动效**：圆角 10px（按钮 8px），描边统一 1px `--border`；无渐变、无玻璃拟态。动效统一 `transition: .18s ease`，只用于 hover / focus / 弹窗淡入（`opacity + translateY(8px)`），全部在 `@media (prefers-reduced-motion: reduce)` 下关闭。

### Components, Content, and States

| 组件 | 关键文案 / 状态 |
|------|----------------|
| 顶栏 | 未登录：`登录 / 注册 / 关于`；已登录：`写笔记 / 我的笔记 / 我的收藏 / 个人主页 / 退出` |
| 主按钮 | 「开始记录」→ 未登录跳 `/register`，已登录跳 `/notes/new`；其余：「发布」「确认替换」「注册」「登录」 |
| 次按钮 | 「了解更多」→ `/about`；「保存草稿」「取消」「分享」 |
| 危险操作 | 「删除笔记」→ 二次确认文案「删除后无法恢复，确定要删除这篇笔记吗？」 |
| 空状态 | 笔记列表：`还没有笔记，写下第一条吧` + 「写笔记」按钮；收藏：`还没有收藏，去笔记列表看看吧`；评论：`还没有评论，来说点什么吧`；草稿筛选：`草稿箱是空的` |
| 加载中 | 按钮内联文字「保存中…」并 `disabled`；润色弹窗右侧显示 `润色中…` + 旋转指示器 |
| 表单校验 | 就地提示，红色 `--danger`，紧贴字段下方；服务端返回的 `message` 使用同一位置与样式 |
| 分享面板 | `已生成分享链接` + 只读输入框 + 「复制链接」；复制成功提示 `链接已复制`（2 秒后消失） |
| 润色弹窗 | 标题「AI 文本润色」；左栏标题「原文」、右栏标题「润色结果」；Mock 模式下标题旁显示徽标 `演示模式`；失败时右侧显示中文错误 + 「重试」按钮 |
| 右键菜单 | 仅一项「AI 润色」；点击后立即关闭菜单并打开弹窗；点击页面空白或按 `Esc` 关闭 |
| 分享页密码锁 | 居中卡片：`该分享需要密码` + 密码输入框 + 「解锁」；错误就地提示且不清空输入 |
| 评论表单 | 游客：`昵称` + `评论内容`；登录用户：仅内容，昵称自动取用户名 |
| 404 | `页面不存在` + 「返回主页」 |

**术语一致性**：全站统一用「笔记」「草稿」「发布」「分享」「收藏」「评论」；不使用「文章 / 文档 / Post / 帖子」。按钮「确认替换」与弹窗标题「AI 文本润色」固定不改。

### Accessibility and Visual Verification

- 语义结构：`<header>/<nav>/<main>/<section>/<article>/<footer>`，每页唯一 `<h1>`；表单控件全部有 `<label>`。
- 键盘可达：Tab 顺序为「顶栏 → 主内容 → 底栏」；模态弹窗打开时焦点移入弹窗并**锁定在其内部**，`Esc` 关闭，关闭后焦点回到触发元素（右键菜单的触发点回落到文本域）。
- 右键菜单提供键盘等价入口：编辑页工具栏的「AI 润色」按钮（未选中文本时点击提示「请先选中需要润色的文本」）。
- 可见焦点：`:focus-visible` 使用 2px `--primary-strong` 描边 + 2px 偏移；对比度：正文 ≥ 4.5:1、羊皮纸正文 ≥ 7:1、次要文字 ≥ 4.5:1、按钮文字 ≥ 4.5:1、链接 ≥ 4.5:1、focus 描边与相邻底色 ≥ 3:1。
  - 实测值：正文 `#3D3730` on `#F7F4EE` = 10.71:1；羊皮纸正文 `#4A3B2A` on `#F2E7D0` = 8.78:1；次要文字 `#6F665C` on `#F7F4EE` = 5.13:1；错误提示 `#9E4A34` on `#F7F4EE` = 5.49:1；主按钮白字 on `#7A5C2E` = 6.18:1；链接与 focus 描边 `#7A5C2E` on `#F7F4EE` = 5.63:1；纸面链接 `#7A5C2E` on `#F2E7D0` = 5.04:1。
  - **金色分色原则**：`--primary` 只用于形状与底色，**任何承载文字的场合一律使用 `--primary-strong`**，否则无法达到 AA。
- 可点区域 ≥ 44×44px（移动端）；触摸目标间距 ≥ 8px。
- `prefers-reduced-motion: reduce` 下移除全部过渡与弹窗位移。
- 纯色 + 文本不单独承载语义（错误提示带文字，不只靠红色）。

**视觉验证清单**（验收时逐项截图确认）

| 视口 | 路由 / 状态 | 检查点 |
|------|------------|--------|
| 1440 | `/` | 顶栏、Hero 双栏、金色下划线、四宫格卖点对齐 |
| 1440 | `/notes/new` + 润色弹窗打开 | 分栏比例、弹窗左右对照、按钮位置 |
| 1440 | `/notes/<id>` | 羊皮纸纹理铺满、正文与纸面对比度、金色分隔线 |
| 1440 | `/share/<token>` 有密码 / 已解锁 | 密码锁卡片、解锁后评论列表与表单 |
| 768 | `/`、`/notes/new`、`/notes/<id>` | Hero 不溢出、分栏比例、纸面不横向滚动 |
| 375 | `/`、`/notes/new`、润色弹窗、`/share/<token>` | Hero 图在文案下方、编辑/预览标签切换、弹窗上下堆叠、无横向滚动条 |
| 375 | 错误态 | 表单校验、404、分享密码错误的中文提示可见 |

---

## Components

| 组件 | 职责 | 依赖 | 备注 |
|------|------|------|------|
| `app.py` | 创建 Flask 应用、注册 Blueprint、注册错误处理器（404/500 输出中文）、初始化数据库 | config, core.db, routes.* | 开发服务器 `host=127.0.0.1` |
| `config.py` | 集中配置：`SECRET_KEY`、`DB_PATH`、`AI_PROVIDER`、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT`、`AI_MAX_CHARS` | 环境变量 | 默认 `AI_PROVIDER=mock` |
| `core/db.py` | 连接管理、`query` / `execute`、建表、`row_factory=sqlite3.Row` | sqlite3 | 每次请求内复用连接，请求结束关闭 |
| `core/security.py` | 密码哈希（`werkzeug.security`）、`login_required`、`current_user()`、分享密码哈希 | werkzeug, flask.session | 密码一律不落明文 |
| `core/responses.py` | `ok(data)` / `fail(code, message, http)` | — | 唯一的响应构造入口 |
| `core/ai/base.py` | `PolishProvider` 抽象 + `get_provider()` 工厂 | config | 按 `AI_PROVIDER` 返回实现 |
| `core/ai/mock.py` | 离线规则化润色 | — | 确定性输出：空白归一 → 中英文标点规范 → 句末标点补全 → 相邻重复词去除 |
| `core/ai/openai_compat.py` | OpenAI 兼容调用 | requests | `POST {base_url}/chat/completions`，超时 `AI_TIMEOUT`（默认 15s），异常映射 `AI_UNAVAILABLE` / `AI_TIMEOUT` |
| `routes/ai.py` | 校验长度、调用 provider、映射错误码 | core.ai, core.responses | 不做任何 prompt 拼接以外的业务逻辑 |
| `routes/notes.py` | 笔记 CRUD + 收藏切换 + 分享管理 | core.db, core.security | 所有查询强制带 `user_id = current_user.id` |
| `routes/share.py` | 公开读取、密码解锁、评论 | core.db, core.security | 不返回作者邮箱等隐私字段 |
| `static/js/markdown.js` | `marked.parse` + `DOMPurify.sanitize` 封装 | vendor | 全局唯一渲染出口 |
| `static/js/editor.js` | 文本域选区读写、预览刷新、防抖、保存/发布 | markdown.js | 暴露 `getSelection()` / `replaceSelection(text)` |
| `static/js/polish.js` | 右键菜单、模态弹窗、调用 `/api/ai/polish`、状态与错误展示 | editor.js | 只通过 editor 接口改文本 |
| `static/js/share.js` | 密码解锁、评论列表与提交 | — | 错误提示统一取 `message` |
| `tests/smoke_test.py` | 接口断言 | Flask test client | 覆盖注册→写笔记→润色→分享→评论→收藏全链路 |

---

## Data Flow

**1. 写笔记 + AI 润色（核心链路）**

```
用户划词 → mouseup 记录 selectionStart/End（editor.js）
        → contextmenu 拦截 → 自定义菜单「AI 润色」
        → polish.js 打开模态 → 读取选中文本
        → GET /api/ai/status（判断是否显示「演示模式」徽标）
        → POST /api/ai/polish {text}
              → routes/ai.py 校验（空 → AI_EMPTY_TEXT；>AI_MAX_CHARS → AI_TOO_LONG）
              → get_provider().polish(text)
                      mock：规则化变换 | openai：上游 HTTP 调用
              → ok({"polished": ..., "provider": ...})
        → 右侧渲染结果（可编辑）
        → 用户点「确认替换」
        → editor.replaceSelection(结果)  // execCommand('insertText')，保留撤销栈
        → 触发预览刷新（markdown.js 渲染 + 净化）
        → 关闭弹窗，焦点回到文本域原选区末尾
```

失败分支：任何 `code != OK` → 右栏显示 `message` + 「重试」按钮，左栏原文与文本域内容**完全不变**；点「取消」→ 直接关闭，不修改任何字符。

**2. 发布 / 保存草稿**

```
点「发布」→ 前端校验标题非空 → PUT/POST /api/notes
  → routes/notes.py 写库（draft 时 title 可为空；published 时 updated_at + published_at 更新）
  → ok({"id": n})
→ 跳转 /notes/<id>
```

**3. 分享**

```
/notes/<id> 点「分享」→ 输入可选密码 → POST /api/notes/<id>/share
  → 生成 token = secrets.token_urlsafe(16)，密码经 generate_password_hash
  → ok({"token": t, "url": /share/t})
→ 访问者 GET /api/share/<token>
  → 有密码且 session 未解锁 → SHARE_PASSWORD_REQUIRED → 前端显示密码锁
  → POST /api/share/<token>/unlock {password} → session["unlocked_shares"].add(token)
  → 再取内容 → 渲染
评论：POST /api/share/<token>/comments {nickname?, content}
  → 登录用户 → user_id = 当前用户，nickname = 用户名
  → 游客 → user_id = NULL，昵称必填
```

**4. 收藏**：详情页点「收藏」→ `POST /api/notes/<id>/favorite` → 存在即删、不存在即插 → 返回 `favorited` 布尔 → 前端切图标态（实心/空心）。

---

## Error Handling

| 失败模式 | 系统行为 |
|---------|---------|
| 表单字段非法 | 后端 `INVALID_PARAMS` 等中文 `message`；前端就地展示在对应字段下，不整页报错 |
| 未登录访问受保护接口 | `AUTH_REQUIRED`；前端弹出提示并跳 `/login`，登录后回到原页面 |
| 访问他人笔记 / 他人分享管理 | `FORBIDDEN` / `NOTE_NOT_FOUND`（他人笔记统一按「不存在」处理，避免探测） |
| 分享 token 无效 | `SHARE_NOT_FOUND`，页面显示「分享链接无效或已取消」+ 返回主页 |
| 分享密码错误 | `SHARE_PASSWORD_WRONG`，就地提示，输入框保留，不重置 |
| AI 未配置 Key（选 openai） | 启动时与 `/api/ai/status` 反映 `available=false`；调用返回 `AI_UNAVAILABLE`，弹窗提示「AI 服务暂时不可用，请稍后重试」并建议切回 Mock |
| AI 上游超时 / 网络错误 | `AI_TIMEOUT` / `AI_UNAVAILABLE`，弹窗内提示 + 「重试」 |
| AI 返回空内容 | 按 `AI_UNAVAILABLE` 处理并记录日志，不把空串写回文本域 |
| 润色结果超长 | 前端允许，但保存笔记时按正文长度限制校验（不设硬上限，仅提示） |
| 数据库异常 | 事务回滚 + 日志，返回 `INTERNAL_ERROR`，前端展示通用中文提示 |
| 页面 404 | 自定义 404 模板（中文 + 返回主页），API 路径返回 `NOT_FOUND` JSON |
| 未捕获异常 | `@app.errorhandler(Exception)` 统一转 `INTERNAL_ERROR`，不向前端泄漏堆栈 |

---

## Security

**信任边界**：浏览器（不可信）→ Flask 应用（可信）→ SQLite（本地文件）→ 外部 AI 服务（不可信，仅在 `AI_PROVIDER=openai` 时存在）。

- **认证**：Flask session 签名 cookie，`SECRET_KEY` 来自环境变量，缺省时生成随机值并在控制台警告（开发用）；cookie 设 `HttpOnly`、`SameSite=Lax`。
- **密码**：`werkzeug.security.generate_password_hash`（`pbkdf2:sha256`）存储，登录用 `check_password_hash`；`LOGIN_FAILED` 不区分「邮箱不存在」与「密码错误」。
- **越权**：`routes/notes.py` 的每条查询都带 `user_id = current_user.id`；`routes/profile.py` 同理。分享管理接口校验 `note.user_id == current_user.id`。
- **分享密码**：哈希存储；校验通过后在 session 的 `unlocked_shares` 集合记录 token，避免每次请求重复校验；密码错误返回统一 `SHARE_PASSWORD_WRONG`，不泄漏哈希信息。**评论的读写接口同样校验解锁态**，防止绕过密码留言。作者本人不享受免密特例，与访客走同一流程。
- **XSS**：Markdown 渲染结果一律经 `DOMPurify.sanitize`（默认白名单 + 禁止 `<script>`、`on*`、`javascript:`）；用户昵称、标题、评论在模板中自动转义（Jinja2 默认开启）。
- **SQL 注入**：全部使用参数化占位符 `?`，禁止字符串拼接 SQL。
- **AI 输入外泄边界**：`AI_PROVIDER=mock` 时文本不出本机；`openai` 模式下仅发送用户选中的片段，且 README 明确说明「启用真实 provider 会把选中文本发送至所配置的服务商」。
- **CSRF**：本项目为同源 fetch + `SameSite=Lax`，写操作仅接受 `Content-Type: application/json`；不额外引入 CSRF 令牌（本地单用户演示场景，风险可接受，已在 Deferred 中记录）。
- **滥用限制**：AI 接口限制单次 2000 字、要求登录；评论限制 500 字、免登录但字段必填（垃圾评论过滤属非目标）。
- **敏感信息**：分享接口不返回作者邮箱、密码哈希、token 列表；`/share/<token>` 页面不暴露笔记 id 与作者其它笔记。

---

## Boundaries and Dependencies

| 单元 | 拥有 | 不拥有 | 依赖 / 假设 |
|------|------|--------|------------|
| `core/db.py` | 连接、SQL、建表 | 业务规则、权限判断 | 假设 SQLite 单进程访问；不处理并发写冲突（WAL + 短事务足够演示） |
| `core/security.py` | 哈希、登录态、分享解锁态 | 路由与页面 | 假设 session 后端为签名 cookie；多进程部署需共享 `SECRET_KEY`（非目标） |
| `core/responses.py` | 响应结构与 `code` 常量 | 具体文案语义 | 假设所有路由都通过它返回 |
| `core/ai/*` | 外部模型调用与结果 | 前端展示、文本替换 | `openai` 实现假设上游兼容 `/chat/completions`；`mock` 无外部依赖 |
| `routes/notes.py` | 笔记与分享的业务规则 | 渲染、样式、DOM 操作 | 假设前端只通过 JSON 接口写数据（页面路由不写库） |
| `static/js/*` | 交互、选区、渲染、弹窗 | 权限与数据校验 | 假设现代浏览器（Chrome/Edge/Firefox 近两年版本），支持 `execCommand('insertText')`（已废弃但仍在所有主流浏览器可用；不使用 `document.execCommand` 的其它命令） |
| 外部库 `Flask` / `Werkzeug` | Web 框架与安全工具 | — | 版本在 `requirements.txt` 精确锁定 |
| 外部库 `requests` | 仅 `openai` provider 使用 | — | 可选项；README 说明纯 Mock 模式下的作用 |
| 前端 vendored `marked` / `DOMPurify` | Markdown 解析与净化 | — | 版本在 README 记录；不通过 CDN 加载，保证离线 |

---

## Testing

**自动化接口断言**（`python tests/smoke_test.py`，使用 Flask `test_client`，临时数据库）

1. 静态与页面：全部页面路由返回 200，`Content-Type` 为 `text/html; charset=utf-8`；静态资源（CSS/JS/vendor/图片）返回 200。
2. 认证：注册成功 → 重复邮箱 `EMAIL_EXISTS` → 密码不一致 `PASSWORD_MISMATCH` → 密码过短 `PASSWORD_TOO_SHORT` → 登录成功 → 错误密码 `LOGIN_FAILED` → 未登录访问笔记接口 `AUTH_REQUIRED` → 退出后 `/api/auth/me` 返回 `null`。
3. 笔记：空标题存草稿成功 → 空标题发布 `NOTE_TITLE_REQUIRED` → 列表按状态筛选条数正确 → 更新后 `updated_at` 变化 → 他人笔记返回 `FORBIDDEN`/`NOTE_NOT_FOUND` → 删除后详情 `NOTE_NOT_FOUND`。
4. 收藏：切换两次返回 `favorited` 布尔且列表数量归零 → 级联删除后收藏列表为空。
5. 分享：生成 token 后 `/api/share/<token>` 免密可读 → 取消分享后 `SHARE_NOT_FOUND` → 设密码后未解锁 `SHARE_PASSWORD_REQUIRED` → 错误密码 `SHARE_PASSWORD_WRONG` → 正确密码解锁后可读。
6. 评论：游客缺昵称 `NICKNAME_REQUIRED` → 空内容 `COMMENT_EMPTY` → 游客评论成功且 `user_id` 为 NULL → 登录用户评论昵称取用户名 → 超长 `COMMENT_TOO_LONG`。
7. AI：空文本 `AI_EMPTY_TEXT` → 超长 `AI_TOO_LONG` → mock 模式返回非空且与输入不同、`provider == "mock"` → 同一输入两次结果一致（确定性）→ 模拟上游异常时返回 `AI_UNAVAILABLE`/`AI_TIMEOUT`（monkeypatch provider）。
8. 错误结构：随机抽 5 个失败用例，断言响应体同时含 `code` 与中文 `message`。

**人工视觉走查**：按上文「视觉验证清单」在 1440 / 768 / 375 三个视口截图确认主页、编辑页 + 润色弹窗、羊皮纸详情页、分享页密码锁与评论、错误态。

**手工功能演示脚本**：注册 → 写笔记 → 划词润色 → 确认替换 → 发布 → 收藏 → 生成带密码分享链接 → 无痕窗口解锁 → 游客评论 → 回个人主页查看收藏与笔记列表。

---

## Rollout

**交付与启动（Definition of Done）**

1. 代码、模板、静态资源、`README.md`、本设计文档全部落盘，编码统一 UTF-8。
2. `requirements.txt` 锁定精确版本（Flask / Werkzeug / requests 等）；`start.bat` 依次执行：检查 Python 版本 → `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt`（已装则跳过）→ 探测 5000 端口占用，占用则顺延 → 启动 `python app.py` → 轮询健康后打开浏览器。
3. 首次启动自动创建 `data/notebook.db` 与全部表；重复启动幂等（`CREATE TABLE IF NOT EXISTS`）。
4. `python tests/smoke_test.py` 全部断言通过。
5. README 写明：运行方式（`start.bat` 或 `python app.py`）、AI 配置（`AI_PROVIDER` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`，以及「启用真实 provider 会把选中文本发送给服务商」的提示）、Mock 与真实模式的差异、演示账号（如有）。
6. 无数据库迁移需求（从零建库）；无灰度、无回滚复杂度——回滚即删除 `data/notebook.db` 重来。

---

## Blocking Questions

无。所有影响架构、范围与验收的问题已在澄清阶段解决（见 Context 中的 8 条已确认决策）。

## Deferred Questions

| # | 待定项 | 当前默认假设 | 何时定 |
|---|--------|-------------|--------|
| 1 | Mock 润色的具体规则集合 | 空白归一 → 中英文标点规范化 → 句末标点补全 → 相邻重复词去除；输出确定、可预期、不引入事实性变化 | 实现时按此落地，若演示效果不理想可增补规则 |
| 2 | 是否引入 CSRF 令牌 | 不引入，依赖 `SameSite=Lax` + JSON Content-Type + 本地单用户场景 | 若将来要部署到公网，再补 token |
| 3 | 真实 provider 的默认上游 | 不预设服务商，全部由环境变量注入；未配置时 `available=false` | 用户实际接入时填写 |
| 4 | 「关于」页正文 | 项目简介 + 功能列表 + 技术栈 + 免责说明（本地演示用途），不写作者隐私信息 | 实现时撰写，用户可替换 |
| 5 | 笔记标题长度上限 | 前端与后端都不设硬上限（仅建议 ≤ 100 字），正文不限 | 出现异常长输入时再收紧 |
| 6 | 顶栏在移动端的汉堡菜单交互 | 点击展开纵向列表，点击链接或空白处收起 | 实现时按此落地 |
| 7 | 已登录用户访问分享页评论时的昵称 | 取用户名，忽略表单昵称字段 | 实现时按此落地 |
| 8 | 编辑页「编辑 / 预览」标签切换在移动端的记忆性 | 不记忆，每次进入默认「编辑」 | 实现时按此落地 |

---

## 业务流程（按模板要求汇总）

1. **注册与登录**：主页点「开始记录」→ 填写邮箱 / 用户名 / 密码 / 确认密码 → 校验通过后自动登录 → 进入写笔记页。已有账号走「登录」（邮箱 + 密码）。
2. **写笔记与草稿**：写笔记页左侧输入 Markdown、右侧实时预览 → 随时「保存草稿」（标题可空）→ 内容完整后「发布」→ 进入羊皮纸详情页。
3. **AI 润色**：编辑区内划词选中 → 右键「AI 润色」→ 弹窗左原文、右结果（加载中显示「润色中…」）→ 「确认替换」写回选中位置并刷新预览，或「取消」保持原文不变。
4. **笔记管理**：笔记列表按「全部 / 已发布 / 草稿」筛选 → 打开详情 → 编辑或删除（二次确认）。
5. **收藏**：任意笔记详情页点「收藏」→ 个人主页「我的收藏」中查看。
6. **分享**：笔记详情页点「分享」→ 可选设置密码 → 复制链接 → 他人打开 `/share/<token>` → 有密码则先解锁 → 阅读内容 → 游客填昵称评论 / 登录用户直接评论。
7. **个人主页**：查看与编辑个人信息（用户名、简介）、我的全部笔记、我的收藏、已生成的分享链接（可取消分享）。
8. **关于页面**：了解项目定位、功能与技术栈。
