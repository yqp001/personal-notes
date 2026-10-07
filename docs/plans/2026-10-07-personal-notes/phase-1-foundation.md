# Phase 1: 项目骨架与基础设施

**Goal:** 得到一个可启动的最小 Flask 应用：配置就绪、5 张表自动建好、统一响应与中文错误处理可用、设计令牌 CSS 与 base 模板可用、前端请求封装就位、素材图片进入 `static/img/`。
**Prerequisites:** 无（首发阶段）
**Deliverables:** 可 `python app.py` 启动的应用骨架；`/` 返回占位页 200；`/api/unknown` 返回 `{"code":"NOT_FOUND","message":"页面不存在"}`；`data/notebook.db` 含 5 张表。

**Interface Decisions Implemented:** 设计令牌 12 项（spec Visual System 表）；base.html 语义骨架与顶栏/底栏（spec Accessibility：`<header>/<nav>/<main>/<footer>`）；`Content-Type: text/html; charset=utf-8`（spec Goals：全程 UTF-8）。

---

## Task 1: 建立依赖清单与项目骨架

**Goal:** 锁定依赖版本、建立目录树、让 `python app.py` 能起一个空应用。

**Files:**
- Create: `requirements.txt`
- Create: `config.py`
- Create: `app.py`
- Create: `core/__init__.py`、`routes/__init__.py`、`core/ai/__init__.py`（空文件）
- Create: `data/`（空目录；`core/db.py` 会在启动时自动创建）、`tests/`、`templates/`、`static/css/`、`static/js/`、`static/vendor/`、`static/img/` 目录

**Steps:**
- [x] 解析 `requests` 的实际版本（不猜版本号）：

```bash
python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple requests
python -m pip show requests | grep -i "^Version:"
```

  - Expected: 输出一行 `Version: 2.3x.x`，记下该值用于下一步。

- [x] 写 `requirements.txt`，用上面读到的实际版本替换 `<REQUESTS_VERSION>`：

```
Flask==3.0.3
Werkzeug==3.1.9
requests==<REQUESTS_VERSION>
```

  - 说明：Flask 3.0.3 / Werkzeug 3.1.9 是当前环境实测已装且兼容 Python 3.12.7 的组合。

- [x] 写 `config.py`：

```python
import os
import secrets

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Config:
    SECRET_KEY = os.environ.get("NOTEBOOK_SECRET_KEY") or secrets.token_hex(16)
    DB_PATH = os.environ.get("NOTEBOOK_DB_PATH") or os.path.join(BASE_DIR, "data", "notebook.db")

    AI_PROVIDER = os.environ.get("AI_PROVIDER", "mock")          # mock | openai
    AI_BASE_URL = os.environ.get("AI_BASE_URL", "")
    AI_API_KEY = os.environ.get("AI_API_KEY", "")
    AI_MODEL = os.environ.get("AI_MODEL", "")
    AI_TIMEOUT = int(os.environ.get("AI_TIMEOUT", "15"))
    AI_MAX_CHARS = int(os.environ.get("AI_MAX_CHARS", "2000"))
    AI_TEMPERATURE = float(os.environ.get("AI_TEMPERATURE", "0.3"))
```

  - `SECRET_KEY` 使用随机回退值时，在 `app.py` 启动日志打印一行警告：`[警告] 未设置 NOTEBOOK_SECRET_KEY，本次使用随机密钥，重启后登录态失效`。

- [x] 写 `app.py` 骨架：`create_app()` 应用工厂、`from_object(Config)`、注册 `pages_bp`（此任务先只挂一个返回占位 HTML 的 `/`）、启动块 `app.run(host="127.0.0.1", port=<PORT>)`。

- [x] Run: `python app.py`（后台运行）
  - Expected: 控制台打印监听地址；`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/` 输出 `200`。

**Security/Boundary Notes:** `config.py` 是唯一读取环境变量的模块；`AI_API_KEY` 只在此出现，不得写进模板、日志或前端响应。

**Dependencies:** 需要在实现机上安装 `requests`（清华源）。

---

## Task 2: 数据库连接与建表

**Goal:** `core/db.py` 提供连接管理与唯一的 SQL 出入口，首次启动自动建 5 张表。

**Files:**
- Create: `core/db.py`
- Modify: `app.py`（注册 `init_db` 与请求结束关连接）

**Steps:**
- [x] 在 `core/db.py` 写 `SCHEMA`：逐字采用 spec「数据模型」章节的 5 段 `CREATE TABLE` 与 2 条 `CREATE INDEX`，全部改为 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`。

- [x] 在 `core/db.py` 写公共接口（这是本模块的全部对外面）：

```python
def get_db(): ...          # 惰性建连接；sqlite3.connect(cfg.DB_PATH)，row_factory = sqlite3.Row
                           # 连接建立后立即执行 PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL
def close_db(exc=None): ...   # 请求结束关闭，注册到 app.teardown_appcontext
def init_db(): ...            # executescript(SCHEMA)，幂等
def query(sql, args=()) -> list[sqlite3.Row]: ...
def execute(sql, args=()) -> sqlite3.Cursor: ...   # 执行后 commit，返回 cursor（取 lastrowid / rowcount）
def now_iso() -> str: ...      # datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
```

- [x] 确保 `data/` 目录不存在时自动创建（`os.makedirs(os.path.dirname(cfg.DB_PATH), exist_ok=True)`）。

- [x] Run: `python -c "import app; a=app.create_app(); import sqlite3,config; c=sqlite3.connect(config.Config.DB_PATH); print(sorted(r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")))"`
  - Expected: `['comments', 'favorites', 'notes', 'shares', 'users']`

- [x] Run: 连续执行上一条命令两次
  - Expected: 第二次不报错（幂等）。

**Security/Boundary Notes:** 所有 SQL 必须用 `?` 占位符；`core/db.py` 之外不得出现 `sqlite3.connect`。

---

## Task 3: 错误码、统一响应与全局错误处理

**Goal:** 24 个错误码与其中文文案集中定义，所有 API 失败响应结构一致。

**Files:**
- Create: `core/codes.py`、`core/responses.py`
- Modify: `app.py`（注册 `errorhandler`）

**Steps:**
- [x] 写 `core/codes.py`：为 spec「错误码表」中每一行定义一个模块级常量，并建立 `MESSAGES` 映射（key 为 code 字符串，value 为表里「message（前端展示）」列的**逐字**文案）。示例形态：

```python
OK = "OK"
INVALID_PARAMS = "INVALID_PARAMS"
EMAIL_EXISTS = "EMAIL_EXISTS"
# ... 共 24 项（含 OK）；FORBIDDEN 为保留码，本版不产生该响应，但常量与文案仍需定义

MESSAGES = {
    OK: "操作成功",
    INVALID_PARAMS: "请求参数不完整或格式不正确",
    EMAIL_EXISTS: "该邮箱已被注册",
    # ... 与 spec 表格逐字一致
}

HTTP_STATUS = {          # spec 表格第三列
    INVALID_PARAMS: 400, EMAIL_EXISTS: 409, EMAIL_INVALID: 400,
    USERNAME_REQUIRED: 400, PASSWORD_TOO_SHORT: 400, PASSWORD_MISMATCH: 400,
    LOGIN_FAILED: 401, AUTH_REQUIRED: 401, FORBIDDEN: 403,
    NOTE_NOT_FOUND: 404, NOTE_TITLE_REQUIRED: 400,
    COMMENT_EMPTY: 400, NICKNAME_REQUIRED: 400, COMMENT_TOO_LONG: 400,
    SHARE_NOT_FOUND: 404, SHARE_PASSWORD_REQUIRED: 401, SHARE_PASSWORD_WRONG: 401,
    AI_EMPTY_TEXT: 400, AI_TOO_LONG: 400, AI_UNAVAILABLE: 502, AI_TIMEOUT: 504,
    NOT_FOUND: 404, INTERNAL_ERROR: 500,
}
```

- [x] 写 `core/responses.py`：

```python
def ok(data=None, http=200):
    return jsonify({"code": codes.OK, "message": codes.MESSAGES[codes.OK], "data": data}), http

def fail(code, http=None, message=None):
    status = http or codes.HTTP_STATUS.get(code, 400)
    return jsonify({"code": code,
                    "message": message or codes.MESSAGES.get(code, "请求失败"),
                    "data": None}), status
```

  - `jsonify` 默认输出 `application/json`；Flask 会自动带 `charset=utf-8`。

- [x] 在 `app.py` 注册：`errorhandler(404)` 在请求路径以 `/api/` 开头时返回 `fail(codes.NOT_FOUND)`，否则渲染 `404.html`；`errorhandler(Exception)` 记录 `app.logger.exception` 后返回 `fail(codes.INTERNAL_ERROR)`。

- [x] Run: `python -c "import app; c=app.create_app().test_client(); r=c.get('/api/unknown'); print(r.status_code, r.get_json())"`
  - Expected: `404 {'code': 'NOT_FOUND', 'message': '页面不存在', 'data': None}`

**Security/Boundary Notes:** `errorhandler(Exception)` 必须是兜底且不返回堆栈；`message` 是唯一允许出现在用户可见提示中的字段。

---

## Task 4: 设计令牌、base 模板与素材就位

**Goal:** 全站样式基础可用，base.html 提供语义骨架与顶栏/底栏，三张素材按固定文件名进入 `static/img/`。

**Files:**
- Create: `static/css/style.css`、`templates/base.html`
- Create: `static/img/hero.jpg`（复制自 `个人笔记主页.jpg`）、`static/img/parchment.jpg`（复制自 `图片素材/个人笔记-笔记背景.jpg`）
- Modify: `routes/pages.py`、`app.py`（注册 `pages_bp`）

**Steps:**
- [x] 复制素材（文件名固定，后续所有引用都用这两个名字）：

```bash
cp "个人笔记主页.jpg" static/img/hero.jpg
cp "图片素材/个人笔记-笔记背景.jpg" static/img/parchment.jpg
ls -l static/img/
```

  - Expected: 两个文件存在，hero.jpg 约 1.5MB、parchment.jpg 约 987KB。
  - 注意：`图片素材/个人笔记-主页截图.jpg` 是**设计稿**，不复制进 `static/`。若环境已装 Pillow，可顺带把 hero 压到宽 1280px、质量 85（可选，见计划 Deferred #3）。

- [x] 在 `static/css/style.css` 顶部写 `:root`，令牌名与值逐条对应 spec「设计令牌」表：

```css
:root{
  --bg:#F7F4EE; --surface:#FFFFFF;
  --primary:#B89B6A;                 /* 仅装饰：图标底、徽标、下划线、装饰边框 */
  --primary-strong:#7A5C2E;          /* 承载文字：主按钮填充、链接、focus 描边 */
  --primary-strong-hover:#6A4F26;
  --accent:#F2C94C;
  --text:#3D3730; --text-muted:#6F665C; --border:#E8E1D5;
  --parchment-ink:#4A3B2A; --danger:#9E4A34;
  --radius:10px; --radius-btn:8px;
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:40px;
  --shadow:0 2px 12px rgba(61,55,48,.08);
  --font-serif:"Songti SC","STSong","SimSun","Noto Serif SC",serif;
  --font-script:"Segoe Script","Bradley Hand",cursive;
  --font-sans:-apple-system,"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif;
  --font-mono:"Cascadia Mono",Consolas,"Courier New",monospace;
}
```

  注意 **金色分色原则**（spec Accessibility 已记录）：`--primary` 只用于形状与底色，任何承载文字的场合一律用 `--primary-strong`；否则白字/链接对比度只有 2.4–2.6:1，无法达到 AA。

  之后写基础样式：`body` 用 `--bg`/`--font-sans`、`*{box-sizing:border-box}`、正文 `color:var(--text)`、链接 `a{color:var(--primary-strong)}`、`:focus-visible{outline:2px solid var(--primary-strong);outline-offset:2px}`、`transition:.18s ease` 的通用规则，以及 `@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}`。

- [x] 在 `static/css/style.css` 定义两个按钮基类（全站唯一来源，后续阶段只加类名不重复写色值）：

```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);
     min-height:44px;padding:0 var(--space-4);border-radius:var(--radius-btn);
     font-size:15px;font-family:var(--font-sans);cursor:pointer;border:1px solid transparent;transition:.18s ease}
.btn-primary{background:var(--primary-strong);color:#FFFFFF}
.btn-primary:hover{background:var(--primary-strong-hover)}
.btn-primary:disabled{opacity:.55;cursor:not-allowed}
.btn-ghost{background:transparent;color:var(--text);border-color:var(--border)}
.btn-ghost:hover{background:var(--bg)}
.btn[disabled]{pointer-events:none}
```

- [x] 写 `templates/base.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% block title %}个人笔记{% endblock %}</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">个人笔记</a>
    <nav class="site-nav">
      {% if current_user %}
        <a href="/notes/new">写笔记</a><a href="/notes">我的笔记</a>
        <a href="/profile#favorites">我的收藏</a><a href="/profile">个人主页</a>
        <button type="button" id="logout-btn">退出</button>
      {% else %}
        <a href="/login">登录</a><a href="/register">注册</a><a href="/about">关于</a>
      {% endif %}
    </nav>
  </header>
  <main>{% block content %}{% endblock %}</main>
  <footer class="site-footer"><span>个人笔记 · 用文字记录生活</span><a href="/about">关于</a></footer>
  <script src="{{ url_for('static', filename='js/api.js') }}"></script>
  {% block scripts %}{% endblock %}
</body>
</html>
```

- [x] 在 `app.py` 注册上下文处理器，供 `base.html` 使用：

```python
@app.context_processor
def inject_user():
    return {"current_user": current_user()}   # core/security.py 提供；Phase 1 先返回 None 占位
```

- [x] 写 `routes/pages.py`：`pages_bp = Blueprint("pages", __name__)`，先实现 10 条路由的**占位渲染**（模板文件不存在时先各建一个只 `{% extends "base.html" %}` + `{% block title %}` 的最小文件，避免 500）。

- [x] Run: `python -c "import app; c=app.create_app().test_client(); [print(p, c.get(p).status_code) for p in ['/','/login','/register','/profile','/notes','/notes/new','/notes/1','/notes/1/edit','/about','/share/x']]"`
  - Expected: 全部 200（`/notes/1`、`/notes/1/edit`、`/share/x` 此阶段为占位页 200，Phase 3/4 再改为真实行为）。

- [x] Run: `curl -s -I http://127.0.0.1:5000/static/img/parchment.jpg | head -3`
  - Expected: 首行 `HTTP/1.1 200 OK`，并含 `Content-Type: image/jpeg`。

**Security/Boundary Notes:** `base.html` 不得内联任何用户数据；Jinja2 自动转义保持开启（不要使用 `|safe`）。

---

## Task 5: 前端请求封装 `api.js`

**Goal:** 全站唯一的 fetch 与错误展示入口，保证「前端只展示 message」。

**Files:**
- Create: `static/js/api.js`

**Steps:**
- [x] 实现并挂到 `window.api`：

```js
// 统一请求：成功返回 {ok:true, data}；失败返回 {ok:false, code, message}
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload;
  try { payload = await res.json(); }
  catch { return { ok: false, code: "INTERNAL_ERROR", message: "服务器返回了无法解析的内容" }; }
  if (payload.code === "OK") return { ok: true, data: payload.data };
  return { ok: false, code: payload.code, message: payload.message || "请求失败" };
}
window.api = {
  get: (u) => request("GET", u),
  post: (u, b) => request("POST", u, b),
  put: (u, b) => request("PUT", u, b),
  del: (u, b) => request("DELETE", u, b === undefined ? undefined : b),
  // 就地展示：把 message 写进给定元素并加 .form-error 样式
  showError(el, message) { if (!el) return; el.textContent = message; el.className = "form-error"; el.hidden = false; },
  clearError(el) { if (el) { el.textContent = ""; el.hidden = true; } },
  // 顶栏退出（base.html 的 #logout-btn）
  bindLogout() {
    const btn = document.getElementById("logout-btn");
    if (btn) btn.addEventListener("click", async () => {
      const r = await window.api.post("/api/auth/logout");
      if (r.ok) location.href = "/";
    });
  },
};
window.api.bindLogout();
```

- [x] 在 `static/css/style.css` 加 `.form-error{color:var(--danger);font-size:13px;margin-top:var(--space-2)}`。

- [x] Run: `python app.py` 后浏览器打开 `/`，控制台执行 `await window.api.get('/api/unknown')`
  - Expected: 返回 `{ok:false, code:"NOT_FOUND", message:"页面不存在"}`，且控制台无未捕获异常。

- [x] Run: 在首页点击顶栏「退出」
  - Expected: 无 JS 报错（未登录时按钮不存在；已登录时 Phase 2 接完才有效）。

**Security/Boundary Notes:** 只走同源相对路径，不拼接外部域名；不把 `code` 直接展示给用户（只展示 `message`）。

---

## Phase Completion Checklist

- [x] 全部 5 个任务完成
- [x] `python app.py` 可启动，`/` 返回 200
- [x] `data/notebook.db` 自动创建且含 users / notes / shares / comments / favorites 五张表
- [x] `/api/unknown` 返回统一错误结构（`NOT_FOUND` + 中文 message）
- [x] `static/img/hero.jpg` 与 `static/img/parchment.jpg` 就位且 HTTP 200
- [x] `style.css` 的 `:root` 含 spec 全部令牌
- [x] 准备进入 Phase 2
