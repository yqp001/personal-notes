# 个人笔记

一个可本地运行、可离线演示的「个人笔记」Web 应用：用 Markdown 写作、实时预览，支持草稿与发布、划词 AI 润色、收藏、带密码的链接分享与评论互动。

## 项目简介

个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感、珍藏生活中的美好瞬间。核心能力（与站内 `/about` 页一致）：

- 注册与登录
- Markdown 写作与实时预览
- 草稿与发布
- 划词 AI 润色
- 笔记收藏
- 链接分享（可设密码）
- 评论互动

说明：应用本身**不内置任何演示账号**，首次运行时请自行注册一个账号。笔记默认私有，只有生成分享链接后才能被他人查看。

## 环境要求

- Windows 10/11
- Python 3.10 及以上（本项目实测环境为 **3.12.7**）
- 无需 Node.js、无需任何前端构建工具

## 快速开始

**方式一：一键启动（推荐）**

双击项目根目录下的 `start.bat`。它会依次检查 Python → 安装依赖（清华源）→ 探测可用端口 → 启动服务 → 自动打开浏览器。

**方式二：手动启动**

在项目根目录的命令行中执行：

```bat
python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
python app.py
```

然后在浏览器打开 <http://127.0.0.1:5000/>。

启动后建议先设置一个固定的会话密钥（否则每次重启都会使登录态失效）：

```bat
set NOTEBOOK_SECRET_KEY=请替换为你自己的随机字符串
```

## 目录结构

```
prompt2/
├─ app.py                     # 入口：create_app() + 开发服务器启动
├─ config.py                  # 配置：SECRET_KEY、DB_PATH、AI_* 环境变量读取
├─ requirements.txt           # 锁定精确运行时版本
├─ start.bat                  # 一键启动：依赖检查 → 安装 → 端口探测 → 启动 → 开浏览器
├─ README.md                  # 本文件
├─ core/
│  ├─ db.py                   # sqlite3 连接管理、query/execute、建表与初始化
│  ├─ security.py             # 密码哈希、登录守卫、分享密码哈希
│  ├─ responses.py            # ok() / fail() 统一响应构造
│  ├─ codes.py                # 错误码常量与中文文案
│  └─ ai/
│     ├─ base.py              # PolishProvider 抽象 + get_provider() 工厂
│     ├─ mock.py              # MockProvider：离线规则化润色（默认）
│     └─ openai_compat.py     # OpenAICompatProvider：真实调用（仅此模块用 requests）
├─ routes/
│  ├─ auth.py  profile.py     # /api/auth/*、/api/profile、/api/favorites
│  ├─ notes.py share.py ai.py # 笔记、公开分享与评论、AI 润色接口
│  └─ pages.py                # 页面路由（渲染 Jinja2 模板）
├─ templates/                 # base / index / login / register / profile /
│                             # notes_list / note_edit / note_detail / share / about / 404
├─ static/
│  ├─ css/style.css           # 设计令牌 + 全部页面样式
│  ├─ js/                     # 每页一个模块 + api.js / markdown.js / editor.js / polish.js
│  ├─ vendor/                 # marked.min.js、purify.min.js（本地引入，附 VERSIONS.md）
│  └─ img/                    # hero.jpg、parchment.jpg
├─ data/notebook.db           # SQLite（首次启动自动建库建表）
└─ tests/smoke_test.py        # 接口断言（另含 tests/contrast_check.py 对比度核验）
```

## AI 润色配置

润色由 `core/ai/` 下的 provider 抽象承载，通过环境变量切换，无需改动任何路由代码。

**默认 `AI_PROVIDER=mock`：完全离线。** 用确定性的规则化方式演示润色流程，不做任何网络请求；润色弹窗标题旁会显示「演示模式」徽标。

**切换真实服务：** 设置下列环境变量后重启应用。

| 变量 | 说明 |
|---|---|
| `AI_PROVIDER` | 改为 `openai` |
| `AI_BASE_URL` | 服务商地址，如 `https://api.deepseek.com/v1`（需兼容 `/chat/completions`） |
| `AI_API_KEY` | 服务商密钥 |
| `AI_MODEL` | 模型名 |
| `AI_TIMEOUT` | 超时秒数，默认 15 |
| `AI_MAX_CHARS` | 单次润色字数上限，默认 2000 |
| `AI_TEMPERATURE` | 采样温度，默认 0.3（可选） |

> **隐私提示：** 启用真实服务后，被选中的文本会发送至你配置的服务商；Mock 模式不进行任何网络请求。`AI_API_KEY` 只从环境变量读取，不会写入模板、日志或前端响应。

## 依赖与版本锁定

运行时依赖在 `requirements.txt` 中锁定精确版本：

| 依赖 | 版本 | 用途 |
|---|---|---|
| `Flask` | 3.0.3 | Web 框架 |
| `Werkzeug` | 3.1.9 | 密码哈希、开发服务器等 |
| `requests` | 2.34.2 | 仅 `openai` provider 使用 |

前端第三方库**本地 vendored**（见 `static/vendor/`，版本与来源同时记录在 `static/vendor/VERSIONS.md`）：

| 库 | 版本 | 来源 |
|---|---|---|
| `marked` | 18.1.0 | `https://registry.npmmirror.com/marked/-/marked-18.1.0.tgz` |
| `DOMPurify` | 3.4.16 | `https://registry.npmmirror.com/dompurify/-/dompurify-3.4.16.tgz` |

两者均通过普通 `<script>` 标签以本地路径引入，**不通过 CDN 加载**，以保证断网可运行。Markdown 渲染输出一律经 `DOMPurify` 净化。

## 测试

```bat
python tests/smoke_test.py
python tests/contrast_check.py
```

- `tests/smoke_test.py`：以 Flask `test_client` 对全部关键接口做断言（使用独立临时数据库，不会污染 `data/notebook.db`）。全部通过时退出码为 0，任一检查失败为 1。
- `tests/contrast_check.py`：按 WCAG 相对亮度公式核验正文 / 链接 / 按钮等的颜色对比度，全部达标退出码为 0。

## 常见问题

- **端口被占：** `start.bat` 会自动从 5000 起向后顺延到空闲端口；手动启动时可用 `set NOTEBOOK_PORT=5001` 指定端口。
- **数据库重置：** 删除 `data/notebook.db` 后重启应用，会重新建库建表（数据清空）。
- **登录态失效：** 未设置 `NOTEBOOK_SECRET_KEY` 时会使用随机密钥，重启后登录态失效；设置该变量为一个固定值即可保持登录。

## 已知边界（非目标）

以下明确不在本项目范围内：

- 邮箱验证、找回密码、验证码、第三方登录
- 头像上传（仅含文字信息与简介）
- 公开笔记广场、笔记发现、搜索、标签、分类
- WYSIWYG 富文本编辑
- 笔记版本历史、逐行 diff、回滚
- 点赞、关注、@ 提醒、评论回复嵌套、评论审核后台
- 真实生产部署（HTTPS、多进程、Nginx、Docker）
- AI 流式输出（SSE）、多轮对话、润色风格选择器
- 移动端 App、PWA、推送
