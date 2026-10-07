# 个人笔记 Implementation Plan

**Created:** 2026-10-07
**Status:** Done
**Source Spec:** `docs/specs/2026-10-07-personal-notes-design.md`

## Overview

**Goal:** 从零实现可本地运行、可演示的「个人笔记」Web 应用，覆盖 12 项基础功能 + 划词右键 AI 润色，视觉还原素材图。

**Architecture:** 单体 Flask 应用（应用工厂 + 6 个 Blueprint），数据访问用标准库 `sqlite3` 加一层薄封装，不引入 ORM；前端 Jinja2 模板 + 原生 ES module，第三方库（marked、DOMPurify）本地 vendored，零构建；AI 润色做 `PolishProvider` 抽象，默认 Mock（离线可演示），可切真实 OpenAI 兼容调用。

**Tech Stack:** Python 3.12.7 / Flask 3.0.3 / Werkzeug 3.1.9 / SQLite（标准库）/ 原生 HTML+CSS+JS / **无 pytest、无 npm、无打包器**

## Files and Responsibilities

| File/Module | Action | Responsibility | Notes |
|-------------|--------|----------------|-------|
| `requirements.txt` | Create | 锁定精确运行时版本 | Flask==3.0.3、Werkzeug==3.1.9、requests（版本按镜像实际解析结果锁定） |
| `config.py` | Create | 集中配置 + 环境变量读取 | 默认 `AI_PROVIDER=mock` |
| `app.py` | Create | `create_app()`、注册蓝图与全局错误处理器、建库 | 开发服务器 `127.0.0.1` |
| `core/__init__.py` | Create | 包标记 | 空文件 |
| `core/codes.py` | Create | 24 个错误码常量（含保留码 `FORBIDDEN`）+ `MESSAGES` 中文文案映射 | 全站唯一文案来源 |
| `core/db.py` | Create | 连接管理、`query`/`execute`、5 表 DDL、`init_db` | 唯一持有 SQL 的模块 |
| `core/responses.py` | Create | `ok()` / `fail()` 统一响应构造 | 唯一构造响应体的入口 |
| `core/security.py` | Create | 密码哈希、`login_required`、`current_user`、分享解锁态 | 唯一处理认证的模块 |
| `core/ai/__init__.py` | Create | 包标记 | 空文件 |
| `core/ai/base.py` | Create | `PolishProvider` 抽象 + `get_provider()` | 按配置返回实现 |
| `core/ai/mock.py` | Create | 离线规则化润色（确定性） | 4 条规则 |
| `core/ai/openai_compat.py` | Create | OpenAI 兼容调用 + 异常映射 | 仅此模块用 `requests` |
| `routes/__init__.py` | Create | 包标记 | 空文件 |
| `routes/auth.py` | Create | 注册/登录/退出/me | — |
| `routes/profile.py` | Create | 个人信息更新、收藏列表 | — |
| `routes/notes.py` | Create | 笔记 CRUD、收藏切换、分享管理 | 每条查询带 `user_id` 过滤 |
| `routes/share.py` | Create | 公开读取、密码解锁、评论 | 不返回隐私字段 |
| `routes/ai.py` | Create | 润色状态与润色接口 | 只做校验与错误映射 |
| `routes/pages.py` | Create | 10 条页面路由 | 页面路由不写库 |
| `templates/base.html` | Create | 骨架、顶栏、底栏、块定义 | 所有页面继承 |
| `templates/index.html` | Create | 主页落地页 | 还原设计稿 |
| `templates/login.html` `register.html` | Create | 认证表单 | 就地错误展示 |
| `templates/profile.html` | Create | 个人信息 + 我的笔记 + 我的收藏 + 分享管理 | — |
| `templates/notes_list.html` | Create | 笔记列表 + 筛选 | 三态空状态 |
| `templates/note_edit.html` | Create | 编辑页（分栏 + 润色工具栏） | 移动端标签切换 |
| `templates/note_detail.html` | Create | 羊皮纸详情页 | 签名元素 |
| `templates/share.html` | Create | 分享页（密码锁 + 评论） | 公开访问 |
| `templates/about.html` `404.html` | Create | 关于页、404 页 | 中文文案 |
| `static/css/style.css` | Create | `:root` 设计令牌 + 全部页面样式 + 三断点响应式 | 令牌唯一来源 |
| `static/js/api.js` | Create | `fetch` 封装、`message` 提取、错误展示助手 | 所有页面共用 |
| `static/js/markdown.js` | Create | `marked.parse` + `DOMPurify.sanitize` 封装 | 全局唯一渲染出口 |
| `static/js/editor.js` | Create | 文本域选区读写、预览刷新、防抖 | 暴露选区接口 |
| `static/js/polish.js` | Create | 右键菜单、润色弹窗、状态与替换 | 只经 editor 改文本 |
| `static/js/auth.js` `profile.js` `notes_list.js` `note_edit.js` `note_detail.js` `share.js` | Create | 各页交互 | 统一走 `api.js` |
| `static/vendor/marked.*` `static/vendor/purify.min.js` | Create | 本地 vendored 渲染与净化库 | 版本记入 README |
| `static/img/hero.jpg` `static/img/parchment.jpg` | Create | Hero 实拍图、羊皮纸纹理 | 从素材复制 |
| `tests/smoke_test.py` | Create | 纯 assert 接口断言脚本 | `python tests/smoke_test.py` |
| `start.bat` | Create | 一键启动 | 依赖检查/端口探测/健康轮询/开浏览器 |
| `README.md` | Create | 运行说明、AI 配置、vendored 版本 | — |

## Interface Implementation Map

| Design Decision（源：spec 章节） | Implementation Surface | Verification |
|---|---|---|
| 主页 Hero 双栏 + 金色手绘下划线 + 四宫格卖点（Interface Design Contract / Visual System） | `templates/index.html`、`static/css/style.css`、`static/img/hero.jpg` | 1440 与 375 视口截图对照设计稿 |
| 四宫格卖点新文案「简洁易用 / 分享协作 / 隐私保护 / 评论互动」（已确认决策 7） | `templates/index.html` | 文案逐字核对 + smoke_test 第 9 组静态断言 |
| 编辑页 50/50 分栏 + 移动端「编辑/预览」标签切换（Responsive Rules） | `templates/note_edit.html`、`static/js/editor.js`、`style.css` | 1440 分栏截图、375 标签切换截图 |
| 羊皮纸签名元素 + 正文对比度 ≥ 7:1（Visual System） | `static/img/parchment.jpg`、`style.css`、`templates/note_detail.html` | 1440/375 截图 + 对比度计算 |
| 设计令牌 12 项（Visual System 表） | `static/css/style.css` 的 `:root` | 计算样式核对，全站无硬编码色值 |
| 润色弹窗左右对照 + 右下双按钮（Layout 线框图） | `static/js/polish.js`、`style.css` | 1440 弹窗截图、375 上下堆叠截图 |
| 右键菜单仅一项「AI 润色」+ 键盘等价入口（Accessibility） | `static/js/polish.js`、`templates/note_edit.html` | 手动：Tab 到工具栏按钮可触发；未选中时提示中文 |
| 弹窗焦点锁定 + Esc 关闭 + 焦点回归（Accessibility） | `static/js/polish.js` | 手动键盘走查 |
| 空状态 / 加载中 / 错误态文案（Components, Content, and States） | 各模板与 `api.js` | smoke test 断言 + 375 视口错误态截图 |
| 三断点响应式（Responsive Rules） | `static/css/style.css` | 1440 / 768 / 375 逐项走查清单 |
| 统一错误响应与中文 message（API 与错误码） | `core/codes.py`、`core/responses.py`、`static/js/api.js` | smoke test 第 8 组断言 |

## 计划阶段对设计文档的修正

写计划时做对比度与一致性核算，发现设计文档自身有 4 处问题，**已就地修正 spec**（`docs/specs/2026-10-07-personal-notes-design.md`），实现按修正后的值走：

| # | 问题 | 修正 |
|---|------|------|
| 1 | `--text-muted #7A7168` on `--bg` = 4.36:1，低于自己要求的 4.5:1 | 改为 `#6F665C`（5.13:1） |
| 2 | `--primary #B89B6A` 作为链接色仅 2.41:1、作为主按钮填充配白字仅 2.65:1、作为 focus 描边仅 2.41:1 | 新增 `--primary-strong #7A5C2E` 承载文字（链接/按钮/focus 全达标），`--primary` 降级为纯装饰色；写入「金色分色原则」 |
| 3 | `--danger #B4573F` on `--bg` = 4.37:1 | 改为 `#9E4A34`（5.49:1） |
| 4 | `FORBIDDEN` 的触发场景写「访问/修改他人笔记」，与实现决策「越权一律返回 `NOTE_NOT_FOUND` 避免探测」自相矛盾；错误码总数误写为 25 | `FORBIDDEN` 标注为保留码；总数更正为 24 |

## Phases

### Phase 1: 项目骨架与基础设施
**File:** [phase-1-foundation.md](phase-1-foundation.md)
**Goal:** 得到可启动的最小 Flask 应用：配置、数据库建表、统一响应与错误处理、设计令牌 CSS、前端请求封装、素材就位。
**Tasks:** 5
**Status:** Done
**Completion:** √

### Phase 2: 认证与个人信息
**File:** [phase-2-auth-profile.md](phase-2-auth-profile.md)
**Goal:** 注册、登录、退出、当前用户查询可用，个人主页可查看与编辑个人信息。
**Tasks:** 4
**Status:** Done
**Completion:** √

### Phase 3: 笔记管理与收藏
**File:** [phase-3-notes.md](phase-3-notes.md)
**Goal:** 笔记 CRUD（草稿/发布）、列表筛选、Markdown 分栏编辑、羊皮纸详情、收藏可用。
**Tasks:** 6
**Status:** Done
**Completion:** √

### Phase 4: 分享与评论
**File:** [phase-4-share-comments.md](phase-4-share-comments.md)
**Goal:** 笔记可生成带可选密码的实时分享链接，游客与登录用户均可评论。
**Tasks:** 5
**Status:** Done
**Completion:** √

### Phase 5: AI 润色
**File:** [phase-5-ai-polish.md](phase-5-ai-polish.md)
**Goal:** 编辑页划词右键弹出润色弹窗，Mock 与真实 provider 可切换，「确认替换」精确写回选区。
**Tasks:** 5
**Status:** Done
**Completion:** √

### Phase 6: 主页、关于页与视觉还原
**File:** [phase-6-home-about-visual.md](phase-6-home-about-visual.md)
**Goal:** 主页还原设计稿、关于页与 404 页就位、三断点响应式达标、视觉走查并修正。
**Tasks:** 4
**Status:** Done
**Completion:** √

### Phase 7: 交付收口
**File:** [phase-7-delivery.md](phase-7-delivery.md)
**Goal:** `start.bat` 一键启动可用、README 完整、smoke test 全量通过、DoD 逐项核对。
**Tasks:** 4
**Status:** Done
**Completion:** √
**Residual:** 该阶段文件仍保留 7 个未勾选的验收复选框，全部是需要**浏览器 / 物理断网**才能执行的项（12 步手工演示、物理断网确认、三视口视觉走查、Explorer 双击实测）。实现与全部 CLI 可验证项已完成并逐条核对，详见文末「未验证项（需人工复核）」。

## Dependencies
- **阶段顺序**：1 → 2 → 3 → 4 → 5 → 6 → 7，严格串行。Phase 2 的 `core/security.py` 是 Phase 3/4/5 全部受保护接口的前置；Phase 3 的 `markdown.js` 是 Phase 4 分享页内容渲染与 Phase 6 主页的前置。
- **运行时**：Python 3.12.7（已实测）。运行时依赖仅 Flask / Werkzeug / requests；**不引入 pytest**，测试脚本用纯 assert 并可直接 `python tests/smoke_test.py` 执行。
- **外部网络**：只在两处需要——(1) `pip install` 走 `https://pypi.tuna.tsinghua.edu.cn/simple`；(2) 下载 vendored 的 marked / DOMPurify 走 `https://registry.npmmirror.com`。**应用运行时完全离线**。
- **素材**：`个人笔记主页.jpg`（2560×1440，Hero 实拍原图）、`图片素材/个人笔记-笔记背景.jpg`（1666×944，羊皮纸）、`图片素材/个人笔记-主页截图.jpg`（1666×944，设计稿，仅供对照，不进 `static/`）。
- **AI 默认离线**：`AI_PROVIDER=mock` 无需任何 Key；`openai` 模式需要 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`，未配置时接口返回 `AI_UNAVAILABLE` 且 `available=false`。

## Success Criteria

- [ ] 12 项基础功能 + 划词右键 AI 润色全部可演示（Phase 7 手工演示脚本跑通）——**需浏览器**；CLI 侧已用等价端到端脚本跑通「注册→发布→润色→分享→解锁→评论→收藏」全链路
- [x] `python tests/smoke_test.py` 全部断言通过（25 组 / 1315 断言 / 退出码 0），且失败用例均返回 `code` + 中文 `message`（`errstruct` 组固定 5 个用例逐条断言）
- [ ] 1440 / 768 / 375 三视口视觉走查清单逐项通过，无横向滚动、无内容重叠——**需浏览器**；CLI 侧已断言断点规则、触摸目标、防溢出与对比度（`contrast_check.py` 0 失败）
- [x] 断网状态下 `python app.py` 可完整运行，Markdown 渲染与 AI 润色均可用——等价验证通过：把 `socket.socket.connect` / `socket.create_connection` 打桩为抛异常后仍跑通全链路；静态审计确认全库仅 `core/ai/openai_compat.py` 引用 `requests` 且为延迟导入
- [x] `start.bat` 在干净环境可完成依赖安装并自动打开浏览器——实跑五步日志 + 端口顺延分支（5000 占用时自动改 5001）+ 浏览器打开；仅「Explorer 双击」这一交互形式待人工
- [x] README 记录运行方式、AI 配置、vendored 库版本与来源——九节齐全，版本号与 `static/vendor/VERSIONS.md` 逐条一致

## 未验证项（需人工复核）

以下项目在**本执行环境不可能验证**（无浏览器、无 jsdom、无法物理断网），因此**没有被标记为通过**，交付时需由有图形界面的环境确认：

1. **12 步手工演示**：注册 → 写笔记实时预览 → 划词右键「AI 润色」（左右对照 + 「演示模式」徽标）→「确认替换」+ `Ctrl+Z` 回退 → 收藏 / 发布（羊皮纸 + 实心心形）→ 分享设密码 `pass1234` / 复制链接 → 无痕打开显示「该分享需要密码」→ 错误密码就地提示且保留输入 → 正确密码 + 昵称评论 → `/profile#favorites` →「取消分享」后无痕刷新显示「分享链接无效或已取消」。
2. **三视口视觉走查**（Phase 6 清单 7 项）与截图：主页 Hero 对齐与金色下划线、编辑页分栏与「编辑/预览」标签、羊皮纸纸面保真、润色弹窗上下堆叠、`document.documentElement.scrollWidth - window.innerWidth <= 0`。
3. **键盘与无障碍实测**：Tab 顺序、弹窗焦点锁定不逃逸、`:focus-visible` 描边可见、`prefers-reduced-motion` 实际渲染。
4. **真实 XSS 走查**：`<img src=x onerror=alert(1)>` 与 `[x](javascript:alert(1))` 经 `window.md.render` 后不得含 `onerror` / `javascript:`（`DOMPurify` 在 Node 中不可执行，只有静态契约断言）。
5. **物理断网**后重启应用，确认浏览器控制台无外部请求失败报错（CLI 侧已完成等价的 socket 打桩验证）。
6. **Explorer 双击 `start.bat`** 的真实交互（CLI 以 `cmd //c start.bat` 代替，已通过）。
7. **主页顶部留白**：`main` 的 40px 与 `.hero` 的 40px 叠加成 80px，是否收紧要目视判断。


## Blocking Questions

无。设计文档中的 8 条决策已确认；实现层面需现场解析的两项（requests 与 vendored 库的确切版本）属于「执行时可发现」，已写入对应任务的解析命令，并各有安全默认值（见 Deferred Decisions）。

## Deferred Decisions

| # | 待定项 | 为何可延后 | 安全默认值（实现时先用） |
|---|--------|-----------|------------------------|
| 1 | `requests` 的精确版本号 | 执行时由镜像解析即可确定，不影响架构 | 运行 `python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple requests` 后用 `python -m pip show requests` 读出实际版本，回填到 `requirements.txt` |
| 2 | marked / DOMPurify 的确切版本与包内文件路径 | 执行时查询 npmmirror 元数据即可确定 | 先解析版本号再下载；若两种下载路径都失败，退回**自研最小 Markdown 渲染子集**（标题/加粗/斜体/有序无序列表/引用/行内与围栏代码/链接/图片/分隔线）+ 白名单净化，功能不减但样式能力下降，并记入 README |
| 3 | 素材图片是否压缩 | 本地演示带宽无限，不影响功能 | 直接复制原图（hero 1.5MB、parchment 987KB）；若实现期环境已有 Pillow，则顺带压到宽 1280px / 质量 85 |
| 4 | `core/responses.py` 的 `fail()` 签名 | spec 写的是 `fail(code, message, http)`，逐处传 message 会重复 24 条中文文案 | 收敛为 `fail(code, http=None)`，文案从 `core/codes.py::MESSAGES` 查表；语义与 spec 一致（仍是中文 message），仅去掉重复参数 |
| 5 | 是否引入 CSRF 令牌 | 已在 spec Deferred 表记录，本地单用户场景风险可接受 | 不引入，依赖 `SameSite=Lax` + JSON Content-Type |
| 6 | Mock 润色规则细节 | 规则集合已定，逐条正则在实现时微调；本条允许「演示效果不理想时增补规则」 | **已增补并落地为 6 条规则**：空白归一 → 去除汉字间空格 → 中英文标点规范 → 合并重复标点 → 句末标点补全 → 相邻重复词去除。原因：原 4 条规则会把示例输入润色成 `这是 一段，,需要润色的文字。`，既留汉字间空格又出现 `，,` 混用标点，演示观感像故障。增补后示例输出回到计划给定的 `这是一段，需要润色的文字。`，且二次润色结果稳定（幂等） |
| 7 | 笔记标题长度上限 | 无实际输入压力 | 前后端都不设硬上限，仅前端提示建议 ≤ 100 字 |
| 8 | 「关于」页正文 | 内容可替换，不影响结构 | 项目简介 + 功能列表 + 技术栈 + 本地演示免责说明 |
