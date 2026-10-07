# Phase 2: 认证与个人信息

**Goal:** 注册、登录、退出、查询当前用户四个接口可用；个人主页可查看并编辑个人信息；前端表单的就地中文错误提示可用；测试脚本骨架建立。
**Prerequisites:** Phase 1 完成（config、db、responses、base 模板、api.js 就位）
**Deliverables:** `tests/smoke_test.py` 的第 1、2 组断言通过；`/register`、`/login`、`/profile` 三个页面可交互；顶栏「退出」生效。

**Interface Decisions Implemented:** 未登录顶栏「登录 / 注册 / 关于」（spec Components 表）；表单就地校验与 `message` 展示（spec Components / Error Handling）；「去登录」恢复路径（spec 主要旅程 6）；`AUTH_REQUIRED` 跳转登录后回原页（spec Error Handling）。

---

## Task 1: `core/security.py` 认证工具

**Goal:** 密码哈希、登录态与分享解锁态的唯一实现。

**Files:**
- Create: `core/security.py`
- Modify: `app.py`（把 Phase 1 的占位上下文处理器换成真实 `current_user`）

**Steps:**
- [x] 实现公共接口（本模块全部对外面）：

```python
from functools import wraps
from flask import session, g
from werkzeug.security import generate_password_hash, check_password_hash
import core.db as db
import core.codes as codes
from core.responses import fail

def hash_password(raw: str) -> str:            # generate_password_hash(raw, method="pbkdf2:sha256")
def verify_password(raw, hashed) -> bool:
def hash_share_password(raw: str) -> str:      # 同上，独立命名以免混用
def verify_share_password(raw, hashed) -> bool:

def current_user():                            # g._user 缓存；session 无 user_id 返回 None
    #  返回 dict：{"id", "email", "username", "bio"}（不返回 password_hash）

def login_user(user_id: int) -> None:          # session["user_id"] = user_id；g._user = None
def logout_user() -> None:                     # session.pop("user_id", None)；g._user = None

def login_required(view):                      # 未登录 → fail(codes.AUTH_REQUIRED)；调用前不执行 view

def set_share_unlocked(token: str) -> None:     # session.setdefault("unlocked_shares", []); 去重追加
def is_share_unlocked(token: str) -> bool:
```

- [x] `app.py` 修改：

```python
from core.security import current_user, logout_user

@app.context_processor
def inject_user():
    return {"current_user": current_user()}
```

  同时注册 `app.teardown_appcontext(lambda exc=None: (logout_user() if False else None))` —— 不需要；仅保留 `core.db.close_db` 的 teardown。

- [x] Run: `python -c "from core.security import hash_password, verify_password; h=hash_password('abc123'); print(h.split('$')[0], verify_password('abc123',h), verify_password('x',h))"`
  - Expected: `pbkdf2:sha256 True False`

**Security/Boundary Notes:** 密码与分享密码一律不落明文；`current_user()` 的返回值必须显式剔除 `password_hash`，不得直接返回 `sqlite3.Row`。

---

## Task 2: 认证接口（测试先行）

**Goal:** 四个认证接口按 spec 的错误码与中文文案工作。

**Files:**
- Create: `tests/smoke_test.py`
- Create: `routes/auth.py`
- Modify: `app.py`（注册 `auth_bp`；确保应用实例只在 `if __name__ == "__main__":` 内创建）

**Steps:**
- [x] 写 `tests/smoke_test.py` 的骨架（后续阶段在末尾追加分组）：

```python
import os, sys, tempfile, json

# 必须在 import app 之前设置，避免污染真实 data/notebook.db
_tmpdir = tempfile.mkdtemp(prefix="notebook_test_")
os.environ["NOTEBOOK_DB_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["NOTEBOOK_SECRET_KEY"] = "test-secret"
os.environ["AI_PROVIDER"] = "mock"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module

PASS, FAIL = [], []
def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + ("" if cond else f"  -> {extra}"))

app = app_module.create_app()
app.config["TESTING"] = True
client = app.test_client()

def j(resp):
    try: return resp.get_json()
    except Exception: return {}

def post(path, body): return client.post(path, json=body)
def get(path):        return client.get(path)

def section(title): print(f"\n== {title} ==")

# 每组断言追加在文件末尾（见各阶段任务）
```

- [x] 写第 1、2 组断言（先写测试，再实现）：

```python
section("1. 静态与页面")
for path in ["/", "/login", "/register", "/about"]:
    r = client.get(path)
    check(f"页面 {path} 返回 200", r.status_code == 200, r.status_code)
    check(f"页面 {path} 为 utf-8 html", "text/html" in r.headers.get("Content-Type", ""), r.headers.get("Content-Type"))
for asset in ["/static/css/style.css", "/static/js/api.js", "/static/img/hero.jpg", "/static/img/parchment.jpg"]:
    check(f"静态资源 {asset} 返回 200", client.get(asset).status_code == 200)

section("2. 认证")
r = post("/api/auth/register", {"email": "a@b.com", "username": "阿黎", "password": "abc123", "confirm_password": "abc123"})
check("注册成功 code=OK", j(r).get("code") == "OK", j(r))
check("注册后即登录", j(get("/api/auth/me")).get("data", {}).get("user", {}).get("email") == "a@b.com")
r = post("/api/auth/register", {"email": "A@B.com", "username": "另一个", "password": "abc123", "confirm_password": "abc123"})
check("重复邮箱（大小写不敏感）→ EMAIL_EXISTS", j(r).get("code") == "EMAIL_EXISTS", j(r))
r = post("/api/auth/register", {"email": "bad-email", "username": "x", "password": "abc123", "confirm_password": "abc123"})
check("非法邮箱 → EMAIL_INVALID", j(r).get("code") == "EMAIL_INVALID", j(r))
r = post("/api/auth/register", {"email": "c@d.com", "username": "x", "password": "abc", "confirm_password": "abc"})
check("密码过短 → PASSWORD_TOO_SHORT", j(r).get("code") == "PASSWORD_TOO_SHORT", j(r))
r = post("/api/auth/register", {"email": "c@d.com", "username": "x", "password": "abc123", "confirm_password": "abc124"})
check("两次密码不一致 → PASSWORD_MISMATCH", j(r).get("code") == "PASSWORD_MISMATCH", j(r))
r = post("/api/auth/register", {"email": "c@d.com", "username": "  ", "password": "abc123", "confirm_password": "abc123"})
check("用户名为空 → USERNAME_REQUIRED", j(r).get("code") == "USERNAME_REQUIRED", j(r))
client.post("/api/auth/logout")
r = post("/api/auth/login", {"email": "a@b.com", "password": "wrong"})
check("错误密码 → LOGIN_FAILED", j(r).get("code") == "LOGIN_FAILED", j(r))
r = post("/api/auth/login", {"email": "nobody@b.com", "password": "abc123"})
check("不存在的邮箱同样返回 LOGIN_FAILED", j(r).get("code") == "LOGIN_FAILED", j(r))
r = post("/api/auth/login", {"email": "a@b.com", "password": "abc123"})
check("正确凭据登录成功", j(r).get("code") == "OK", j(r))
r = get("/api/notes")
check("未登录访问受保护接口 → AUTH_REQUIRED", j(r).get("code") in ("AUTH_REQUIRED", "NOT_FOUND"), j(r))
r = post("/api/auth/logout")
check("退出返回 OK", j(r).get("code") == "OK", j(r))
check("退出后 me 返回 user=null", j(get("/api/auth/me")).get("data", {}).get("user") is None)
```

  - 注意：`/api/notes` 在 Phase 2 尚未实现，该断言接受 `NOT_FOUND`，Phase 3 实现后自动收紧为只接受 `AUTH_REQUIRED`（届时把 `in (...)` 改成 `==`）。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 1 组通过；第 2 组全部 `[FAIL]`（接口 404），末尾汇总有失败数。

- [x] 实现 `routes/auth.py`：`auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")`，四个接口：

| 接口 | 校验顺序 |
|---|---|
| `POST /register` | 字段齐全（否则 `INVALID_PARAMS`）→ 邮箱正则 `^[^@\s]+@[^@\s]+\.[^@\s]+$`（否则 `EMAIL_INVALID`）→ `username.strip()` 非空（否则 `USERNAME_REQUIRED`）→ `len(password) >= 6`（否则 `PASSWORD_TOO_SHORT`）→ `password == confirm_password`（否则 `PASSWORD_MISMATCH`）→ 邮箱入库查重（`COLLATE NOCASE` 生效，重复则 `EMAIL_EXISTS`）→ 插入 → `login_user(id)` → `ok({...}, 201)` |
| `POST /login` | 字段齐全 → 按邮箱查用户 → 不存在或密码错 → `LOGIN_FAILED`（**两种情况返回同一 code**）→ 否则 `login_user` + `ok` |
| `POST /logout` | `logout_user()` → `ok()` |
| `GET /me` | 返回 `ok({"user": current_user()})`（未登录时 `user` 为 `None`，HTTP 200，不报错） |

- [x] 在 `app.py` 注册 `auth_bp`，并确认应用实例创建语句位于 `if __name__ == "__main__":` 内（测试通过 `create_app()` 自建实例）。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 1、2 组全部 `[OK]`，汇总 `失败 0`。

**Security/Boundary Notes:** 注册与登录的失败响应不得泄漏「邮箱是否存在」；`LOGIN_FAILED` 文案固定为「邮箱或密码错误」。不要记录明文密码到日志。

---

## Task 3: 登录与注册页面

**Goal:** 两个表单页可用，服务端 `message` 就地展示，并有「去登录 / 去注册」互跳。

**Files:**
- Create: `templates/login.html`、`templates/register.html`、`static/js/auth.js`
- Modify: `static/css/style.css`（表单样式）、`routes/pages.py`（已登录访问 `/login` `/register` 时 302 到 `/profile`）

**Steps:**
- [x] 写两个模板，均 `{% extends "base.html" %}`，卡片居中（`.auth-card`），字段带 `<label>` 与错误容器：

```html
<form id="register-form" novalidate>
  <label for="email">邮箱</label>
  <input id="email" name="email" type="email" autocomplete="email" required>
  <label for="username">用户名</label>
  <input id="username" name="username" autocomplete="nickname" required>
  <label for="password">密码</label>
  <input id="password" name="password" type="password" autocomplete="new-password" required>
  <label for="confirm_password">确认密码</label>
  <input id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" required>
  <p class="form-error" id="form-error" hidden></p>
  <button type="submit" class="btn btn-primary">注册</button>
  <p class="auth-alt">已有账号？<a href="/login">去登录</a></p>
</form>
```

  - 登录页同理，字段为 `email` / `password`，底部为「还没有账号？<a href="/register">去注册</a>」。
  - 页面标题：注册页 `<title>注册 · 个人笔记</title>`，登录页 `<title>登录 · 个人笔记</title>`。

- [x] 写 `static/js/auth.js`：提交时按钮文字改「注册中…」并 `disabled`；请求 `POST /api/auth/register`（或 `/api/auth/login`）；`r.ok` 时 `location.href = "/notes/new"`（注册）或 `location.href = "/notes"`（登录）；失败时 `api.showError(errorEl, r.message)`，恢复按钮；同时在对应字段上加 `aria-invalid="true"`。

- [x] 前端预校验（与服务端规则一致，但**服务端仍必须校验**）：邮箱格式、用户名非空、密码 ≥ 6、两次一致；任一不通过就地提示并阻止提交。

- [x] `routes/pages.py`：`/login`、`/register` 在 `current_user()` 非空时 `redirect("/profile")`。

- [x] Run: 浏览器打开 `/register`，用 `a@b.com` 再注册一次
  - Expected: 表单下方红字显示「该邮箱已被注册」，按钮恢复可点，页面不跳转。

- [x] Run: 浏览器打开 `/login`，输入错误密码
  - Expected: 显示「邮箱或密码错误」。

- [x] Run: 用正确凭据登录后访问 `/login`
  - Expected: 直接跳到 `/profile`。

**Visual Verification:** 375 与 1440 视口下表单卡片不溢出、输入框可点区域 ≥ 44px（移动端）、错误文案在字段下方且为 `--danger` 色。

**Security/Boundary Notes:** 表单不使用 `innerHTML` 回填；错误文案只来自 `message`。

---

## Task 4: 个人主页与个人信息编辑

**Goal:** `/profile` 展示个人信息并支持修改用户名与简介；为后续「我的笔记 / 我的收藏 / 分享管理」预留区块。

**Files:**
- Create: `templates/profile.html`、`static/js/profile.js`
- Modify: `routes/profile.py`（本阶段只实现 `PUT /api/profile`，收藏接口在 Phase 3 Task 6 追加）、`app.py`（注册 `profile_bp`）

**Steps:**
- [x] 实现 `PUT /api/profile`（`profile_bp = Blueprint("profile", __name__, url_prefix="/api")`）：`login_required`；`username.strip()` 非空否则 `USERNAME_REQUIRED`；`bio` 允许空、长度 ≤ 200（超长 → `INVALID_PARAMS`）；更新后返回 `ok({"user": current_user()})`。

- [x] 写 `templates/profile.html`，页面结构（用 `.profile-grid` 两栏，移动端单列）：

```
┌ 个人信息卡 ─────────────────────────────────────────────┐
│  用户名  [输入框]           简介 [textarea 3 行]         │
│  [ 保存修改 ]   <p class="form-error" hidden>            │
├ 我的笔记（Phase 3 填充）─────────────────────────────────┤
├ 我的收藏 id="favorites"（Phase 3 填充）──────────────────┤
├ 分享管理（Phase 4 填充）─────────────────────────────────┤
```

  - 页面内锚点 `#favorites` 必须存在（顶栏「我的收藏」指向它）。
  - 空区块此阶段渲染占位文案 `功能将在后续阶段填充`，Phase 3/4 替换为真实列表。

- [x] 写 `static/js/profile.js`：页面加载时 `GET /api/auth/me` 回填表单；「保存修改」时 `PUT /api/profile`，成功提示 `已保存`（2 秒消失），失败就地展示 `message`。

- [x] 在 `routes/pages.py`：`/profile` 未登录时 `redirect("/login")`（页面级守卫；API 层仍由 `login_required` 兜底）。

- [x] Run: `python tests/smoke_test.py` 并追加第 3 组断言：

```python
section("3. 个人信息")
post("/api/auth/login", {"email": "a@b.com", "password": "abc123"})
r = client.put("/api/profile", json={"username": "阿黎改名", "bio": "记录生活"})
check("更新个人信息 OK", j(r).get("code") == "OK", j(r))
check("用户名已更新", j(get("/api/auth/me")).get("data", {}).get("user", {}).get("username") == "阿黎改名")
r = client.put("/api/profile", json={"username": "   ", "bio": ""})
check("空用户名 → USERNAME_REQUIRED", j(r).get("code") == "USERNAME_REQUIRED", j(r))
r = client.put("/api/profile", json={"username": "x", "bio": "字" * 201})
check("简介超长 → INVALID_PARAMS", j(r).get("code") == "INVALID_PARAMS", j(r))
```

  - Expected: 全部 `[OK]`。

- [x] Run: 浏览器打开 `/profile`，改名并保存后刷新
  - Expected: 顶栏与表单均显示新用户名；刷新后仍为 `已更新` 的值。

**Visual Verification:** 1440 与 375 视口下两栏正确塌陷为单列；`#favorites` 锚点跳转后目标区块顶部不被顶栏遮挡（加 `scroll-margin-top`）。

---

## Phase Completion Checklist

- [x] 全部 4 个任务完成
- [x] `python tests/smoke_test.py` 第 1–3 组全部 `[OK]`，失败数 0
- [x] 注册 → 自动登录 → 改个人信息 → 退出 → 重新登录 全流程可走通
- [x] 所有失败提示均来自后端 `message` 且为中文
- [x] 准备进入 Phase 3
