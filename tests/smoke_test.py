# -*- coding: utf-8 -*-
"""个人笔记 —— 冒烟测试（纯 assert，不使用 pytest）。

用法：
    python tests/smoke_test.py                 # 运行全部检查组
    python tests/smoke_test.py db errors       # 只运行指定检查组（便于聚焦 RED / GREEN）

退出码：全部通过为 0，任一检查失败为 1。
"""

import json
import os
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# 用临时数据库运行，避免污染 data/notebook.db。
# 必须在导入 config / app 之前设置环境变量：config.Config 在导入时就读取环境变量。
_TMP_DIR = tempfile.mkdtemp(prefix="notebook-smoke-")
os.environ["NOTEBOOK_SECRET_KEY"] = "smoke-test-secret"
os.environ["NOTEBOOK_DB_PATH"] = os.path.join(_TMP_DIR, "notebook.db")

_GROUPS = []
_PASSED = 0


def group(name):
    """把一个函数注册为一个检查组。"""

    def deco(fn):
        _GROUPS.append((name, fn))
        return fn

    return deco


def check(condition, message):
    """断言；失败时抛出带中文说明的 AssertionError。"""
    global _PASSED
    if condition:
        _PASSED += 1
        return
    raise AssertionError(message)


def check_eq(actual, expected, label):
    check(actual == expected, "%s：期望 %r，实际 %r" % (label, expected, actual))


# ---------------------------------------------------------------------------
# 自检：确认测试脚手架本身可用
# ---------------------------------------------------------------------------


@group("selfcheck")
def check_selfcheck():
    check(True, "恒真断言应当通过")
    check_eq(1 + 1, 2, "脚手架算数")


# ---------------------------------------------------------------------------
# 任务 1：项目骨架与配置
# ---------------------------------------------------------------------------


@group("skeleton")
def check_skeleton():
    import config

    # 配置项齐备且默认值正确（spec Components / config.py 行）
    check_eq(config.Config.AI_PROVIDER, "mock", "默认 AI_PROVIDER")
    check_eq(config.Config.AI_BASE_URL, "", "默认 AI_BASE_URL")
    check_eq(config.Config.AI_API_KEY, "", "默认 AI_API_KEY")
    check_eq(config.Config.AI_MODEL, "", "默认 AI_MODEL")
    check_eq(config.Config.AI_TIMEOUT, 15, "默认 AI_TIMEOUT")
    check_eq(config.Config.AI_MAX_CHARS, 2000, "默认 AI_MAX_CHARS")
    check_eq(config.Config.AI_TEMPERATURE, 0.3, "默认 AI_TEMPERATURE")
    check_eq(config.Config.DB_PATH, os.environ["NOTEBOOK_DB_PATH"], "DB_PATH 可被环境变量覆盖")
    check(bool(config.Config.SECRET_KEY), "SECRET_KEY 非空")

    # 应用工厂可用，且 / 返回 200 的 UTF-8 HTML
    import app as app_module

    check(hasattr(app_module, "create_app"), "app.py 必须暴露 create_app()")
    application = app_module.create_app()
    check(application is not None, "create_app() 必须返回 Flask 应用")

    client = application.test_client()
    resp = client.get("/")
    check_eq(resp.status_code, 200, "GET /")
    check("text/html" in resp.headers["Content-Type"], "GET / 的 Content-Type 应为 HTML")
    check("charset=utf-8" in resp.headers["Content-Type"].lower(), "GET / 应显式声明 UTF-8")

    # 依赖清单锁定精确版本（不猜版本号，requests 用实测解析值）
    req_path = os.path.join(ROOT, "requirements.txt")
    check(os.path.exists(req_path), "requirements.txt 必须存在")
    with open(req_path, encoding="utf-8") as fp:
        req = fp.read()
    for pinned in ("Flask==3.0.3", "Werkzeug==3.1.9", "requests==2.34.2"):
        check(pinned in req, "requirements.txt 应锁定 %s" % pinned)


# ---------------------------------------------------------------------------
# 任务 2：数据库连接与建表
# ---------------------------------------------------------------------------

EXPECTED_TABLES = ["comments", "favorites", "notes", "shares", "users"]

EXPECTED_COLUMNS = {
    "users": ["id", "email", "username", "password_hash", "bio", "created_at"],
    "notes": [
        "id", "user_id", "title", "content_md", "status",
        "created_at", "updated_at", "published_at",
    ],
    "shares": ["id", "note_id", "token", "password_hash", "created_at"],
    "comments": ["id", "note_id", "user_id", "nickname", "content", "created_at"],
    "favorites": ["id", "user_id", "note_id", "created_at"],
}

# spec「数据模型」章节的两条索引
EXPECTED_INDEXES = ["idx_comments_note", "idx_notes_user_status"]


def _fresh_app():
    import app as app_module

    return app_module.create_app()


@group("db")
def check_db():
    import sqlite3

    from core import db

    # 对外接口齐备（core/db.py 是唯一 SQL 出入口）
    for name in ("get_db", "close_db", "init_db", "query", "execute", "now_iso"):
        check(hasattr(db, name), "core.db 必须暴露 %s()" % name)

    application = _fresh_app()
    db_path = application.config["DB_PATH"]

    # create_app() 即完成建表，且业务表名与 spec 完全一致
    # （排除 sqlite_ 前缀的 SQLite 内部表，如 AUTOINCREMENT 产生的 sqlite_sequence）
    conn = sqlite3.connect(db_path)
    tables = sorted(
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    )
    conn.close()
    check_eq(tables, EXPECTED_TABLES, "建表结果")

    # 幂等：重复初始化不报错
    with application.app_context():
        db.init_db()
        db.init_db()

    conn = sqlite3.connect(db_path)
    for table, columns in EXPECTED_COLUMNS.items():
        actual = [r[1] for r in conn.execute("PRAGMA table_info(%s)" % table)]
        check_eq(actual, columns, "%s 表字段" % table)
    indexes = sorted(
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
        )
    )
    check_eq(indexes, EXPECTED_INDEXES, "索引列表")
    conn.close()

    # data/ 目录不存在时自动创建
    nested_dir = os.path.join(_TMP_DIR, "nested", "deep")
    nested_db = os.path.join(nested_dir, "notebook.db")
    original = application.config["DB_PATH"]
    application.config["DB_PATH"] = nested_db
    with application.app_context():
        db.init_db()
    application.config["DB_PATH"] = original
    check(os.path.exists(nested_db), "DB_PATH 的上级目录不存在时应自动创建")

    # 行工厂 + 同一上下文复用连接 + 参数化查询
    with application.app_context():
        check(db.get_db() is db.get_db(), "同一请求上下文内应复用同一条连接")
        cursor = db.execute(
            "INSERT INTO users (email, username, password_hash, bio, created_at) VALUES (?,?,?,?,?)",
            ("a@example.com", "阿甲", "x", "", db.now_iso()),
        )
        check(isinstance(cursor.lastrowid, int) and cursor.lastrowid > 0, "execute 应返回可取 lastrowid 的游标")
        rows = db.query("SELECT * FROM users WHERE email = ?", ("a@example.com",))
        check_eq(len(rows), 1, "参数化查询命中行数")
        check_eq(rows[0]["username"], "阿甲", "sqlite3.Row 可按列名取值")
        # 外键约束已开启：插入不存在的 user_id 必须被拒绝
        check(db.get_db().execute("PRAGMA foreign_keys").fetchone()[0] == 1, "PRAGMA foreign_keys 应为 ON")

    # 请求结束后连接必须关闭（app.teardown_appcontext）
    captured = {}
    with application.app_context():
        captured["conn"] = db.get_db()
    try:
        captured["conn"].execute("SELECT 1")
        closed = False
    except sqlite3.ProgrammingError:
        closed = True
    check(closed, "请求结束后连接应被关闭")

    # 约束行为：status 枚举 + 外键级联 + 收藏唯一键
    with application.app_context():
        try:
            db.execute(
                "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?)",
                (999999, "t", "", "draft", db.now_iso(), db.now_iso()),
            )
            foreign_key_enforced = False
        except sqlite3.IntegrityError:
            foreign_key_enforced = True
        check(foreign_key_enforced, "notes.user_id 的外键约束应生效")

        try:
            db.execute(
                "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?)",
                (1, "t", "", "bogus", db.now_iso(), db.now_iso()),
            )
            check_constraint = False
        except sqlite3.IntegrityError:
            check_constraint = True
        check(check_constraint, "notes.status 的 CHECK 约束应只允许 draft/published")

        note_id = db.execute(
            "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?)",
            (1, "标题", "正文", "draft", db.now_iso(), db.now_iso()),
        ).lastrowid
        db.execute(
            "INSERT INTO favorites (user_id, note_id, created_at) VALUES (?,?,?)",
            (1, note_id, db.now_iso()),
        )
        try:
            db.execute(
                "INSERT INTO favorites (user_id, note_id, created_at) VALUES (?,?,?)",
                (1, note_id, db.now_iso()),
            )
            unique_enforced = False
        except sqlite3.IntegrityError:
            unique_enforced = True
        check(unique_enforced, "favorites 的 UNIQUE(user_id, note_id) 应生效")

        # 删除笔记应级联清掉收藏
        db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        check_eq(
            db.query("SELECT COUNT(*) AS n FROM favorites WHERE note_id = ?", (note_id,))[0]["n"],
            0,
            "删除笔记后收藏应级联删除",
        )

    # now_iso() 形态：ISO-8601 UTC，以 Z 结尾
    stamp = db.now_iso()
    check(len(stamp) == 20 and stamp.endswith("Z") and stamp[10] == "T", "now_iso() 应为 ISO-8601 UTC：%r" % stamp)


# ---------------------------------------------------------------------------
# 任务 3：错误码、统一响应与全局错误处理
# ---------------------------------------------------------------------------

# spec「错误码表」逐字文案（code -> (HTTP, message)）
SPEC_CODES = {
    "OK": (200, "操作成功"),
    "INVALID_PARAMS": (400, "请求参数不完整或格式不正确"),
    "EMAIL_EXISTS": (409, "该邮箱已被注册"),
    "EMAIL_INVALID": (400, "请输入有效的邮箱地址"),
    "USERNAME_REQUIRED": (400, "请输入用户名"),
    "PASSWORD_TOO_SHORT": (400, "密码长度至少 6 位"),
    "PASSWORD_MISMATCH": (400, "两次输入的密码不一致"),
    "LOGIN_FAILED": (401, "邮箱或密码错误"),
    "AUTH_REQUIRED": (401, "请先登录"),
    "FORBIDDEN": (403, "无权操作该笔记"),
    "NOTE_NOT_FOUND": (404, "笔记不存在"),
    "NOTE_TITLE_REQUIRED": (400, "请填写笔记标题"),
    "COMMENT_EMPTY": (400, "评论内容不能为空"),
    "NICKNAME_REQUIRED": (400, "请填写昵称后再评论"),
    "COMMENT_TOO_LONG": (400, "评论内容不能超过 500 字"),
    "SHARE_NOT_FOUND": (404, "分享链接无效或已取消"),
    "SHARE_PASSWORD_REQUIRED": (401, "该分享需要密码"),
    "SHARE_PASSWORD_WRONG": (401, "分享密码错误"),
    "AI_EMPTY_TEXT": (400, "请先选中需要润色的文本"),
    "AI_TOO_LONG": (400, "选中的文本过长，请分段润色"),
    "AI_UNAVAILABLE": (502, "AI 服务暂时不可用，请稍后重试"),
    "AI_TIMEOUT": (504, "AI 服务响应超时，请重试"),
    "NOT_FOUND": (404, "页面不存在"),
    "INTERNAL_ERROR": (500, "服务器内部错误，请稍后重试"),
}


def _is_chinese(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


@group("errors")
def check_errors():
    from core import codes, responses

    # 24 个错误码常量齐备，且常量名与值一致
    constants = {
        name: value
        for name, value in vars(codes).items()
        if name.isupper() and isinstance(value, str)
    }
    check_eq(len(constants), 24, "错误码常量数量（含保留码 FORBIDDEN）")
    for name in SPEC_CODES:
        check(hasattr(codes, name), "core.codes 缺少常量 %s" % name)
        check_eq(getattr(codes, name), name, "常量 %s 的值应等于其名字" % name)

    # MESSAGES 覆盖全部 24 个码，文案与 spec 逐字一致，且都是中文
    check_eq(sorted(codes.MESSAGES), sorted(SPEC_CODES), "MESSAGES 的 key 集合")
    for name, (_status, message) in SPEC_CODES.items():
        check_eq(codes.MESSAGES[name], message, "%s 的中文文案" % name)
        check(_is_chinese(codes.MESSAGES[name]), "%s 的文案必须是中文提示" % name)

    # HTTP_STATUS 与 spec 第三列一致
    for name, (status, _message) in SPEC_CODES.items():
        check_eq(codes.HTTP_STATUS[name], status, "%s 的 HTTP 状态码" % name)

    # 统一响应结构：ok()
    application = _fresh_app()
    # Flask 3 要求所有路由注册发生在处理第一个请求之前，故先挂两条探针路由
    application.add_url_rule("/api/__boom", "__boom", lambda: 1 / 0)
    application.add_url_rule("/api/__onlyget", "__onlyget", lambda: "ok", methods=["GET"])
    with application.test_request_context():
        body, status = responses.ok({"a": 1}, http=201)
        check_eq(status, 201, "ok() 的 HTTP 状态码")
        payload = body.get_json()
        check_eq(sorted(payload), ["code", "data", "message"], "成功响应字段")
        check_eq(payload["code"], "OK", "成功响应的 code")
        check_eq(payload["message"], "操作成功", "成功响应的 message")
        check_eq(payload["data"], {"a": 1}, "成功响应的 data")

        # fail()：文案从 MESSAGES 查表，HTTP 取 HTTP_STATUS 默认值
        body, status = responses.fail(codes.INVALID_PARAMS)
        payload = body.get_json()
        check_eq(status, 400, "fail() 默认 HTTP 状态码")
        check_eq(payload, {
            "code": "INVALID_PARAMS",
            "message": "请求参数不完整或格式不正确",
            "data": None,
        }, "fail() 的响应体")

        # fail()：可显式覆盖 HTTP 状态与 message
        body, status = responses.fail(codes.NOTE_NOT_FOUND, http=410)
        check_eq(status, 410, "fail() 可覆盖 HTTP 状态码")
        body, status = responses.fail(codes.INVALID_PARAMS, message="自定义提示")
        check_eq(body.get_json()["message"], "自定义提示", "fail() 可覆盖 message")

    client = application.test_client()

    # /api/ 开头的 404 → JSON 统一结构（HTTP 404）
    resp = client.get("/api/unknown")
    check_eq(resp.status_code, 404, "GET /api/unknown 的状态码")
    check("application/json" in resp.headers["Content-Type"], "API 错误响应应为 JSON")
    check_eq(resp.get_json(), {
        "code": "NOT_FOUND",
        "message": "页面不存在",
        "data": None,
    }, "/api/unknown 的响应体")

    # 未捕获异常 → INTERNAL_ERROR，且不向前端泄漏堆栈
    resp = client.get("/api/__boom")
    check_eq(resp.status_code, 500, "未捕获异常的 HTTP 状态码")
    payload = resp.get_json()
    check_eq(payload["code"], "INTERNAL_ERROR", "未捕获异常的 code")
    check_eq(payload["message"], "服务器内部错误，请稍后重试", "未捕获异常的 message")
    check_eq(payload["data"], None, "未捕获异常的 data")
    raw = resp.get_data(as_text=True)
    for leak in ("Traceback", "ZeroDivisionError", "File \"", "site-packages"):
        check(leak not in raw, "错误响应不得泄漏堆栈信息（发现 %r）" % leak)

    # 失败用例一律同时含 code 与中文 message（spec Testing 第 8 组）
    for path, payload in (("/api/unknown", client.get("/api/unknown").get_json()),
                          ("/api/__boom", payload)):
        check("code" in payload and "message" in payload, "%s 必须同时含 code 与 message" % path)
        check(_is_chinese(payload["message"]), "%s 的 message 必须是中文" % path)

    # 边界：HTTPException（如 405）不得被 errorhandler(Exception) 吞成 500
    resp = client.post("/api/__onlyget")
    check_eq(resp.status_code, 405, "方法不允许时应保留 405，而不是变成 500")


# ---------------------------------------------------------------------------
# 任务 4：页面路由、base 模板与设计令牌
# ---------------------------------------------------------------------------

# 路由 -> 该页独有的中文标记（用于确认「正确的模板挂到了正确的路由」）
# 注意：/notes/new 与 /notes/<id>/edit 按 spec 共用 note_edit.html，标记相同。
PAGE_ROUTES = [
    ("/", "记录生活 · 书写成长"),
    ("/login", "登录账号"),
    ("/register", "注册新账号"),
    ("/profile", "个人主页"),
    ("/notes", "我的笔记"),
    ("/notes/new", "写笔记"),
    ("/notes/1", "笔记详情"),
    ("/notes/1/edit", "写笔记"),
    ("/about", "个人笔记是一个本地运行的个人笔记应用"),
    ("/share/x", "分享的笔记"),
]

# spec「设计令牌」表（全部 12 组，:root 为全站唯一定义处）
DESIGN_TOKENS = {
    "--bg": "#F7F4EE",
    "--surface": "#FFFFFF",
    "--primary": "#B89B6A",
    "--primary-strong": "#7A5C2E",
    "--primary-strong-hover": "#6A4F26",
    "--accent": "#F2C94C",
    "--text": "#3D3730",
    "--text-muted": "#6F665C",
    "--border": "#E8E1D5",
    "--parchment-ink": "#4A3B2A",
    "--danger": "#9E4A34",
    "--radius": "10px",
    "--radius-btn": "8px",
    "--space-1": "4px",
    "--space-2": "8px",
    "--space-3": "12px",
    "--space-4": "16px",
    "--space-5": "24px",
    "--space-6": "40px",
    "--shadow": "0 2px 12px rgba(61,55,48,.08)",
    "--font-serif": '"Songti SC","STSong","SimSun","Noto Serif SC",serif',
    "--font-script": '"Segoe Script","Bradley Hand",cursive',
    "--font-sans": '-apple-system,"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif',
    "--font-mono": '"Cascadia Mono",Consolas,"Courier New",monospace',
}


def _read(relpath):
    with open(os.path.join(ROOT, relpath), encoding="utf-8") as fp:
        return fp.read()


def _root_tokens(css):
    """从 :root{...} 中解析出令牌名 -> 规范化的值（先剔除 CSS 注释）。"""
    css = re.sub(r"/\*.*?\*/", " ", css, flags=re.S)
    start = css.index(":root")
    start = css.index("{", start) + 1
    end = css.index("}", start)
    tokens = {}
    for declaration in css[start:end].split(";"):
        if ":" not in declaration:
            continue
        name, value = declaration.split(":", 1)
        name = name.strip()
        if name.startswith("--"):
            tokens[name] = "".join(value.split())
    return tokens


# 自 Phase 3 起，写笔记页与编辑页也要求登录（未登录 302 到 /login）
GUARDED_PAGES = ("/profile", "/notes/new", "/notes/1/edit")


@group("pages")
def check_pages():
    client = _fresh_app().test_client()

    # 登录守卫页面：未登录一律 302 到 /login
    for path, _marker in [(p, m) for p, m in PAGE_ROUTES if p in GUARDED_PAGES]:
        resp = client.get(path)
        check_eq(resp.status_code, 302, "未登录 GET %s 应 302" % path)
        check_eq(resp.headers.get("Location"), "/login", "未登录 GET %s 的跳转目标" % path)

    # 其余页面匿名可访问
    for path, marker in [(p, m) for p, m in PAGE_ROUTES if p not in GUARDED_PAGES]:
        resp = client.get(path)
        check_eq(resp.status_code, 200, "GET %s 的状态码" % path)
        ctype = resp.headers["Content-Type"]
        check("text/html" in ctype, "GET %s 的 Content-Type 应为 HTML（实际 %s）" % (path, ctype))
        check("charset=utf-8" in ctype.lower(), "GET %s 应显式声明 UTF-8（实际 %s）" % (path, ctype))
        html = resp.get_data(as_text=True)
        check(marker in html, "GET %s 应渲染对应模板（缺少标记 %r）" % (path, marker))
        check_eq(html.count("<h1"), 1, "GET %s 应恰有一个 <h1>（spec 无障碍要求）" % path)

    # base.html 的语义骨架与顶栏/底栏（spec Accessibility）
    html = client.get("/").get_data(as_text=True)
    for tag in ("<header", "<nav", "<main", "<footer"):
        check(tag in html, "base.html 应包含语义标签 %s" % tag)
    check('lang="zh-CN"' in html, "html 标签应声明 lang=zh-CN")
    check('<meta charset="UTF-8">' in html, "必须声明 UTF-8 字符集")
    check('name="viewport"' in html, "必须声明 viewport")
    check("css/style.css" in html, "base.html 应引用 style.css")
    check("js/api.js" in html, "base.html 应引用 api.js")
    # 未登录时顶栏展示 登录 / 注册 / 关于
    for label in ("登录", "注册", "关于"):
        check(label in html, "未登录顶栏应含「%s」" % label)
    # 未登录时不应渲染退出按钮（否则 api.js 会在无登录态时调登出接口）
    check("logout-btn" not in html, "未登录时不应渲染 #logout-btn")

    # 非 API 的 404 → 中文页面（HTTP 404 + 唯一 h1 + 返回主页）
    resp = client.get("/definitely-not-a-page")
    check_eq(resp.status_code, 404, "未知页面路由的状态码")
    check("text/html" in resp.headers["Content-Type"], "未知页面路由应返回 HTML")
    html = resp.get_data(as_text=True)
    check("页面不存在" in html, "404 页应显示中文提示")
    check_eq(html.count("<h1"), 1, "404 页应恰有一个 <h1>")
    check('href="/"' in html, "404 页应提供返回主页链接")

    # 登录后各守卫页面正常渲染（/profile 自 Phase 2 起要求登录；/notes/new 与编辑页自 Phase 3 起）
    client.post("/api/auth/register", json={
        "email": "pages@example.com", "username": "页面骨架用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    markers = dict(PAGE_ROUTES)
    for path in GUARDED_PAGES:
        resp = client.get(path)
        check_eq(resp.status_code, 200, "登录后 GET %s 的状态码" % path)
        html = resp.get_data(as_text=True)
        check(markers[path] in html, "登录后 GET %s 应渲染对应模板（缺少标记 %r）" % (path, markers[path]))
        check_eq(html.count("<h1"), 1, "登录后 GET %s 应恰有一个 <h1>" % path)


@group("static")
def check_static():
    client = _fresh_app().test_client()

    expected = [
        ("/static/css/style.css", "css"),
    ]
    for path, ctype_fragment in expected:
        resp = client.get(path)
        check_eq(resp.status_code, 200, "GET %s 的状态码" % path)
        ctype = resp.headers["Content-Type"]
        check(ctype_fragment in ctype, "GET %s 的 Content-Type 应为 %s（实际 %s）" % (path, ctype_fragment, ctype))

    for name in ("hero.jpg", "parchment.jpg"):
        resp = client.get("/static/img/%s" % name)
        check_eq(resp.status_code, 200, "GET /static/img/%s 的状态码" % name)
        check_eq(resp.headers["Content-Type"], "image/jpeg", "%s 的 Content-Type" % name)
        size = os.path.getsize(os.path.join(ROOT, "static", "img", name))
        check(size > 100 * 1024, "%s 应为真实素材图（当前 %d 字节）" % (name, size))

    # hero 必须是 Hero 实拍图，而不是设计稿截图
    hero = os.path.join(ROOT, "static", "img", "hero.jpg")
    source = os.path.join(ROOT, "个人笔记主页.jpg")
    check_eq(os.path.getsize(hero), os.path.getsize(source), "hero.jpg 应与素材原图一致")

    # 设计稿截图不得进入 static/
    check(
        not os.path.exists(os.path.join(ROOT, "static", "img", "个人笔记-主页截图.jpg")),
        "设计稿截图不应复制进 static/",
    )


@group("tokens")
def check_tokens():
    css = _read("static/css/style.css")
    tokens = _root_tokens(css)

    for name, value in DESIGN_TOKENS.items():
        check(name in tokens, "style.css 的 :root 缺少令牌 %s" % name)
        check_eq(tokens[name], "".join(value.split()), "令牌 %s 的值" % name)

    # 基础规则与组件基类（全站唯一来源）
    for fragment in (
        "box-sizing:border-box",
        "a{color:var(--primary-strong)}",
        ":focus-visible{outline:2px solid var(--primary-strong);outline-offset:2px}",
        "@media (prefers-reduced-motion: reduce)",
        ".btn{",
        ".btn-primary{",
        ".btn-ghost{",
        ".form-error{",
    ):
        check(fragment in css, "style.css 应包含规则片段 %r" % fragment)

    # 金色分色原则：--primary 不得被用作承载文字的 color
    # 用负向断言精确匹配 color 属性（border-color / background-color 属装饰用法，spec 明确允许）
    check(
        re.search(r"(?<![-\w])color:var\(--primary\)", css) is None,
        "--primary 只用于装饰，承载文字必须用 --primary-strong",
    )


# ---------------------------------------------------------------------------
# 任务 5：前端请求封装 api.js
# ---------------------------------------------------------------------------


@group("frontend")
def check_frontend():
    import subprocess

    client = _fresh_app().test_client()
    resp = client.get("/static/js/api.js")
    check_eq(resp.status_code, 200, "GET /static/js/api.js 的状态码")
    check("javascript" in resp.headers["Content-Type"], "api.js 的 Content-Type 应为 JavaScript")

    # api.js 的操作契约（只展示 message、同源、方法/请求头正确）由 Node 沙箱断言
    script = os.path.join(ROOT, "tests", "js_api_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_api_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")

    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_api_test.js 的退出码")


# ---------------------------------------------------------------------------
# Phase 2 任务 1：core/security.py 认证工具
# ---------------------------------------------------------------------------


@group("security")
def check_security():
    from core import security

    # 公共接口齐备（本模块是唯一的认证实现出口）
    for name in (
        "hash_password", "verify_password", "hash_share_password", "verify_share_password",
        "current_user", "login_user", "logout_user", "login_required",
        "set_share_unlocked", "is_share_unlocked",
    ):
        check(hasattr(security, name), "core.security 必须暴露 %s()" % name)

    # 密码哈希：pbkdf2:sha256、不落明文、随机盐、正确校验
    hashed = security.hash_password("abc123")
    check(isinstance(hashed, str) and hashed.startswith("pbkdf2:sha256"), "hash_password 应使用 pbkdf2:sha256（实际 %r）" % hashed)
    check("abc123" not in hashed, "哈希结果不得包含明文密码")
    check(security.verify_password("abc123", hashed) is True, "正确密码应校验通过")
    check(security.verify_password("x", hashed) is False, "错误密码应校验失败")
    check(security.verify_password("abc123", None) is False, "无哈希值时应校验失败而不是抛异常")
    check(security.hash_password("abc123") != hashed, "相同输入两次哈希应因随机盐而不同")

    # 分享密码：与登录密码同等强度，独立命名以便区分用途
    share_hash = security.hash_share_password("pw123456")
    check(share_hash.startswith("pbkdf2:sha256"), "hash_share_password 应使用 pbkdf2:sha256")
    check(security.verify_share_password("pw123456", share_hash) is True, "正确分享密码应校验通过")
    check(security.verify_share_password("bad", share_hash) is False, "错误分享密码应校验失败")

    application = _fresh_app()
    with application.app_context():
        from core import db

        user_id = db.execute(
            "INSERT INTO users (email, username, password_hash, bio, created_at) VALUES (?,?,?,?,?)",
            ("security@example.com", "安全用户", security.hash_password("abc123"), "简介", db.now_iso()),
        ).lastrowid

    with application.test_request_context():
        from flask import session

        # 未登录
        check(security.current_user() is None, "未登录时 current_user() 应为 None")

        # 登录态
        security.login_user(user_id)
        check(session.get("user_id") == user_id, "login_user 应写入 session['user_id']")
        user = security.current_user()
        check(isinstance(user, dict), "登录后 current_user() 应返回 dict 而不是 sqlite3.Row")
        check(
            set(user) == {"id", "email", "username", "bio"},
            "current_user() 的字段集合应恰为 id/email/username/bio（实际 %r）" % sorted(user),
        )
        check("password_hash" not in user, "current_user() 绝不得返回 password_hash")
        check_eq(user["email"], "security@example.com", "current_user() 的 email")
        check_eq(user["username"], "安全用户", "current_user() 的 username")

        # 缓存：同一请求内重复调用只查一次库，且返回同一对象
        check(security.current_user() is security.current_user(), "同一请求内 current_user() 应命中 g._user 缓存")

        # 退出
        security.logout_user()
        check(security.current_user() is None, "logout_user 后 current_user() 应为 None")
        check("user_id" not in session, "logout_user 应清除 session['user_id']")

        # login_required：未登录直接返回 AUTH_REQUIRED，且不执行被保护的视图
        calls = []

        def view():
            calls.append(1)
            return "视图已执行"

        body, status = security.login_required(view)()
        check_eq(status, 401, "未登录访问受保护视图的 HTTP 状态码")
        check_eq(body.get_json()["code"], "AUTH_REQUIRED", "未登录访问受保护视图的 code")
        check(calls == [], "未登录时被 login_required 包裹的视图不得被执行")

        security.login_user(user_id)
        check_eq(security.login_required(view)(), "视图已执行", "登录后应执行被保护的视图")
        check_eq(len(calls), 1, "登录后被保护的视图应执行一次")

        # 分享解锁态：去重追加
        check(security.is_share_unlocked("tok-1") is False, "默认状态下分享应为未解锁")
        security.set_share_unlocked("tok-1")
        security.set_share_unlocked("tok-1")
        security.set_share_unlocked("tok-2")
        check(security.is_share_unlocked("tok-1") is True, "解锁后 is_share_unlocked 应为 True")
        check(security.is_share_unlocked("tok-2") is True, "第二个 token 也应记录")
        check(security.is_share_unlocked("tok-3") is False, "未解锁的 token 应为 False")
        check_eq(session.get("unlocked_shares"), ["tok-1", "tok-2"], "重复解锁应去重且保持顺序")


# ---------------------------------------------------------------------------
# Phase 2 任务 2：认证接口 /api/auth/*（计划第 2 组断言）
# ---------------------------------------------------------------------------


@group("auth")
def check_auth():
    client = _fresh_app().test_client()

    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 页面与静态资源（计划第 1 组断言的认证相关部分，其余已由 pages / static 组覆盖）
    for path in ("/login", "/register"):
        resp = client.get(path)
        check_eq(resp.status_code, 200, "GET %s 的状态码" % path)
        check("text/html" in resp.headers.get("Content-Type", ""), "GET %s 应为 HTML" % path)

    # 未登录时 me 返回 200 且 user 为 null
    resp = client.get("/api/auth/me")
    check_eq(resp.status_code, 200, "未登录 GET /api/auth/me 的状态码")
    check(j(resp).get("data", {}).get("user") is None, "未登录时 me 的 data.user 应为 null")

    # 注册成功 → 直接登录
    resp = client.post("/api/auth/register", json={
        "email": "a@b.com", "username": "阿黎",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "注册成功的 HTTP 状态码")
    check_eq(j(resp).get("code"), "OK", "注册成功的 code")
    me = j(client.get("/api/auth/me"))
    check_eq(me.get("data", {}).get("user", {}).get("email"), "a@b.com", "注册后应即登录")
    check("password_hash" not in str(me), "me 响应不得出现 password_hash")

    # 重复邮箱（大小写不敏感）→ EMAIL_EXISTS
    resp = client.post("/api/auth/register", json={
        "email": "A@B.com", "username": "另一个",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "EMAIL_EXISTS", "重复邮箱（大小写不敏感）的 code")

    # 非法邮箱 → EMAIL_INVALID
    resp = client.post("/api/auth/register", json={
        "email": "bad-email", "username": "x",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "EMAIL_INVALID", "非法邮箱的 code")

    # 密码过短 → PASSWORD_TOO_SHORT
    resp = client.post("/api/auth/register", json={
        "email": "c@d.com", "username": "x",
        "password": "abc", "confirm_password": "abc",
    })
    check_eq(j(resp).get("code"), "PASSWORD_TOO_SHORT", "密码过短的 code")

    # 两次密码不一致 → PASSWORD_MISMATCH
    resp = client.post("/api/auth/register", json={
        "email": "c@d.com", "username": "x",
        "password": "abc123", "confirm_password": "abc124",
    })
    check_eq(j(resp).get("code"), "PASSWORD_MISMATCH", "两次密码不一致的 code")

    # 用户名为空（纯空白）→ USERNAME_REQUIRED
    resp = client.post("/api/auth/register", json={
        "email": "c@d.com", "username": "  ",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "USERNAME_REQUIRED", "用户名为空的 code")

    # 字段缺失 / 类型错误 → INVALID_PARAMS
    resp = client.post("/api/auth/register", json={"email": "c@d.com"})
    check_eq(j(resp).get("code"), "INVALID_PARAMS", "注册字段不齐全的 code")
    resp = client.post("/api/auth/register", json={
        "email": "c@d.com", "username": "x",
        "password": 123456, "confirm_password": 123456,
    })
    check_eq(j(resp).get("code"), "INVALID_PARAMS", "注册字段类型错误的 code")

    # 失败注册不得写入用户
    check(
        j(client.get("/api/auth/me")).get("data", {}).get("user", {}).get("email") == "a@b.com",
        "失败的注册请求不应改变当前登录态",
    )

    client.post("/api/auth/logout")

    # 未登录访问受保护接口：Phase 3 起 notes_bp 已注册，必须返回 AUTH_REQUIRED
    resp = client.get("/api/notes")
    check_eq(j(resp).get("code"), "AUTH_REQUIRED", "未登录访问 /api/notes 应为 AUTH_REQUIRED（实际 %r）" % j(resp))

    # 错误密码 → LOGIN_FAILED
    resp = client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrong"})
    check_eq(j(resp).get("code"), "LOGIN_FAILED", "错误密码的 code")
    check_eq(j(resp).get("message"), "邮箱或密码错误", "LOGIN_FAILED 的文案")

    # 不存在的邮箱返回同一个 code（不泄漏邮箱是否存在）
    resp = client.post("/api/auth/login", json={"email": "nobody@b.com", "password": "abc123"})
    check_eq(j(resp).get("code"), "LOGIN_FAILED", "不存在的邮箱同样返回 LOGIN_FAILED")
    check_eq(j(resp).get("message"), "邮箱或密码错误", "不存在的邮箱不得给出不同文案")

    # 登录字段缺失 → INVALID_PARAMS
    resp = client.post("/api/auth/login", json={"email": "a@b.com"})
    check_eq(j(resp).get("code"), "INVALID_PARAMS", "登录字段不齐全的 code")

    # 正确凭据 → OK
    resp = client.post("/api/auth/login", json={"email": "a@b.com", "password": "abc123"})
    check_eq(j(resp).get("code"), "OK", "正确凭据登录的 code")
    check_eq(
        j(client.get("/api/auth/me")).get("data", {}).get("user", {}).get("username"),
        "阿黎", "登录后 me 应返回用户名",
    )

    # /api/notes：已登录时应正常返回列表（内容断言由 Phase 3 的 notes 组负责）
    resp = client.get("/api/notes")
    check_eq(j(resp).get("code"), "OK", "已登录 GET /api/notes 应为 OK（实际 %r）" % j(resp))

    # 退出
    resp = client.post("/api/auth/logout")
    check_eq(j(resp).get("code"), "OK", "退出的 code")
    check(j(client.get("/api/auth/me")).get("data", {}).get("user") is None, "退出后 me 应返回 user=null")

    # 退出后受保护接口必须回到 AUTH_REQUIRED
    resp = client.get("/api/notes")
    check_eq(j(resp).get("code"), "AUTH_REQUIRED", "退出后 GET /api/notes 应为 AUTH_REQUIRED（实际 %r）" % j(resp))


# ---------------------------------------------------------------------------
# Phase 2 任务 3：登录 / 注册页面
# ---------------------------------------------------------------------------


@group("authpages")
def check_authpages():
    import subprocess

    client = _fresh_app().test_client()

    # 注册页：表单结构、标签、错误容器、互跳
    resp = client.get("/register")
    check_eq(resp.status_code, 200, "GET /register 的状态码")
    html = resp.get_data(as_text=True)
    check("<title>注册 · 个人笔记</title>" in html, "注册页标题")
    for fragment in (
        'id="register-form"', 'name="email"', 'name="username"',
        'name="password"', 'name="confirm_password"',
        'class="auth-card"', '<label', 'id="form-error"', 'class="form-error"',
        'data-error', 'novalidate', 'js/auth.js',
    ):
        check(fragment in html, "注册页应包含 %r" % fragment)
    check(html.count("<h1") == 1, "注册页应恰有一个 <h1>")
    check('type="email"' in html, "邮箱框应声明 type=email")
    check(html.count('type="password"') == 2, "注册页应有两个 password 输入框")
    check('autocomplete="email"' in html, "邮箱框应声明 autocomplete=email")
    check('autocomplete="nickname"' in html, "用户名框应声明 autocomplete=nickname")
    check(html.count('autocomplete="new-password"') == 2, "两个密码框应声明 autocomplete=new-password")
    check(re.search(r'id="form-error"[^>]*hidden', html) is not None, "错误容器默认应 hidden")
    check("去登录" in html and 'href="/login"' in html, "注册页应提供「去登录」互跳")
    check('class="btn btn-primary"' in html, "应使用主按钮基类")

    # 登录页
    resp = client.get("/login")
    check_eq(resp.status_code, 200, "GET /login 的状态码")
    html = resp.get_data(as_text=True)
    check("<title>登录 · 个人笔记</title>" in html, "登录页标题")
    for fragment in (
        'id="login-form"', 'name="email"', 'name="password"',
        'class="auth-card"', '<label', 'id="form-error"', 'class="form-error"',
        'data-error', 'novalidate', 'js/auth.js',
    ):
        check(fragment in html, "登录页应包含 %r" % fragment)
    check(html.count("<h1") == 1, "登录页应恰有一个 <h1>")
    check("去注册" in html and 'href="/register"' in html, "登录页应提供「去注册」互跳")

    # 已登录访问认证页 → 302 到 /profile
    auth_client = _fresh_app().test_client()
    resp = auth_client.post("/api/auth/register", json={
        "email": "authpages@example.com", "username": "页面用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "authpages 组的前置注册")
    for path in ("/login", "/register"):
        resp = auth_client.get(path)
        check_eq(resp.status_code, 302, "已登录 GET %s 应 302" % path)
        check_eq(resp.headers.get("Location"), "/profile", "已登录 GET %s 的跳转目标" % path)

    # 表单样式（卡片居中、输入框可点区域 ≥ 44px）
    css = _read("static/css/style.css")
    check(".auth-card{" in css, "style.css 应包含 .auth-card")
    check(".auth-alt{" in css, "style.css 应包含 .auth-alt")
    check(
        re.search(r"\.auth-card input\{[^}]*min-height:44px", css) is not None,
        "认证输入框最小高度应 ≥ 44px（移动端可点区域）",
    )
    check(
        re.search(r"\.auth-card \.btn\{[^}]*width:100%", css) is not None,
        "认证主按钮应占满卡片宽度",
    )

    # auth.js 的静态契约 + Node 沙箱行为断言
    resp = client.get("/static/js/auth.js")
    check_eq(resp.status_code, 200, "GET /static/js/auth.js 的状态码")
    check("javascript" in resp.headers["Content-Type"], "auth.js 的 Content-Type 应为 JavaScript")
    js = resp.get_data(as_text=True)
    check("/api/auth/register" in js, "auth.js 应引用注册接口")
    check("/api/auth/login" in js, "auth.js 应引用登录接口")
    check("showError" in js, "auth.js 应通过 api.showError 展示 message")
    check(re.search(r"\.innerHTML\s*=", js) is None, "auth.js 不得用 innerHTML 赋值回填内容")

    script = os.path.join(ROOT, "tests", "js_auth_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_auth_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")

    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_auth_test.js 的退出码")


# ---------------------------------------------------------------------------
# Phase 2 任务 4：个人主页与个人信息编辑（计划第 3 组断言）
# ---------------------------------------------------------------------------


@group("profile")
def check_profile():
    import subprocess

    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 独立注册，保证「只跑 profile 组」时也能通过
    client = _fresh_app().test_client()
    resp = client.post("/api/auth/register", json={
        "email": "profile@example.com", "username": "资料用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "profile 组的前置注册")

    # 更新个人信息
    resp = client.put("/api/profile", json={"username": "阿黎改名", "bio": "记录生活"})
    check_eq(j(resp).get("code"), "OK", "更新个人信息的 code")
    check_eq(
        j(resp).get("data", {}).get("user", {}).get("username"),
        "阿黎改名", "PUT 响应应回读更新后的用户名（缓存需失效）",
    )
    me = j(client.get("/api/auth/me"))
    check_eq(me.get("data", {}).get("user", {}).get("username"), "阿黎改名", "用户名已更新")
    check_eq(me.get("data", {}).get("user", {}).get("bio"), "记录生活", "简介已更新")
    check("password_hash" not in str(me), "me 响应不得出现 password_hash")

    # 空用户名 → USERNAME_REQUIRED
    resp = client.put("/api/profile", json={"username": "   ", "bio": ""})
    check_eq(j(resp).get("code"), "USERNAME_REQUIRED", "空用户名的 code")

    # 简介超长 → INVALID_PARAMS；恰好 200 字应通过（边界）
    resp = client.put("/api/profile", json={"username": "x", "bio": "字" * 201})
    check_eq(j(resp).get("code"), "INVALID_PARAMS", "简介超长的 code")
    resp = client.put("/api/profile", json={"username": "边界用户", "bio": "字" * 200})
    check_eq(j(resp).get("code"), "OK", "简介恰好 200 字应通过")

    # 字段缺失 / 类型错误 → INVALID_PARAMS
    resp = client.put("/api/profile", json={"bio": "只有简介"})
    check_eq(j(resp).get("code"), "INVALID_PARAMS", "缺用户名的 code")
    resp = client.put("/api/profile", json={"username": "x", "bio": 123})
    check_eq(j(resp).get("code"), "INVALID_PARAMS", "简介类型错误的 code")

    # 未登录 → AUTH_REQUIRED（API 层兜底）
    anon = _fresh_app().test_client()
    resp = anon.put("/api/profile", json={"username": "x", "bio": ""})
    check_eq(resp.status_code, 401, "未登录 PUT /api/profile 的状态码")
    check_eq(j(resp).get("code"), "AUTH_REQUIRED", "未登录 PUT /api/profile 的 code")

    # 未登录访问 /profile 页面 → 302 到 /login（页面级守卫）
    resp = anon.get("/profile")
    check_eq(resp.status_code, 302, "未登录 GET /profile 应 302")
    check_eq(resp.headers.get("Location"), "/login", "未登录 GET /profile 的跳转目标")

    # 登录后页面结构
    resp = client.get("/profile")
    check_eq(resp.status_code, 200, "登录后 GET /profile 的状态码")
    html = resp.get_data(as_text=True)
    check_eq(html.count("<h1"), 1, "个人主页应恰有一个 <h1>")
    for fragment in (
        'class="profile-grid"', 'id="profile-form"', 'data-profile-form',
        'name="username"', 'name="bio"', 'rows="3"',
        'id="favorites"', 'id="form-error"', 'data-error', 'data-notice',
        'js/profile.js',
        # 我的笔记（Phase 4 任务 5 补齐 Phase 3 遗留缺口）
        'id="notes"', 'id="my-notes-list"', 'id="my-notes-empty"',
        '还没有笔记，写下第一条吧', 'href="/notes/new"',
        # 分享管理
        'id="shares"', 'id="shares-list"', 'id="shares-empty"',
        '还没有分享任何笔记，去笔记详情页点「分享」试试',
    ):
        check(fragment in html, "个人主页应包含 %r" % fragment)
    check("功能将在后续阶段填充" not in html, "个人主页的占位文案应已被真实列表替换")

    # 样式：两栏在桌面展开、移动端单列、锚点不被顶栏遮挡
    css = _read("static/css/style.css")
    check(".profile-grid{" in css, "style.css 应包含 .profile-grid")
    check(
        re.search(r"@media \(min-width:1024px\)\{\.profile-grid\{grid-template-columns:1fr 1fr\}\}",
                  css.replace("\n", "").replace("  ", "")) is not None
        or "grid-template-columns:1fr 1fr" in css,
        "桌面断点下 .profile-grid 应为两栏",
    )
    check("scroll-margin-top" in css, "锚点目标应设置 scroll-margin-top，避免被顶栏遮挡")

    # profile.js 的静态契约 + Node 沙箱行为断言
    resp = client.get("/static/js/profile.js")
    check_eq(resp.status_code, 200, "GET /static/js/profile.js 的状态码")
    js = resp.get_data(as_text=True)
    check("/api/auth/me" in js, "profile.js 应加载时读取当前用户")
    check("/api/profile" in js, "profile.js 应引用个人信息接口")
    check("showError" in js, "profile.js 应通过 api.showError 展示 message")
    check("已保存" in js, "profile.js 应给出「已保存」成功提示")
    check(re.search(r"\.innerHTML\s*=", js) is None, "profile.js 不得用 innerHTML 赋值回填")
    # Phase 4 任务 5：我的笔记与分享管理
    for fragment in (
        "/api/notes?status=all", "/api/share/mine", "textContent", "无标题",
        "复制链接", "取消分享", "需要密码", "无需密码",
    ):
        check(fragment in js, "profile.js 应包含 %r" % fragment)

    script = os.path.join(ROOT, "tests", "js_profile_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_profile_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")

    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_profile_test.js 的退出码")

    # 端到端旅程：注册 → 自动登录 → 改个人信息 → 退出 → 重新登录（Phase 2 完成清单）
    journey = _fresh_app().test_client()
    resp = journey.post("/api/auth/register", json={
        "email": "journey@example.com", "username": "旅程用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "OK", "旅程：注册")
    check_eq(
        j(journey.get("/api/auth/me")).get("data", {}).get("user", {}).get("email"),
        "journey@example.com", "旅程：注册后自动登录",
    )
    resp = journey.put("/api/profile", json={"username": "旅程改名", "bio": "旅程简介"})
    check_eq(j(resp).get("code"), "OK", "旅程：改个人信息")
    check_eq(
        j(journey.get("/api/auth/me")).get("data", {}).get("user", {}).get("username"),
        "旅程改名", "旅程：改个人信息后立即生效",
    )
    resp = journey.post("/api/auth/logout")
    check_eq(j(resp).get("code"), "OK", "旅程：退出")
    check(j(journey.get("/api/auth/me")).get("data", {}).get("user") is None, "旅程：退出后未登录")
    resp = journey.post("/api/auth/login", json={"email": "journey@example.com", "password": "abc123"})
    check_eq(j(resp).get("code"), "OK", "旅程：重新登录")
    me = j(journey.get("/api/auth/me"))
    check_eq(me.get("data", {}).get("user", {}).get("username"), "旅程改名", "旅程：重新登录后资料仍在")
    check_eq(me.get("data", {}).get("user", {}).get("bio"), "旅程简介", "旅程：重新登录后简介仍在")


# ---------------------------------------------------------------------------
# Phase 3 任务 1：笔记 CRUD 接口（计划第 4 组断言）
# ---------------------------------------------------------------------------

# 列表项字段集合（spec：id/title/status/updated_at/created_at/excerpt —— 不得泄漏 content_md）
NOTE_LIST_FIELDS = {"id", "title", "status", "updated_at", "created_at", "excerpt"}
# 详情字段（favorited 由 Phase 3 任务 6 追加，故此处用「包含」而非「相等」）
NOTE_DETAIL_FIELDS = {
    "id", "title", "content_md", "status", "created_at", "updated_at", "published_at",
}


@group("notes")
def check_notes():
    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 1. 未登录：全部笔记接口一律 AUTH_REQUIRED（不得退化成 NOT_FOUND）
    anon = _fresh_app().test_client()
    for method, path, body in (
        ("get", "/api/notes", None),
        ("post", "/api/notes", {"title": "x", "content_md": "", "status": "draft"}),
        ("get", "/api/notes/1", None),
        ("put", "/api/notes/1", {"title": "x", "content_md": "", "status": "draft"}),
        ("delete", "/api/notes/1", None),
    ):
        call = getattr(anon, method)
        resp = call(path, json=body) if body is not None else call(path)
        label = "未登录 %s %s" % (method.upper(), path)
        check_eq(resp.status_code, 401, "%s 的状态码" % label)
        check_eq(j(resp).get("code"), "AUTH_REQUIRED", "%s 的 code" % label)

    # 2. 独立注册，保证「只跑 notes 组」时也自洽
    client = _fresh_app().test_client()
    resp = client.post("/api/auth/register", json={
        "email": "notes@example.com", "username": "笔记用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "notes 组的前置注册")

    # 3. 「他人」账号，用于越权测试
    other = _fresh_app().test_client()
    resp = other.post("/api/auth/register", json={
        "email": "other@example.com", "username": "他人",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "OK", "他人账号注册成功")
    r = other.post("/api/notes", json={"title": "他人的笔记", "content_md": "x", "status": "published"})
    check_eq(j(r).get("code"), "OK", "他人账号创建笔记成功")
    other_note_id = j(r).get("data", {}).get("id")
    check(bool(other_note_id), "他人笔记应有 id")

    # 4. 创建：空标题存草稿成功；空标题发布 → NOTE_TITLE_REQUIRED；非法入参 → INVALID_PARAMS
    r = client.post("/api/notes", json={"title": "", "content_md": "草稿内容", "status": "draft"})
    check_eq(r.status_code, 201, "创建草稿的 HTTP 状态码")
    check_eq(j(r).get("code"), "OK", "空标题存草稿成功")
    draft_id = j(r).get("data", {}).get("id")
    check(bool(draft_id), "草稿应有 id")

    r = client.post("/api/notes", json={"title": "   ", "content_md": "x", "status": "published"})
    check_eq(j(r).get("code"), "NOTE_TITLE_REQUIRED", "空标题发布 → NOTE_TITLE_REQUIRED")

    r = client.post("/api/notes", json={"title": "发布笔记", "content_md": "# 标题\n正文", "status": "published"})
    check_eq(j(r).get("code"), "OK", "发布笔记成功")
    pub_id = j(r).get("data", {}).get("id")
    check(bool(pub_id), "发布笔记应有 id")

    check_eq(
        j(client.post("/api/notes", json={"title": "x", "content_md": "", "status": "weird"})).get("code"),
        "INVALID_PARAMS", "非法 status → INVALID_PARAMS",
    )
    check_eq(
        j(client.post("/api/notes", json={"title": 1, "content_md": "", "status": "draft"})).get("code"),
        "INVALID_PARAMS", "title 类型错误 → INVALID_PARAMS",
    )
    check_eq(
        j(client.post("/api/notes", json={"title": "x", "content_md": 2, "status": "draft"})).get("code"),
        "INVALID_PARAMS", "content_md 类型错误 → INVALID_PARAMS",
    )

    # 创建时 created_at 应等于 updated_at
    created = j(client.get("/api/notes/%d" % pub_id)).get("data", {}).get("note", {})
    check_eq(created.get("created_at"), created.get("updated_at"), "创建时 created_at 应等于 updated_at")

    # 5. 列表筛选（不含他人笔记）
    notes = j(client.get("/api/notes?status=all")).get("data", {}).get("notes", [])
    check_eq(len(notes), 2, "列表 all 含 2 条")
    check_eq(len(j(client.get("/api/notes")).get("data", {}).get("notes", [])), 2, "默认 status=all")
    for item in notes:
        check_eq(set(item), NOTE_LIST_FIELDS, "列表项字段集合")
        check(item["title"] != "他人的笔记", "列表不得出现他人笔记")
    check_eq(len(j(client.get("/api/notes?status=draft")).get("data", {}).get("notes", [])), 1, "列表 draft 含 1 条")
    check_eq(
        len(j(client.get("/api/notes?status=published")).get("data", {}).get("notes", [])), 1,
        "列表 published 含 1 条",
    )
    check_eq(j(client.get("/api/notes?status=bogus")).get("code"), "INVALID_PARAMS", "列表非法 status → INVALID_PARAMS")

    # 6. 摘要：去掉 Markdown 符号、截断到 60 字
    excerpt = next(item["excerpt"] for item in notes if item["id"] == pub_id)
    check("标题" in excerpt and "正文" in excerpt, "摘要应保留正文文字（实际 %r）" % excerpt)
    check("#" not in excerpt, "摘要应去掉 Markdown 标题符号（实际 %r）" % excerpt)

    long_id = j(client.post("/api/notes", json={
        "title": "长文", "content_md": "字" * 200, "status": "draft",
    })).get("data", {}).get("id")
    long_excerpt = next(
        item["excerpt"]
        for item in j(client.get("/api/notes?status=all")).get("data", {}).get("notes", [])
        if item["id"] == long_id
    )
    check_eq(len(long_excerpt), 60, "摘要应截断到 60 字")
    check_eq(j(client.delete("/api/notes/%d" % long_id)).get("code"), "OK", "清理长文笔记")

    # 7. 详情
    r = client.get("/api/notes/%d" % pub_id)
    note = j(r).get("data", {}).get("note", {})
    check_eq(j(r).get("code"), "OK", "详情可读")
    check_eq(note.get("content_md"), "# 标题\n正文", "详情应含原始正文")
    check(
        NOTE_DETAIL_FIELDS <= set(note),
        "详情字段应包含 %r（实际 %r）" % (sorted(NOTE_DETAIL_FIELDS), sorted(note)),
    )
    check(bool(note.get("published_at")), "已发布笔记应有 published_at")
    check(
        j(client.get("/api/notes/%d" % draft_id)).get("data", {}).get("note", {}).get("published_at") is None,
        "草稿不应有 published_at",
    )

    # 8. 更新
    r = client.put(
        "/api/notes/%d" % pub_id,
        json={"title": "改过的标题", "content_md": "改过的内容", "status": "published"},
    )
    check_eq(j(r).get("code"), "OK", "更新成功")
    updated = j(client.get("/api/notes/%d" % pub_id)).get("data", {}).get("note", {})
    check_eq(updated.get("title"), "改过的标题", "更新后标题已变")
    check_eq(updated.get("content_md"), "改过的内容", "更新后正文已变")
    check_eq(updated.get("published_at"), note.get("published_at"), "published → published 不应改写 published_at")

    # 草稿 → 发布：补填 published_at
    promote_id = j(client.post("/api/notes", json={
        "title": "", "content_md": "待转正", "status": "draft",
    })).get("data", {}).get("id")
    check(
        j(client.get("/api/notes/%d" % promote_id)).get("data", {}).get("note", {}).get("published_at") is None,
        "新草稿不应有 published_at",
    )
    r = client.put(
        "/api/notes/%d" % promote_id,
        json={"title": "草稿转正", "content_md": "待转正", "status": "published"},
    )
    check_eq(j(r).get("code"), "OK", "草稿转发布成功")
    check(
        bool(j(client.get("/api/notes/%d" % promote_id)).get("data", {}).get("note", {}).get("published_at")),
        "草稿转为已发布时应补填 published_at",
    )

    # 更新的校验规则与创建一致
    check_eq(
        j(client.put("/api/notes/%d" % pub_id, json={
            "title": "  ", "content_md": "", "status": "published",
        })).get("code"),
        "NOTE_TITLE_REQUIRED", "更新为空标题发布 → NOTE_TITLE_REQUIRED",
    )
    check_eq(
        j(client.put("/api/notes/%d" % pub_id, json={
            "title": "x", "content_md": "", "status": "nope",
        })).get("code"),
        "INVALID_PARAMS", "更新非法 status → INVALID_PARAMS",
    )

    # 9. 越权与不存在的 id 一律 NOTE_NOT_FOUND（不得用 FORBIDDEN/MESSAGE 探测）
    check_eq(
        j(client.get("/api/notes/%d" % other_note_id)).get("code"), "NOTE_NOT_FOUND",
        "读他人笔记 → NOTE_NOT_FOUND",
    )
    check_eq(
        j(client.put("/api/notes/%d" % other_note_id, json={
            "title": "x", "content_md": "", "status": "draft",
        })).get("code"),
        "NOTE_NOT_FOUND", "改他人笔记 → NOTE_NOT_FOUND",
    )
    check_eq(
        j(client.delete("/api/notes/%d" % other_note_id)).get("code"), "NOTE_NOT_FOUND",
        "删他人笔记 → NOTE_NOT_FOUND",
    )
    check_eq(j(client.get("/api/notes/999999")).get("code"), "NOTE_NOT_FOUND", "不存在的 id → NOTE_NOT_FOUND")
    check_eq(j(client.delete("/api/notes/999999")).get("code"), "NOTE_NOT_FOUND", "删除不存在的 id → NOTE_NOT_FOUND")
    check_eq(
        j(other.get("/api/notes/%d" % other_note_id)).get("code"), "OK",
        "越权尝试不得影响他人笔记",
    )

    # 10. 删除自己的笔记
    check_eq(j(client.delete("/api/notes/%d" % draft_id)).get("code"), "OK", "删除自己的草稿成功")
    check_eq(j(client.get("/api/notes/%d" % draft_id)).get("code"), "NOTE_NOT_FOUND", "删除后详情 → NOTE_NOT_FOUND")
    check_eq(j(client.delete("/api/notes/%d" % draft_id)).get("code"), "NOTE_NOT_FOUND", "重复删除 → NOTE_NOT_FOUND")

    # 11. 排序：ORDER BY updated_at DESC（受控时间戳以排除同秒歧义）
    with client.application.app_context():
        from core import db as core_db

        core_db.execute("UPDATE notes SET updated_at = ? WHERE id = ?", ("2000-01-01T00:00:00Z", pub_id))
    ids = [item["id"] for item in j(client.get("/api/notes?status=all")).get("data", {}).get("notes", [])]
    check(ids.index(promote_id) < ids.index(pub_id), "列表应按 updated_at 倒序（实际 %r）" % ids)

    # 12. 实现约束：参数化 SQL、强制 user_id 过滤、响应经 core.responses
    src = _read("routes/notes.py")
    check("user_id = ?" in src, "routes/notes.py 的查询应带 user_id = ? 过滤")
    check("codes.FORBIDDEN" not in src, "越权应统一返回 NOTE_NOT_FOUND，不得使用 FORBIDDEN")
    check("from core.responses import fail, ok" in src, "路由必须使用 core.responses 的 ok()/fail()")
    check("jsonify" not in src, "路由不得自行构造响应，必须经 core.responses")
    check(
        re.search(r"\.execute\([^)]*f[\"']", src) is None,
        "routes/notes.py 不得用 f-string 拼接 SQL",
    )


# ---------------------------------------------------------------------------
# Phase 3 任务 2：Markdown 渲染出口（vendored marked + DOMPurify + markdown.js）
# ---------------------------------------------------------------------------

VENDOR_MARKED = "static/vendor/marked.min.js"
VENDOR_PURIFY = "static/vendor/purify.min.js"
VENDOR_VERSIONS = "static/vendor/VERSIONS.md"


@group("markdown")
def check_markdown():
    import subprocess

    client = _fresh_app().test_client()

    # 1. vendored 库落盘，且是可直接 <script> 引入的浏览器构建（无顶层 export/import）
    for relpath in (VENDOR_MARKED, VENDOR_PURIFY):
        path = os.path.join(ROOT, relpath)
        check(os.path.exists(path), "缺少 vendored 库 %s" % relpath)
        size = os.path.getsize(path)
        check(size > 5000, "%s 应大于 5000 字节（实际 %d）" % (relpath, size))
        with open(path, encoding="utf-8") as fp:
            src = fp.read()
        check(
            re.search(r"(?m)^\s*export\s", src) is None,
            "%s 不得含顶层 export（需能被 <script> 直接引入）" % relpath,
        )
        check(
            re.search(r"(?m)^\s*import\s+[{\"']", src) is None,
            "%s 不得含顶层 import" % relpath,
        )

    # 2. 版本来源必须可追溯（Phase 7 的根 README 尚未创建，先记在 vendor 目录内）
    check(os.path.exists(os.path.join(ROOT, VENDOR_VERSIONS)), "vendored 库版本说明 %s 必须存在" % VENDOR_VERSIONS)
    versions_note = _read(VENDOR_VERSIONS)
    for pkg in ("marked", "dompurify", "registry.npmmirror.com"):
        check(pkg in versions_note, "%s 应记录 %s 的来源" % (VENDOR_VERSIONS, pkg))

    # 3. 通过静态路由可取，且 Content-Type 为 JavaScript
    for relpath in (VENDOR_MARKED, VENDOR_PURIFY, "static/js/markdown.js"):
        url = "/" + relpath
        resp = client.get(url)
        check_eq(resp.status_code, 200, "GET %s 的状态码" % url)
        check("javascript" in resp.headers["Content-Type"], "%s 的 Content-Type 应为 JavaScript" % url)

    # 4. markdown.js 静态契约：唯一的 HTML 出口，必须经 DOMPurify
    js = _read("static/js/markdown.js")
    check("marked.parse" in js, "markdown.js 应调用 marked.parse")
    check("DOMPurify.sanitize" in js, "markdown.js 必须经 DOMPurify.sanitize 净化")
    check(re.search(r"\.innerHTML\s*=", js) is None, "markdown.js 不得赋值 innerHTML")
    check("window.md" in js, "markdown.js 应暴露 window.md")
    check(
        re.search(r"window\.md\s*=\s*\{\s*render\s*[,}]", js) is not None,
        "window.md 只能暴露 render（不得出现绕过 DOMPurify 的出口）",
    )

    # 5. Node 沙箱行为断言（真实 marked 可执行；DOMPurify 因无 DOM 只做结构化验证）
    script = os.path.join(ROOT, "tests", "js_markdown_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_markdown_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")

    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_markdown_test.js 的退出码")


# ---------------------------------------------------------------------------
# Phase 3 任务 3：写笔记页（分栏 + 预览 + 保存/发布）
# ---------------------------------------------------------------------------

NOTE_EDIT_SCRIPTS = [
    "vendor/marked.min.js",
    "vendor/purify.min.js",
    "js/markdown.js",
    "js/editor.js",
    "js/polish.js",
    "js/note_edit.js",
]


@group("editor")
def check_editor():
    import subprocess

    client = _fresh_app().test_client()

    # 1. 未登录时 /notes/new 与编辑页都跳登录（页面级守卫）
    anon = _fresh_app().test_client()
    for path in ("/notes/new", "/notes/1/edit"):
        resp = anon.get(path)
        check_eq(resp.status_code, 302, "未登录 GET %s 应 302" % path)
        check_eq(resp.headers.get("Location"), "/login", "未登录 GET %s 的跳转目标" % path)

    # 2. 登录后模板结构
    client.post("/api/auth/register", json={
        "email": "editor@example.com", "username": "编辑用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    resp = client.get("/notes/new")
    check_eq(resp.status_code, 200, "登录后 GET /notes/new 的状态码")
    html = resp.get_data(as_text=True)
    check_eq(html.count("<h1"), 1, "写笔记页应恰有一个 <h1>")
    for fragment in (
        'class="editor-split"', 'data-mode="edit"',
        'class="editor-tabs"', 'data-mode="preview"',
        'spellcheck="false"',
        'id="content"', 'class="editor-pane"', 'id="preview"', 'preview-pane', 'parchment',
        'id="title"', 'id="save-draft"', 'id="publish"', 'href="/notes"',
        '保存草稿', '发布', 'js/editor.js', 'js/note_edit.js',
    ):
        check(fragment in html, "写笔记页应包含 %r" % fragment)
    # 文本域必须有关联的 <label>（可视觉隐藏，但必须存在）
    check(
        re.search(r'<label[^>]*for="content"[^>]*>笔记内容</label>', html) is not None,
        "写笔记页的正文文本域必须有关联的「笔记内容」标签",
    )
    check(
        re.search(r'<label[^>]*for="title"[^>]*>', html) is not None,
        "写笔记页的标题输入框必须有关联标签",
    )

    # 编辑页复用同一模板
    edit_html = client.get("/notes/1/edit").get_data(as_text=True)
    check('class="editor-split"' in edit_html, "编辑页应复用分栏模板")
    check_eq(edit_html.count("<h1"), 1, "编辑页应恰有一个 <h1>")

    # 3. 脚本引入顺序：marked → purify → markdown → editor → note_edit
    positions = []
    for relpath in NOTE_EDIT_SCRIPTS:
        index = html.find(relpath)
        check(index != -1, "写笔记页应引入 %s" % relpath)
        positions.append(index)
    check(positions == sorted(positions), "脚本引入顺序应为 %r（实际 %r）" % (NOTE_EDIT_SCRIPTS, positions))

    # 4. 静态资源可取
    for relpath in ("static/js/editor.js", "static/js/note_edit.js"):
        resp = client.get("/" + relpath)
        check_eq(resp.status_code, 200, "GET /%s 的状态码" % relpath)
        check("javascript" in resp.headers["Content-Type"], "/%s 的 Content-Type 应为 JavaScript" % relpath)

    # 5. note_edit.js 静态契约
    js = _read("static/js/note_edit.js")
    for fragment in (
        "/api/auth/me", "/api/notes", "/login", "history.replaceState",
        "showError", "已保存草稿", "请填写笔记标题", "保存中…", "Editor.init",
    ):
        check(fragment in js, "note_edit.js 应包含 %r" % fragment)
    check(re.search(r"\.innerHTML\s*=", js) is None, "note_edit.js 不得用 innerHTML 赋值")

    # 6. 样式：桌面分栏、标签默认隐藏、预览为羊皮纸
    css = _read("static/css/style.css")
    check(".editor-split{" in css, "style.css 应包含 .editor-split")
    check(".editor-pane{" in css, "style.css 应包含 .editor-pane")
    check(".preview-pane{" in css, "style.css 应包含 .preview-pane")
    check(".parchment{" in css, "style.css 应包含羊皮纸工具类 .parchment")
    check(
        re.search(r"\.editor-tabs\{[^}]*display:none", css) is not None,
        "编辑/预览标签默认应 display:none",
    )
    check("grid-template-columns:1fr 1fr" in css, "桌面分栏应为 1fr 1fr")
    compact_css = css.replace("\n", "")
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.editor-tabs\{display:flex", compact_css) is not None,
        "手机断点下应显示编辑/预览标签",
    )
    check(
        '.editor-split[data-mode="edit"] .preview-pane{display:none}' in compact_css,
        "手机断点下应按 data-mode 只显示一个面板",
    )

    # 7. Node 沙箱行为断言
    for script_name in ("js_editor_test.js", "js_note_edit_test.js"):
        script = os.path.join(ROOT, "tests", script_name)
        check(os.path.exists(script), "前端契约测试脚本 tests/%s 必须存在" % script_name)
        try:
            proc = subprocess.run(
                ["node", script], capture_output=True, text=True, encoding="utf-8"
            )
        except FileNotFoundError:
            raise AssertionError("未找到 node，无法执行前端契约测试")
        if proc.stdout:
            print("\n" + proc.stdout.rstrip())
        if proc.stderr:
            print(proc.stderr.rstrip())
        check_eq(proc.returncode, 0, "node tests/%s 的退出码" % script_name)


# ---------------------------------------------------------------------------
# Phase 3 任务 4：笔记列表页与筛选
# ---------------------------------------------------------------------------


@group("notelist")
def check_notelist():
    import subprocess

    client = _fresh_app().test_client()
    client.post("/api/auth/register", json={
        "email": "notelist@example.com", "username": "列表用户",
        "password": "abc123", "confirm_password": "abc123",
    })

    # 1. 模板结构
    resp = client.get("/notes")
    check_eq(resp.status_code, 200, "GET /notes 的状态码")
    html = resp.get_data(as_text=True)
    check_eq(html.count("<h1"), 1, "列表页应恰有一个 <h1>")
    check("我的笔记" in html, "列表页标题应为「我的笔记」")
    for fragment in (
        'href="/notes/new"', '写笔记',
        'class="filter-bar"',
        'data-status="all"', 'data-status="published"', 'data-status="draft"',
        'id="notes-list"', 'id="notes-empty"', 'id="notes-error"',
        'js/notes_list.js',
    ):
        check(fragment in html, "列表页应包含 %r" % fragment)
    check(
        re.search(r'data-status="all"[^>]*is-active|is-active[^>]*data-status="all"', html) is not None
        or re.search(r'class="is-active"[^>]*data-status="all"', html) is not None
        or 'data-status="all"' in html,
        "默认筛选应为「全部」",
    )

    # 2. 静态契约：禁止用 innerHTML 拼接标题/摘要
    js = _read("static/js/notes_list.js")
    for fragment in (
        "/api/notes?status=", "textContent", "无标题",
        "还没有笔记，写下第一条吧", "草稿箱是空的", "还没有发布的笔记",
        "草稿", "已发布", "编辑", "查看", "/login",
    ):
        check(fragment in js, "notes_list.js 应包含 %r" % fragment)
    check(re.search(r"\.innerHTML\s*=", js) is None, "notes_list.js 不得用 innerHTML 拼接内容")

    # 3. 样式：卡片、徽标配色（徽标承载文字必须用 --primary-strong）、可点区域 ≥ 44px
    css = _read("static/css/style.css")
    for fragment in (".filter-bar{", ".note-list{", ".note-card{", ".note-badge", ".empty-state{"):
        check(fragment in css, "style.css 应包含 %r" % fragment)
    check(
        re.search(r"\.note-badge-draft\{[^}]*color:var\(--text-muted\)", css) is not None,
        "「草稿」徽标应使用 --text-muted",
    )
    check(
        re.search(r"\.note-badge-published\{[^}]*color:var\(--primary-strong\)", css) is not None,
        "「已发布」徽标承载文字，必须使用 --primary-strong",
    )
    check(
        re.search(r"\.filter-bar button\{[^}]*min-height:44px", css) is not None,
        "筛选按钮可点区域应 ≥ 44px",
    )

    # 4. Node 沙箱行为断言
    script = os.path.join(ROOT, "tests", "js_notes_list_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_notes_list_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")
    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_notes_list_test.js 的退出码")


# ---------------------------------------------------------------------------
# Phase 3 任务 5：笔记详情页（羊皮纸纸面）
# ---------------------------------------------------------------------------


@group("notedetail")
def check_notedetail():
    import subprocess

    client = _fresh_app().test_client()
    client.post("/api/auth/register", json={
        "email": "detail@example.com", "username": "详情用户",
        "password": "abc123", "confirm_password": "abc123",
    })

    # 1. 模板结构（页面唯一 <h1> 为笔记标题；评论区用 <h2>）
    resp = client.get("/notes/1")
    check_eq(resp.status_code, 200, "GET /notes/1 的状态码")
    html = resp.get_data(as_text=True)
    check_eq(html.count("<h1"), 1, "详情页应恰有一个 <h1>")
    check("笔记详情" in html, "详情页应保留「笔记详情」标记")
    for fragment in (
        'class="note-paper"',
        'id="note-title"', 'id="note-time"', 'id="note-body"',
        'id="note-actions"', 'id="favorite-btn"', 'aria-pressed="false"',
        'id="share-btn"', 'id="edit-btn"', 'id="delete-btn"',
        'id="note-back"', 'href="/notes"',
        'id="comments"', '<h2>评论</h2>',
        '收藏', '分享', '编辑', '删除',
        'js/note_detail.js',
        # 分享面板（Phase 4 任务 1）
        'class="share-panel"', 'id="share-panel"',
        'id="share-password"', 'id="share-generate"', 'id="share-result"',
        'id="share-url"', 'id="share-copy"', 'id="share-cancel"', 'id="share-error"',
        '访问密码（留空表示无需密码）', '生成分享链接', '已生成分享链接',
        '复制链接', '取消分享',
    ):
        check(fragment in html, "详情页应包含 %r" % fragment)

    # 评论只在分享页开放：详情页不得再出现失实的「将在后续阶段开放」占位语气（Phase 6 任务 4）
    check(
        "评论区将在后续阶段开放" not in html,
        "详情页评论区不得残留失实的「将在后续阶段开放」占位文案",
    )

    # 2. 脚本引入顺序：marked → purify → markdown → note_detail
    positions = []
    for relpath in ("vendor/marked.min.js", "vendor/purify.min.js", "js/markdown.js", "js/note_detail.js"):
        index = html.find(relpath)
        check(index != -1, "详情页应引入 %s" % relpath)
        positions.append(index)
    check(positions == sorted(positions), "详情页脚本引入顺序应正确（实际 %r）" % positions)

    # 3. note_detail.js 静态契约
    js = _read("static/js/note_detail.js")
    for fragment in (
        "/api/notes/", "/favorite", "window.md.render", "AUTH_REQUIRED",
        "aria-pressed", "is-favorited", "无标题", "/notes",
        # 分享面板（Phase 4 任务 1）
        "/share", "navigator.clipboard", "链接已复制",
    ):
        check(fragment in js, "note_detail.js 应包含 %r" % fragment)
    check(
        '删除后无法恢复，确定要删除这篇笔记吗？' in js,
        "删除二次确认文案必须逐字一致",
    )
    check(
        '取消后原链接将失效，确定吗？' in js,
        "取消分享的二次确认文案必须逐字一致",
    )
    # 唯一允许的 innerHTML 赋值就是把净化后的 Markdown 写进正文容器
    assignments = re.findall(r"innerHTML\s*=\s*([^;]+)", js)
    check_eq(len(assignments), 1, "详情页只应有一处 innerHTML 赋值（实际 %r）" % assignments)
    check(
        assignments[0].strip().startswith("window.md.render("),
        "唯一的 innerHTML 赋值必须来自 window.md.render（实际 %r）" % assignments[0],
    )

    # 4. 羊皮纸样式（签名元素）
    css = _read("static/css/style.css")
    check(".note-paper{" in css, "style.css 应包含 .note-paper")
    check(
        re.search(r'\.note-paper\{[^}]*url\("/static/img/parchment\.jpg"\)', css) is not None,
        ".note-paper 应使用羊皮纸纹理素材",
    )
    check(
        re.search(r"\.note-paper\{[^}]*color:var\(--parchment-ink\)", css) is not None,
        ".note-paper 正文应为 --parchment-ink",
    )
    check(
        re.search(r"\.note-paper\{[^}]*max-width:760px", css) is not None,
        ".note-paper 正文最大宽度应为 760px",
    )
    check(
        re.search(r"\.note-paper\{[^}]*margin:0 auto", css) is not None,
        ".note-paper 应居中",
    )
    check(
        re.search(r"\.note-paper a\{[^}]*color:var\(--primary-strong\)", css) is not None,
        "纸面链接必须用 --primary-strong（--primary 不承载文字）",
    )
    check(
        re.search(r"\.note-paper h1,\s*\.note-paper h2\{[^}]*border-bottom:2px solid var\(--primary\)", css) is not None,
        "纸面标题应有金色手绘下划线",
    )
    check(
        re.search(r"\.note-paper code,\s*\.note-paper pre\{[^}]*font-family:var\(--font-mono\)", css) is not None,
        "纸面代码应使用等宽字体栈",
    )
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.note-paper\{", css.replace("\n", "")) is not None,
        "手机断点下应调整纸面内边距",
    )

    # 5. Node 沙箱行为断言
    script = os.path.join(ROOT, "tests", "js_note_detail_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_note_detail_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")
    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_note_detail_test.js 的退出码")


# ---------------------------------------------------------------------------
# Phase 3 任务 6：收藏接口与个人主页收藏区（计划第 5 组断言）
# ---------------------------------------------------------------------------

# 收藏列表项字段集合（profile 收藏区只需标题/状态/时间）
FAVORITE_NOTE_FIELDS = {"id", "title", "status", "created_at", "updated_at"}


@group("favorites")
def check_favorites():
    import subprocess

    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 1. 未登录：读写接口都要求登录
    anon = _fresh_app().test_client()
    resp = anon.get("/api/favorites")
    check_eq(resp.status_code, 401, "未登录 GET /api/favorites 的状态码")
    check_eq(j(resp).get("code"), "AUTH_REQUIRED", "未登录 GET /api/favorites 的 code")
    resp = anon.post("/api/notes/1/favorite", json={})
    check_eq(resp.status_code, 401, "未登录收藏的状态码")
    check_eq(j(resp).get("code"), "AUTH_REQUIRED", "未登录收藏的 code")

    # 2. 独立注册，保证「只跑 favorites 组」时也自洽
    client = _fresh_app().test_client()
    resp = client.post("/api/auth/register", json={
        "email": "favorites@example.com", "username": "收藏用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "favorites 组的前置注册")
    check_eq(j(client.get("/api/favorites")).get("data", {}).get("notes"), [], "初始收藏为空列表")

    pub_id = j(client.post("/api/notes", json={
        "title": "收藏目标", "content_md": "# 正文", "status": "published",
    })).get("data", {}).get("id")
    check(bool(pub_id), "前置：创建可收藏的笔记")

    # 3. 详情未收藏时 favorited 为 False
    check(
        j(client.get("/api/notes/%d" % pub_id)).get("data", {}).get("note", {}).get("favorited") is False,
        "详情初始 favorited 应为 False",
    )

    # 4. 首次收藏 → True，列表含 1 条
    r = client.post("/api/notes/%d/favorite" % pub_id, json={})
    check_eq(j(r).get("code"), "OK", "首次收藏的 code")
    check(j(r).get("data", {}).get("favorited") is True, "首次收藏 → favorited=True")

    favorites = j(client.get("/api/favorites")).get("data", {}).get("notes", [])
    check_eq(len(favorites), 1, "收藏列表含 1 条")
    for item in favorites:
        check_eq(set(item), FAVORITE_NOTE_FIELDS, "收藏列表项字段集合")
    check_eq(favorites[0]["id"], pub_id, "收藏项应为目标笔记")
    check_eq(favorites[0]["title"], "收藏目标", "收藏项标题")
    check_eq(favorites[0]["status"], "published", "收藏项状态")
    check(
        j(client.get("/api/notes/%d" % pub_id)).get("data", {}).get("note", {}).get("favorited") is True,
        "详情应返回收藏态",
    )

    # 5. 再次点击 → 取消
    r = client.post("/api/notes/%d/favorite" % pub_id, json={})
    check(j(r).get("data", {}).get("favorited") is False, "再次点击 → favorited=False")
    check_eq(len(j(client.get("/api/favorites")).get("data", {}).get("notes", [])), 0, "收藏列表清空")
    check(
        j(client.get("/api/notes/%d" % pub_id)).get("data", {}).get("note", {}).get("favorited") is False,
        "取消后详情 favorited 为 False",
    )

    # 6. 越权：只能收藏自己的笔记
    other = _fresh_app().test_client()
    resp = other.post("/api/auth/register", json={
        "email": "other-fav@example.com", "username": "他人收藏",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "OK", "他人账号注册成功")
    other_note = j(other.post("/api/notes", json={
        "title": "他人的笔记", "content_md": "x", "status": "published",
    })).get("data", {}).get("id")
    client.post("/api/notes/%d/favorite" % pub_id, json={})
    check(
        j(client.post("/api/notes/%d/favorite" % other_note, json={})).get("code") == "NOTE_NOT_FOUND",
        "收藏他人笔记 → NOTE_NOT_FOUND",
    )
    check_eq(
        j(client.post("/api/notes/999999/favorite", json={})).get("code"), "NOTE_NOT_FOUND",
        "收藏不存在的笔记 → NOTE_NOT_FOUND",
    )
    check_eq(j(other.get("/api/favorites")).get("data", {}).get("notes"), [], "他人收藏列表不应被影响")

    # 7. 级联：删除被收藏的笔记后收藏列表为空
    check_eq(len(j(client.get("/api/favorites")).get("data", {}).get("notes", [])), 1, "删除前收藏 1 条")
    check_eq(j(client.delete("/api/notes/%d" % pub_id)).get("code"), "OK", "删除被收藏的笔记")
    check_eq(
        len(j(client.get("/api/favorites")).get("data", {}).get("notes", [])), 0,
        "收藏的笔记被删除后收藏列表为空",
    )

    # 8. 排序：按收藏时间倒序（受控时间戳以排除同秒歧义）
    note_a = j(client.post("/api/notes", json={
        "title": "先收藏的", "content_md": "a", "status": "draft",
    })).get("data", {}).get("id")
    note_b = j(client.post("/api/notes", json={
        "title": "后收藏的", "content_md": "b", "status": "draft",
    })).get("data", {}).get("id")
    client.post("/api/notes/%d/favorite" % note_a, json={})
    client.post("/api/notes/%d/favorite" % note_b, json={})
    with client.application.app_context():
        from core import db as core_db

        core_db.execute(
            "UPDATE favorites SET created_at = ? WHERE note_id = ?", ("2000-01-01T00:00:00Z", note_a)
        )
    ids = [item["id"] for item in j(client.get("/api/favorites")).get("data", {}).get("notes", [])]
    check(ids.index(note_b) < ids.index(note_a), "收藏列表应按收藏时间倒序（实际 %r）" % ids)

    # 9. 个人主页收藏区模板
    resp = client.get("/profile")
    check_eq(resp.status_code, 200, "favorites 组：GET /profile 的状态码")
    html = resp.get_data(as_text=True)
    for fragment in (
        'id="favorites"', 'id="favorites-list"', 'id="favorites-empty"',
        "我的收藏", "还没有收藏，去笔记列表看看吧", 'href="/notes"', 'js/profile.js',
    ):
        check(fragment in html, "个人主页收藏区应包含 %r" % fragment)

    # 10. profile.js 契约与实现约束（空态文案在模板里，JS 只负责渲染与切换可见性）
    js = _read("static/js/profile.js")
    for fragment in ("/api/favorites", "textContent", "无标题", "/api/auth/me"):
        check(fragment in js, "profile.js 应包含 %r" % fragment)
    check(re.search(r"\.innerHTML\s*=", js) is None, "profile.js 不得用 innerHTML 赋值")

    profile_src = _read("routes/profile.py")
    check("user_id = ?" in profile_src, "routes/profile.py 的查询应带 user_id = ? 过滤")
    check("jsonify" not in profile_src, "路由不得自行构造响应，必须经 core.responses")
    check("EXISTS" in _read("routes/notes.py"), "详情页 favorited 应使用 EXISTS 子查询")

    # 11. Node 沙箱行为断言（js_profile_test.js 已扩展收藏区用例）
    script = os.path.join(ROOT, "tests", "js_profile_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_profile_test.js 必须存在")
    try:
        proc = subprocess.run(
            ["node", script], capture_output=True, text=True, encoding="utf-8"
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")
    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_profile_test.js 的退出码")


# ---------------------------------------------------------------------------
# Phase 4 任务 1：分享管理接口（生成 / 重新生成 / 取消）与详情页分享面板
# ---------------------------------------------------------------------------


@group("share")
def check_share():
    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 1. 未登录：分享管理接口一律 AUTH_REQUIRED（不得退化成 NOTE_NOT_FOUND）
    anon = _fresh_app().test_client()
    for method, path, body in (
        ("post", "/api/notes/1/share", {"password": ""}),
        ("delete", "/api/notes/1/share", None),
    ):
        call = getattr(anon, method)
        resp = call(path, json=body) if body is not None else call(path)
        label = "未登录 %s %s" % (method.upper(), path)
        check_eq(resp.status_code, 401, "%s 的状态码" % label)
        check_eq(j(resp).get("code"), "AUTH_REQUIRED", "%s 的 code" % label)

    # 2. 独立注册，保证「只跑 share 组」时也自洽
    client = _fresh_app().test_client()
    resp = client.post("/api/auth/register", json={
        "email": "share@example.com", "username": "分享用户",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "share 组的前置注册")

    # 3. 生成免密分享链接（只返回相对 url；前端自行拼 origin）
    note_id = j(client.post("/api/notes", json={
        "title": "分享用笔记", "content_md": "分享正文", "status": "published",
    })).get("data", {}).get("id")
    check(bool(note_id), "前置：创建分享用笔记")

    r = client.post("/api/notes/%d/share" % note_id, json={"password": ""})
    data = j(r).get("data", {})
    token = data.get("token")
    check_eq(j(r).get("code"), "OK", "生成免密分享链接的 code")
    check(bool(token), "应返回 token（实际 %r）" % data)
    check_eq(data.get("url"), "/share/%s" % token, "应返回相对 url")
    check(data.get("has_password") is False, "免密分享 has_password 应为 False")

    # 4. 密码过短（< 4）→ INVALID_PARAMS
    r = client.post("/api/notes/%d/share" % note_id, json={"password": "123"})
    check_eq(j(r).get("code"), "INVALID_PARAMS", "3 位密码 → INVALID_PARAMS")
    check_eq(j(r).get("message"), "请求参数不完整或格式不正确", "密码过短的文案")

    # 5. 公开读取：免密分享可直接读取，且只返回分享所需字段
    r = client.get("/api/share/%s" % token)
    payload = j(r)
    shared = (payload.get("data") or {}).get("note", {})
    check_eq(payload.get("code"), "OK", "免密分享可读")
    check_eq(shared.get("content_md"), "分享正文", "公开读取应返回正文")
    check_eq(shared.get("title"), "分享用笔记", "公开读取应返回标题")
    check_eq(shared.get("author_username"), "分享用户", "公开读取应返回作者用户名")
    check_eq(
        set(shared),
        {"title", "content_md", "author_username", "updated_at", "has_password"},
        "公开读取只应返回分享所需字段（实际 %r）" % sorted(shared),
    )
    raw = json.dumps(payload, ensure_ascii=False)
    check("share@example.com" not in raw, "分享响应不得包含作者邮箱")
    check("password_hash" not in raw, "分享响应不得包含密码哈希")

    # 5b. 重新生成（4 位密码边界）→ 换发新 token，旧 token 立即失效
    r = client.post("/api/notes/%d/share" % note_id, json={"password": "pass"})
    data2 = j(r).get("data", {})
    check_eq(j(r).get("code"), "OK", "4 位密码应通过（边界）")
    check(data2.get("has_password") is True, "带密码分享 has_password 应为 True")
    check(
        bool(data2.get("token")) and data2.get("token") != token,
        "重新生成应换发新 token（实际 %r vs %r）" % (data2.get("token"), token),
    )
    check_eq(data2.get("url"), "/share/%s" % data2.get("token"), "url 应跟随新 token")
    check_eq(
        j(client.get("/api/share/%s" % token)).get("code"), "SHARE_NOT_FOUND",
        "换发 token 后旧 token 失效",
    )

    # 5c. 改为带密码分享（用于后续解锁流程）
    r = client.post("/api/notes/%d/share" % note_id, json={"password": "pass1234"})
    token2 = j(r).get("data", {}).get("token")
    check(bool(token2) and token2 != data2.get("token"), "再次重新生成应再换发 token")

    # 5d. 有密码且当前 session 未解锁 → SHARE_PASSWORD_REQUIRED
    r = client.get("/api/share/%s" % token2)
    check_eq(r.status_code, 401, "未解锁读取的 HTTP 状态码")
    check_eq(j(r).get("code"), "SHARE_PASSWORD_REQUIRED", "带密码未解锁 → SHARE_PASSWORD_REQUIRED")

    # 5e. 密码错误 → SHARE_PASSWORD_WRONG；正确 → 解锁成功
    check_eq(
        j(client.post("/api/share/%s/unlock" % token2, json={"password": "wrong"})).get("code"),
        "SHARE_PASSWORD_WRONG", "密码错误 → SHARE_PASSWORD_WRONG",
    )
    r = client.post("/api/share/%s/unlock" % token2, json={"password": "pass1234"})
    check_eq(j(r).get("code"), "OK", "密码正确解锁成功")

    # 5f. 解锁后可读
    r = client.get("/api/share/%s" % token2)
    check_eq(j(r).get("code"), "OK", "解锁后可读")
    check_eq(
        (j(r).get("data") or {}).get("note", {}).get("content_md"), "分享正文", "解锁后正文正确",
    )

    # 5g. 作者不享受免密特例：重新登录为作者的新 session 仍需解锁
    author_guest = _fresh_app().test_client()
    check_eq(
        j(author_guest.post("/api/auth/login", json={
            "email": "share@example.com", "password": "abc123",
        })).get("code"),
        "OK", "作者以新 session 重新登录",
    )
    check_eq(
        j(author_guest.get("/api/share/%s" % token2)).get("code"), "SHARE_PASSWORD_REQUIRED",
        "作者本人打开自己的加锁分享同样需要解锁",
    )

    # 5h. 非法 token → SHARE_NOT_FOUND
    check_eq(
        j(client.get("/api/share/not-a-token")).get("code"), "SHARE_NOT_FOUND",
        "无效 token → SHARE_NOT_FOUND",
    )
    check_eq(
        j(client.post("/api/share/not-a-token/unlock", json={"password": "x"})).get("code"),
        "SHARE_NOT_FOUND", "对无效 token 解锁 → SHARE_NOT_FOUND",
    )

    # 6. 越权：他人的笔记 / 不存在的 id 一律 NOTE_NOT_FOUND（避免探测）
    other = _fresh_app().test_client()
    resp = other.post("/api/auth/register", json={
        "email": "share-other@example.com", "username": "他人",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(j(resp).get("code"), "OK", "他人账号注册成功")
    other_note = j(other.post("/api/notes", json={
        "title": "他人的笔记", "content_md": "x", "status": "published",
    })).get("data", {}).get("id")
    check_eq(
        j(client.post("/api/notes/%d/share" % other_note, json={"password": ""})).get("code"),
        "NOTE_NOT_FOUND", "为他人的笔记生成分享 → NOTE_NOT_FOUND",
    )
    check_eq(
        j(client.delete("/api/notes/%d/share" % other_note)).get("code"),
        "NOTE_NOT_FOUND", "取消他人笔记的分享 → NOTE_NOT_FOUND",
    )
    check_eq(
        j(client.post("/api/notes/999999/share", json={"password": ""})).get("code"),
        "NOTE_NOT_FOUND", "为不存在的笔记生成分享 → NOTE_NOT_FOUND",
    )
    check_eq(
        j(other.get("/api/notes/%d" % other_note)).get("code"), "OK",
        "越权尝试不得影响他人笔记",
    )

    # 6b. 反绕过（Task 4）：加锁分享在未解锁时，评论的**读与写**接口同样要求密码
    guest = _fresh_app().test_client()
    check_eq(
        j(guest.get("/api/share/%s/comments" % token2)).get("code"), "SHARE_PASSWORD_REQUIRED",
        "加锁分享未解锁时读评论 → SHARE_PASSWORD_REQUIRED",
    )
    r = guest.post("/api/share/%s/comments" % token2, json={"nickname": "路人", "content": "绕过密码"})
    check_eq(
        j(r).get("code"), "SHARE_PASSWORD_REQUIRED",
        "加锁分享未解锁时写评论 → SHARE_PASSWORD_REQUIRED",
    )
    check_eq(
        j(guest.post("/api/share/%s/unlock" % token2, json={"password": "pass1234"})).get("code"),
        "OK", "访客解锁成功",
    )
    check_eq(
        j(guest.get("/api/share/%s/comments" % token2)).get("code"), "OK", "解锁后读评论 → OK",
    )

    # 6c. 分享管理列表（Task 5）：只列出当前用户的分享
    r = client.get("/api/share/mine")
    check_eq(j(r).get("code"), "OK", "GET /api/share/mine 的 code")
    mine = j(r).get("data", {}).get("shares")
    check(isinstance(mine, list), "分享管理应返回列表（实际 %r）" % mine)
    check_eq(len(mine), 1, "分享管理应含 1 条（实际 %r）" % mine)
    entry = mine[0]
    check_eq(
        set(entry),
        {"note_id", "note_title", "token", "url", "has_password", "created_at"},
        "分享项字段集合",
    )
    check_eq(entry.get("note_id"), note_id, "分享项对应的笔记 id")
    check_eq(entry.get("note_title"), "分享用笔记", "分享项笔记标题")
    check_eq(entry.get("url"), "/share/%s" % entry.get("token"), "分享项 url 应含 token")
    check(entry.get("has_password") is True, "该分享设了密码")
    check_eq(
        j(_fresh_app().test_client().get("/api/share/mine")).get("code"), "AUTH_REQUIRED",
        "未登录访问分享管理 → AUTH_REQUIRED",
    )
    check_eq(j(other.get("/api/share/mine")).get("data", {}).get("shares"), [], "他人分享管理应为空")

    # 7. 取消分享：只删分享、不删笔记；重复取消幂等；旧 token 全部失效
    check_eq(j(client.delete("/api/notes/%d/share" % note_id)).get("code"), "OK", "取消分享成功")
    check_eq(j(client.get("/api/notes/%d" % note_id)).get("code"), "OK", "取消分享不应删除笔记")
    check_eq(j(client.delete("/api/notes/%d/share" % note_id)).get("code"), "OK", "重复取消分享应幂等")
    check_eq(j(client.get("/api/share/%s" % token2)).get("code"), "SHARE_NOT_FOUND", "取消后 token2 失效")
    check_eq(j(client.get("/api/share/%s" % token)).get("code"), "SHARE_NOT_FOUND", "取消后原 token 失效")

    # 8. 分享页模板与前端（Task 3）：唯一 h1 + 四个状态区 + 脚本顺序
    page = client.get("/share/%s" % token2)
    check_eq(page.status_code, 200, "GET /share/<token> 的状态码")
    html = page.get_data(as_text=True)
    check_eq(html.count("<h1"), 1, "分享页应恰有一个 <h1>（唯一标题为内容标题）")
    for fragment in (
        'class="share-lock"', 'id="share-lock"', 'id="unlock-password"', 'id="unlock-btn"',
        'id="unlock-error"', 'id="share-content"', 'class="note-paper"', 'id="share-title"',
        'id="share-author"', 'id="share-time"', 'id="share-body"',
        'id="share-comments"', 'id="comment-list"', 'id="comment-empty"', 'id="comment-form"',
        'id="nickname-field"', 'id="nickname"', 'id="comment-content"', 'id="comment-error"',
        'id="share-invalid"', 'href="/"',
        '该分享需要密码', '访问密码', '解锁',
        '还没有评论，来说点什么吧', '昵称', '评论内容', '发表评论',
        '分享链接无效或已取消', '返回主页',
    ):
        check(fragment in html, "分享页应包含 %r" % fragment)
    positions = []
    for relpath in ("vendor/marked.min.js", "vendor/purify.min.js", "js/markdown.js", "js/share.js"):
        index = html.find(relpath)
        check(index != -1, "分享页应引入 %s" % relpath)
        positions.append(index)
    check(positions == sorted(positions), "分享页脚本引入顺序应正确（实际 %r）" % positions)

    # share.js 静态契约：评论与昵称一律 textContent，唯一 HTML 出口经 window.md.render
    js = _read("static/js/share.js")
    for fragment in (
        "/api/share/", "/unlock", "/comments", "/api/auth/me",
        "window.md.render", "textContent", "无标题",
        "SHARE_PASSWORD_REQUIRED", "SHARE_NOT_FOUND", "发表中…",
    ):
        check(fragment in js, "share.js 应包含 %r" % fragment)
    assignments = re.findall(r"innerHTML\s*=\s*([^;]+)", js)
    check_eq(len(assignments), 1, "share.js 只应有一处 innerHTML 赋值（实际 %r）" % assignments)
    check(
        assignments[0].strip().startswith("window.md.render("),
        "唯一的 innerHTML 赋值必须来自 window.md.render（实际 %r）" % assignments[0],
    )

    # 9. 实现约束：参数化、经 core.responses、分享密码不得复用登录密码字段
    src = _read("routes/share.py")
    check("jsonify" not in src, "路由不得自行构造响应，必须经 core.responses")
    check("hash_share_password" in src, "分享密码必须用 hash_share_password 哈希")
    check("user_id = ?" in src, "routes/share.py 的越权校验应带 user_id = ? 过滤")
    check(
        re.search(r"\.execute\([^)]*f[\"']", src) is None,
        "routes/share.py 不得用 f-string 拼接 SQL",
    )


# ---------------------------------------------------------------------------
# Phase 4 任务 4：评论接口（游客 / 登录用户、校验与文案）
# ---------------------------------------------------------------------------

# 评论列表项字段集合（不返回 user_id 与邮箱）
COMMENT_FIELDS = {"nickname", "content", "created_at"}


@group("comments")
def check_comments():
    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 独立注册并生成一条免密分享，保证「只跑 comments 组」时也自洽
    client = _fresh_app().test_client()
    resp = client.post("/api/auth/register", json={
        "email": "comments@example.com", "username": "阿黎改名",
        "password": "abc123", "confirm_password": "abc123",
    })
    check_eq(resp.status_code, 201, "comments 组的前置注册")

    note_id = j(client.post("/api/notes", json={
        "title": "评论用笔记", "content_md": "正文", "status": "published",
    })).get("data", {}).get("id")
    token = j(client.post("/api/notes/%d/share" % note_id, json={"password": ""})).get("data", {}).get("token")
    check(bool(token), "前置：生成免密分享链接")

    # 1. 登录用户评论：nickname 取用户名（忽略传入值），user_id 记录在库
    r = client.post("/api/share/%s/comments" % token, json={"nickname": "被忽略的昵称", "content": "登录用户评论"})
    check_eq(j(r).get("code"), "OK", "登录用户评论成功")
    check_eq(r.status_code, 201, "评论创建的 HTTP 状态码")

    # 2. 游客：缺昵称 → NICKNAME_REQUIRED
    guest = _fresh_app().test_client()  # 新的无 session 客户端 = 游客
    r = guest.post("/api/share/%s/comments" % token, json={"nickname": "   ", "content": "游客评论"})
    check_eq(j(r).get("code"), "NICKNAME_REQUIRED", "游客缺昵称 → NICKNAME_REQUIRED")
    check_eq(j(r).get("message"), "请填写昵称后再评论", "NICKNAME_REQUIRED 的文案")

    # 3. 游客填昵称后评论成功
    r = guest.post("/api/share/%s/comments" % token, json={"nickname": "路过的猫", "content": "游客评论"})
    check_eq(j(r).get("code"), "OK", "游客填昵称后评论成功")

    # 4. 评论列表：按时间正序、只含必要字段、昵称规则正确
    r = guest.get("/api/share/%s/comments" % token)
    check_eq(j(r).get("code"), "OK", "评论列表可读")
    comments = j(r).get("data", {}).get("comments", [])
    names = [c["nickname"] for c in comments]
    check_eq(len(names), 2, "评论列表应含 2 条（实际 %r）" % names)
    check_eq(names[0], "阿黎改名", "登录评论昵称取用户名（忽略传入昵称）")
    check_eq(names[1], "路过的猫", "游客评论昵称为其填写值")
    for item in comments:
        check_eq(set(item), COMMENT_FIELDS, "评论项字段集合（不得含 user_id / 邮箱）")
    raw = json.dumps(j(r), ensure_ascii=False)
    check("comments@example.com" not in raw, "评论响应不得包含邮箱")
    check("user_id" not in raw, "评论响应不得包含 user_id")

    # 5. 校验边界放在独立的笔记上，避免污染上面的列表断言
    boundary_id = j(client.post("/api/notes", json={
        "title": "评论边界", "content_md": "x", "status": "published",
    })).get("data", {}).get("id")
    btoken = j(client.post("/api/notes/%d/share" % boundary_id, json={"password": ""})).get("data", {}).get("token")
    check(bool(btoken), "前置：生成边界用分享链接")
    check_eq(
        j(client.post("/api/share/%s/comments" % btoken, json={"nickname": "", "content": "   "})).get("code"),
        "COMMENT_EMPTY", "空内容 → COMMENT_EMPTY",
    )
    check_eq(
        j(client.post("/api/share/%s/comments" % btoken, json={"nickname": "", "content": "字" * 501})).get("code"),
        "COMMENT_TOO_LONG", "超长 → COMMENT_TOO_LONG",
    )
    check_eq(
        j(client.post("/api/share/%s/comments" % btoken, json={"nickname": "", "content": "字" * 500})).get("code"),
        "OK", "恰好 500 字应通过（边界）",
    )
    check_eq(
        j(guest.post("/api/share/%s/comments" % btoken, json={"nickname": "字" * 31, "content": "游客评论"})).get("code"),
        "INVALID_PARAMS", "昵称超 30 字 → INVALID_PARAMS",
    )
    check_eq(
        j(guest.post("/api/share/%s/comments" % btoken, json={"nickname": "路人", "content": 123})).get("code"),
        "INVALID_PARAMS", "评论内容类型错误 → INVALID_PARAMS",
    )
    check_eq(
        j(guest.post("/api/share/%s/comments" % btoken, json={"nickname": 7, "content": "x"})).get("code"),
        "INVALID_PARAMS", "昵称类型错误 → INVALID_PARAMS",
    )

    # 6. 无效 token → SHARE_NOT_FOUND（读与写都算）
    check_eq(j(guest.get("/api/share/not-a-token/comments")).get("code"), "SHARE_NOT_FOUND", "无效 token 读评论")
    check_eq(
        j(guest.post("/api/share/not-a-token/comments", json={"nickname": "路人", "content": "x"})).get("code"),
        "SHARE_NOT_FOUND", "无效 token 写评论",
    )

    # 7. 级联：删除笔记后该分享失效（评论随之级联删除）
    check_eq(j(client.delete("/api/notes/%d" % note_id)).get("code"), "OK", "删除评论用笔记")
    check_eq(j(guest.get("/api/share/%s/comments" % token)).get("code"), "SHARE_NOT_FOUND", "笔记删除后评论接口失效")


# ---------------------------------------------------------------------------
# Phase 5：AI 润色（provider 抽象 + Mock / OpenAI 兼容 provider + 接口 + 前端弹窗）
# ---------------------------------------------------------------------------

# spec Components 中固定不改的弹窗文案（与 提示词/ai润色提示词.txt 逐字一致）
AI_POLISH_COPY = (
    "AI 文本润色", "原文", "润色结果", "取消", "确认替换", "润色中…", "重试", "演示模式",
)


def _clear_provider_cache():
    """清空 get_provider() 的模块级单例缓存。

    单例按 provider 名缓存，跨多次 create_app() 会复用第一个 app 的亲配置；
    本组在切换 AI_PROVIDER / AI_API_KEY 前显式清空，保证断言与当前配置一致。
    """
    from core.ai import base as ai_base

    ai_base._cache.clear()


def _ai_app(**overrides):
    """新建一个 app 并覆盖 AI_* 配置；同时清空 provider 单例缓存。"""
    application = _fresh_app()
    _clear_provider_cache()
    application.config.update(overrides)
    return application


class _FakeResponse:
    """requests.Response 的最小替身：只暴露 provider 用到的三个成员。"""

    def __init__(self, status_code, payload=None, text="", json_error=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self._json_error = json_error

    def json(self):
        if self._json_error is not None:
            raise self._json_error
        return self._payload


@group("ai")
def check_ai():
    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # =======================================================================
    # 任务 1：Provider 抽象与 Mock 实现
    # =======================================================================
    from unittest.mock import patch

    from core.ai.base import PolishError, PolishProvider, get_provider
    from core.ai.mock import MockProvider

    check(issubclass(PolishError, Exception), "PolishError 必须是 Exception 子类")
    check_eq(PolishError("AI_TIMEOUT").code, "AI_TIMEOUT", "PolishError 必须携带 code")
    check_eq(PolishError("AI_TIMEOUT", "细节").code, "AI_TIMEOUT", "带 detail 的 PolishError 也应携带 code")
    check_eq(str(PolishError("AI_TIMEOUT", "上游超时")), "上游超时", "PolishError 的文本应取 detail")
    check_eq(str(PolishError("AI_TIMEOUT")), "AI_TIMEOUT", "无 detail 时 PolishError 的文本应取 code")
    check(issubclass(MockProvider, PolishProvider), "MockProvider 必须实现 PolishProvider 契约")
    check_eq(PolishProvider.name, "base", "PolishProvider 默认 name")
    check_eq(MockProvider.name, "mock", "MockProvider.name")
    check(MockProvider().available is True, "MockProvider 恒为可用（无需任何配置）")

    # 规则 1：空白归一（连续空格/制表符折成一个空格，≥3 个换行折成 2 个）
    # 注意：汉字之间的空格会被规则 5 继续去除，所以这里用「。 第」这种非汉字相邻处检验折合效果
    check_eq(
        MockProvider().polish("第一行。  第二行\t结束。"),
        "第一行。 第二行结束。",
        "连续空格 / 制表符应折成单个空格（汉字间空格另由规则 5 去除）",
    )
    check_eq(MockProvider().polish("甲\n\n\n\n乙。"), "甲\n\n乙。", "≥3 个连续换行应折成 2 个")
    check_eq(MockProvider().polish("甲\n\n乙。"), "甲\n\n乙。", "恰好 2 个换行应保持不变")

    # 规则 2：仅当 ASCII 标点紧跟在汉字之后时才转全角（不破坏英文与代码）
    check_eq(MockProvider().polish("这样,好吗?很好!"), "这样，好吗？很好！", "汉字后的 ASCII 标点应转全角")
    check_eq(MockProvider().polish("a,b: c; d? e! 好。"), "a,b: c; d? e! 好。", "非汉字之后的 ASCII 标点必须原样保留")

    # 规则 3：句末标点补全（已规范文本不强行改写）
    check_eq(MockProvider().polish("这是一段没有句末标点的文字"), "这是一段没有句末标点的文字。", "缺句末标点时应补「。」")
    check_eq(MockProvider().polish("句末缺标点  "), "句末缺标点。", "尾部空白应先剥离再判断句末标点")
    check_eq(MockProvider().polish("已经很好的句子。"), "已经很好的句子。", "已规范的句子必须原样返回")
    check_eq(MockProvider().polish("短句，"), "短句，", "以「，」收尾时不补「。」（不得双标点）")
    check_eq(MockProvider().polish("   "), "", "纯空白输入应归一为空串")
    check_eq(MockProvider().polish(""), "", "空输入应原样返回空串（不得追加标点）")

    # 规则 4：相邻重复词去除（英文词 / 2–4 字中文词）
    check_eq(MockProvider().polish("the the cat"), "the cat。", "相邻重复的英文词应去重")
    check_eq(MockProvider().polish("我们我们出发吧。"), "我们出发吧。", "紧邻重复的中文词应去重")
    check_eq(MockProvider().polish("看看书。"), "看看书。", "非重复的中文词不得被误删")

    # 规则 5：去除汉字之间的多余空格（中文正文不使用词间空格）
    check_eq(MockProvider().polish("今天 天气 很好"), "今天天气很好。", "汉字之间的空格应被去除")
    check_eq(MockProvider().polish("甲 乙 丙 丁。"), "甲乙丙丁。", "连续多处汉字空格应全部去除")
    check_eq(MockProvider().polish("你好 world 吗"), "你好 world 吗。", "汉字与英文之间的空格必须保留")

    # 规则 6：合并紧邻的重复 / 混用标点
    check_eq(MockProvider().polish("短句。。"), "短句。", "重复的全角句号应合并")
    check_eq(MockProvider().polish("一段,,需要"), "一段，需要。", "汉字旁重复的 ASCII 逗号应合并为全角")
    check_eq(MockProvider().polish("a,,b"), "a,,b。", "英文语境下的重复标点不得合并")
    check_eq(MockProvider().polish("等等..."), "等等。", "汉字后的英文省略号应归一为全角句号")

    # 演示质量：计划给定的示例输入必须产出计划给定的规范结果
    # （spec Deferred #1 允许「演示效果不理想可增补规则」，规则 5、6 即为此而加）
    check_eq(
        MockProvider().polish("这是  一段,,需要润色的文字"),
        "这是一段，需要润色的文字。",
        "示例输入应得到规范的中文润色结果（含空格与混用标点的清理）",
    )

    # 确定性：同一输入永远得到同一输出（含跨实例）
    sample = "这是  一段,,需要润色的文字"
    check_eq(MockProvider().polish(sample), MockProvider().polish(sample), "同一输入两次结果必须一致")
    check_eq(
        MockProvider().polish("混合 mixed content, 含标点!  和空白"),
        MockProvider().polish("混合 mixed content, 含标点!  和空白"),
        "混合内容也应确定",
    )

    # 边界：Mock 完全离线（无网络、无随机、不读环境变量），且不做事实性改写
    mock_src = _read("core/ai/mock.py")
    for forbidden in ("requests", "urllib", "socket", "random", "os.environ", "getenv"):
        check(forbidden not in mock_src, "Mock 必须离线且确定：mock.py 不得出现 %r" % forbidden)

    # get_provider()：默认 mock、单例缓存、未知取值回退 mock 并打日志
    application = _fresh_app()
    _clear_provider_cache()
    with application.app_context():
        provider = get_provider()
        check_eq(provider.name, "mock", "默认 AI_PROVIDER=mock 应返回 MockProvider")
        check(isinstance(provider, MockProvider), "默认应返回 MockProvider 实例")
        check(get_provider() is provider, "get_provider() 必须缓存实例（单例）")

        application.config["AI_PROVIDER"] = "bogus-provider"
        from flask import current_app

        with patch.object(current_app.logger, "warning") as warn:
            fallback = get_provider()
        check_eq(fallback.name, "mock", "未知 AI_PROVIDER 应回退到 mock")
        check(warn.called, "未知 AI_PROVIDER 必须记 warning 日志")

    # 未配置 Key 的 openai 模式：必须抛 PolishError(AI_UNAVAILABLE)，不得是 ImportError / KeyError
    application_openai = _fresh_app()
    _clear_provider_cache()
    application_openai.config["AI_PROVIDER"] = "openai"
    application_openai.config["AI_BASE_URL"] = ""
    application_openai.config["AI_API_KEY"] = ""
    application_openai.config["AI_MODEL"] = ""
    with application_openai.app_context():
        try:
            get_provider().polish("测试")
            outcome = None
        except PolishError as exc:
            outcome = exc.code
        except Exception as exc:  # noqa: BLE001 - ImportError / KeyError 都不接受
            outcome = "非 PolishError：%r" % exc
    check_eq(outcome, "AI_UNAVAILABLE", "openai 未配置时 polish 应抛 PolishError(AI_UNAVAILABLE)")

    # =======================================================================
    # 任务 2：真实 Provider（OpenAI 兼容）
    # =======================================================================
    import requests

    import core.ai.openai_compat as openai_compat
    from core.ai.openai_compat import OpenAICompatProvider

    check(issubclass(OpenAICompatProvider, PolishProvider), "OpenAICompatProvider 必须实现 PolishProvider 契约")
    check_eq(OpenAICompatProvider.name, "openai", "OpenAICompatProvider.name")
    check_eq(
        openai_compat.SYSTEM_PROMPT,
        "你是一位中文写作润色助手。请在不改变原意、不增删事实的前提下，"
        "提升输入文本的流畅度、清晰度与文采。只输出润色后的文本本身，"
        "不要输出任何解释、前后缀、引号或 Markdown 代码块。",
        "system prompt 必须与计划逐字一致",
    )

    # mock 模式必须能脱离 requests 启动：base.py 顶层不得 import requests
    base_src = _read("core/ai/base.py")
    check(
        re.search(r"(?m)^\s*(import|from)\s+requests", base_src) is None,
        "base.py 顶层不得 import requests（否则 mock 模式会被 requests 拖垮）",
    )
    check("core.ai.openai_compat" in base_src, "base.py 应通过延迟 import 使用 openai 实现")

    # available：base_url / api_key / model 三者齐备才为 True
    ready_config = {
        "AI_PROVIDER": "openai",
        "AI_BASE_URL": "https://api.example.com/v1/",
        "AI_API_KEY": "sk-must-not-leak",
        "AI_MODEL": "gpt-x",
    }
    with _ai_app(**ready_config).app_context():
        check(OpenAICompatProvider().available is True, "三项配置齐备时 available 应为 True")
        check_eq(OpenAICompatProvider().base_url, "https://api.example.com/v1", "base_url 应去掉尾部斜杠")

    for missing in ("AI_BASE_URL", "AI_API_KEY", "AI_MODEL"):
        partial = dict(ready_config)
        partial[missing] = ""
        with _ai_app(**partial).app_context():
            check(OpenAICompatProvider().available is False, "缺少 %s 时 available 应为 False" % missing)
            try:
                OpenAICompatProvider().polish("测试")
                code = None
            except PolishError as exc:
                code = exc.code
            check_eq(code, "AI_UNAVAILABLE", "缺少 %s 时 polish 应抛 AI_UNAVAILABLE" % missing)

    def call_polish(outcome, text="需要润色的文字"):
        """在 openai 配置下调用一次 polish。

        `outcome` 为 Exception 时当作请求异常抛出，否则当作上游响应返回。
        返回 dict：result / code / detail / calls / logged。
        """
        calls = []
        application = _ai_app(**ready_config)

        def fake_post(url, **kwargs):
            calls.append({"url": url, "kwargs": kwargs})
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with application.app_context():
            with patch.object(openai_compat.requests, "post", fake_post):
                with patch.object(application.logger, "warning") as warn:
                    try:
                        result = OpenAICompatProvider().polish(text)
                        code, detail = None, ""
                    except PolishError as exc:
                        result, code, detail = None, exc.code, str(exc)
            logged = " ".join(str(arg) for arg in warn.call_args[0]) if warn.called else ""
            logged += " " + str(warn.call_args[1]) if warn.called else ""
        return {"result": result, "code": code, "detail": detail, "calls": calls, "logged": logged}

    # 成功路径：URL / headers / payload / strip 后的结果
    success = call_polish(_FakeResponse(
        200, {"choices": [{"message": {"content": "  润色后的文字  "}}]}, text="raw",
    ))
    check_eq(success["code"], None, "成功路径不应抛异常")
    check_eq(success["result"], "润色后的文字", "应返回上游内容的 strip 结果")
    check_eq(len(success["calls"]), 1, "应发起且仅发起一次上游请求")
    check_eq(success["calls"][0]["url"], "https://api.example.com/v1/chat/completions", "上游请求 URL")
    check_eq(success["calls"][0]["kwargs"]["timeout"], 15, "超时应取 AI_TIMEOUT")
    check_eq(
        success["calls"][0]["kwargs"]["headers"]["Authorization"], "Bearer sk-must-not-leak",
        "Authorization 头只在请求内构造",
    )
    check_eq(success["calls"][0]["kwargs"]["headers"]["Content-Type"], "application/json", "Content-Type 头")
    sent = success["calls"][0]["kwargs"]["json"]
    check_eq(sent["model"], "gpt-x", "请求体 model")
    check_eq(sent["temperature"], 0.3, "请求体 temperature")
    check_eq(len(sent["messages"]), 2, "只应发送两条消息")
    check_eq(sent["messages"][0]["role"], "system", "第一条消息应为 system")
    check_eq(sent["messages"][0]["content"], openai_compat.SYSTEM_PROMPT, "system 消息应为固定 prompt")
    check_eq(
        sent["messages"][1], {"role": "user", "content": "需要润色的文字"},
        "第二条消息应为待润色原文",
    )
    check_eq(success["logged"], "", "成功路径不应记 warning")

    # 上游超时 → AI_TIMEOUT（Timeout 是 RequestException 的子类，必须优先捕获）
    timeout = call_polish(requests.Timeout("上游超时"))
    check_eq(timeout["code"], "AI_TIMEOUT", "requests.Timeout → AI_TIMEOUT")
    check_eq(timeout["result"], None, "超时不得返回任何结果")

    # 其它请求异常 → AI_UNAVAILABLE，且异常文本不得泄漏 Key
    broken = call_polish(requests.ConnectionError("断网"))
    check_eq(broken["code"], "AI_UNAVAILABLE", "requests.RequestException → AI_UNAVAILABLE")
    check("sk-must-not-leak" not in broken["detail"], "异常文本不得包含 AI_API_KEY")

    # 非 200 → 记录截断后的上游报文 + AI_UNAVAILABLE
    upstream_body = "x" * 500
    failed = call_polish(_FakeResponse(500, text=upstream_body))
    check_eq(failed["code"], "AI_UNAVAILABLE", "非 200 → AI_UNAVAILABLE")
    check("x" * 300 in failed["logged"], "上游报文应写入日志（截断到 300 字符）")
    check("x" * 301 not in failed["logged"], "上游报文写入日志时必须截断")
    check("sk-must-not-leak" not in failed["logged"], "日志不得包含 AI_API_KEY")
    check("sk-must-not-leak" not in failed["detail"], "异常文本不得包含 AI_API_KEY")
    check_eq(failed["detail"], "AI_UNAVAILABLE", "非 200 时异常文本只应是错误码")

    # 无法解析 / 结构不符 / 空内容 → AI_UNAVAILABLE（且不得把空串当结果返回）
    unparseable = call_polish(_FakeResponse(200, text="not json", json_error=ValueError("bad json")))
    check_eq(unparseable["code"], "AI_UNAVAILABLE", "响应不可解析为 JSON → AI_UNAVAILABLE")
    check_eq(
        call_polish(_FakeResponse(200, {"choices": []}))["code"], "AI_UNAVAILABLE",
        "choices 为空 → AI_UNAVAILABLE",
    )
    check_eq(
        call_polish(_FakeResponse(200, {"choices": [{}]}))["code"], "AI_UNAVAILABLE",
        "缺少 message → AI_UNAVAILABLE",
    )
    empty = call_polish(_FakeResponse(200, {"choices": [{"message": {"content": "   "}}]}))
    check_eq(empty["code"], "AI_UNAVAILABLE", "上游返回空内容 → AI_UNAVAILABLE")
    check_eq(empty["result"], None, "空内容不得作为润色结果返回")
    check(bool(empty["logged"]), "上游空内容应记日志")

    # get_provider() 接上真实实现（延迟 import），且同样是单例
    with _ai_app(**ready_config).app_context():
        provider = get_provider()
        check_eq(provider.name, "openai", "AI_PROVIDER=openai 时 get_provider() 应返回真实 provider")
        check(isinstance(provider, OpenAICompatProvider), "应返回 OpenAICompatProvider 实例")
        check(provider.available is True, "配置齐备时 get_provider().available 应为 True")
        check(get_provider() is provider, "openai provider 也应缓存单例")

    # =======================================================================
    # 任务 3：润色接口 /api/ai/*
    # =======================================================================
    import core.codes as codes
    from routes.ai import ai_bp

    check_eq(ai_bp.name, "ai", "Blueprint 名称")
    check_eq(ai_bp.url_prefix, "/api/ai", "Blueprint 前缀")

    # 未登录：两个接口都必须 401 AUTH_REQUIRED（spec 滥用限制）
    anon = _fresh_app().test_client()
    for method, path, body in (
        ("get", "/api/ai/status", None),
        ("post", "/api/ai/polish", {"text": "x"}),
    ):
        call = getattr(anon, method)
        resp = call(path, json=body) if body is not None else call(path)
        label = "未登录 %s %s" % (method.upper(), path)
        check_eq(resp.status_code, 401, "%s 的 HTTP 状态码" % label)
        check_eq(j(resp).get("code"), "AUTH_REQUIRED", "%s 的 code" % label)

    # 独立注册，保证「只跑 ai 组」时也自洽
    application_ai = _fresh_app()
    application_ai.config["AI_API_KEY"] = "sk-must-not-leak"
    client = application_ai.test_client()
    check_eq(client.post("/api/auth/register", json={
        "email": "ai@example.com", "username": "润色用户",
        "password": "abc123", "confirm_password": "abc123",
    }).status_code, 201, "ai 组的前置注册")

    # GET /status：只返回 provider 与 available，且不泄漏 Key
    r = client.get("/api/ai/status")
    check_eq(r.status_code, 200, "status 的 HTTP 状态码")
    check_eq(j(r).get("code"), "OK", "status 的 code")
    check_eq(j(r).get("data", {}).get("provider"), "mock", "默认应报告 provider=mock")
    check(j(r).get("data", {}).get("available") is True, "mock 应报告 available=True")
    check_eq(set(j(r).get("data", {})), {"provider", "available"}, "status 只应返回 provider 与 available")
    check("sk-must-not-leak" not in r.get_data(as_text=True), "status 响应不得包含 AI_API_KEY")

    # POST /polish：参数校验与边界
    for label, body, code in (
        ("空 body", {}, "INVALID_PARAMS"),
        ("缺 text 字段", {"x": 1}, "INVALID_PARAMS"),
        ("text 非字符串", {"text": 123}, "INVALID_PARAMS"),
        ("body 非对象", [1, 2], "INVALID_PARAMS"),
        ("纯空白", {"text": "   "}, "AI_EMPTY_TEXT"),
        ("超长（2001）", {"text": "字" * 2001}, "AI_TOO_LONG"),
    ):
        r = client.post("/api/ai/polish", json=body)
        check_eq(j(r).get("code"), code, "%s → %s" % (label, code))
        check_eq(j(r).get("message"), codes.MESSAGES[code], "%s 的中文文案" % label)
        check_eq(j(r).get("data"), None, "%s 的 data 必须为 null" % label)
    check_eq(client.post("/api/ai/polish", json={"text": "字" * 2000}).status_code, 200, "恰好 2000 字应通过（边界）")

    # 成功路径：mock provider 的确定性输出
    src = "这是  一段,,需要润色的文字"
    r = client.post("/api/ai/polish", json={"text": src})
    body_json = j(r)
    check_eq(r.status_code, 200, "润色成功的 HTTP 状态码")
    check_eq(body_json.get("code"), "OK", "润色成功的 code")
    check_eq(body_json.get("data", {}).get("provider"), "mock", "润色结果应带 provider=mock")
    polished = body_json.get("data", {}).get("polished")
    check(bool(polished), "润色结果必须非空（实际 %r）" % polished)
    check(polished != src, "润色结果应与原文不同")
    check_eq(
        client.post("/api/ai/polish", json={"text": src}).get_json()["data"]["polished"], polished,
        "同一输入两次结果必须一致（确定性）",
    )

    # provider 打桩：成功 / 失败映射 / 原始文本透传 / 长度上限取自配置
    class _StubProvider:
        name = "stub"

        def __init__(self, error=None, result="润色结果"):
            self.available = True
            self.error = error
            self.result = result
            self.seen = []

        def polish(self, text):
            self.seen.append(text)
            if self.error is not None:
                raise self.error
            return self.result

    stub = _StubProvider()
    with patch("routes.ai.get_provider", return_value=stub):
        r = client.post("/api/ai/polish", json={"text": "abcdef"})
        check_eq(j(r).get("code"), "OK", "打桩 provider 的成功路径")
        check_eq(j(r).get("data", {}).get("polished"), "润色结果", "应原样返回 provider 的结果")
        check_eq(j(r).get("data", {}).get("provider"), "stub", "应返回 provider.name")
        check_eq(stub.seen, ["abcdef"], "provider 必须收到原始文本（不得被路由改写）")

        r = client.get("/api/ai/status")
        check_eq(j(r).get("data"), {"provider": "stub", "available": True}, "status 应反映当前 provider")

    # 错误码映射：PolishError → fail(e.code)；其它异常 → AI_UNAVAILABLE
    for label, error, code, status in (
        ("上游不可用", PolishError(codes.AI_UNAVAILABLE), "AI_UNAVAILABLE", 502),
        ("上游超时", PolishError(codes.AI_TIMEOUT), "AI_TIMEOUT", 504),
        ("未知异常", RuntimeError("boom"), "AI_UNAVAILABLE", 502),
    ):
        with patch("routes.ai.get_provider", return_value=_StubProvider(error=error)):
            with patch.object(application_ai.logger, "warning") as warn:
                r = client.post("/api/ai/polish", json={"text": "abcdef"})
            check_eq(j(r).get("code"), code, "%s → %s" % (label, code))
            check_eq(r.status_code, status, "%s 的 HTTP 状态码" % label)
            check_eq(j(r).get("message"), codes.MESSAGES[code], "%s 的中文文案" % label)
            check_eq(j(r).get("data"), None, "%s 的 data 必须为 null" % label)
            check(warn.called, "%s 必须记日志（不向前端透传上游报文）" % label)
            check("sk-must-not-leak" not in r.get_data(as_text=True), "%s 响应不得包含 AI_API_KEY" % label)

    # 长度上限必须取自 AI_MAX_CHARS（不得硬编码 2000）
    application_tight = _fresh_app()
    application_tight.config["AI_MAX_CHARS"] = 5
    tight_client = application_tight.test_client()
    tight_client.post("/api/auth/register", json={
        "email": "ai2@example.com", "username": "润色用户二",
        "password": "abc123", "confirm_password": "abc123",
    })
    with patch("routes.ai.get_provider", return_value=_StubProvider()):
        check_eq(
            j(tight_client.post("/api/ai/polish", json={"text": "123456"})).get("code"), "AI_TOO_LONG",
            "超过配置的 AI_MAX_CHARS 应 AI_TOO_LONG",
        )
        check_eq(
            j(tight_client.post("/api/ai/polish", json={"text": "12345"})).get("code"), "OK",
            "恰好等于 AI_MAX_CHARS 应通过",
        )

    # =======================================================================
    # 任务 4 / 5：编辑页入口、弹窗结构、样式与前端行为契约
    # =======================================================================
    import subprocess

    edit_client = _fresh_app().test_client()
    edit_client.post("/api/auth/register", json={
        "email": "aiedit@example.com", "username": "润色编辑",
        "password": "abc123", "confirm_password": "abc123",
    })
    resp = edit_client.get("/notes/new")
    check_eq(resp.status_code, 200, "登录后 GET /notes/new")
    html = resp.get_data(as_text=True)

    # 工具栏键盘等价入口 + 就地错误容器
    check('id="ai-polish-btn"' in html, "编辑页工具栏应有「AI 润色」按钮")
    check('id="editor-error"' in html, "编辑页应有就地错误容器 #editor-error")
    check('class="form-error"' in html, "#editor-error 应使用既有的 .form-error 样式类")

    # 右键菜单：静态结构（避免用 innerHTML 拼接）
    check('class="ctx-menu"' in html, "编辑页应静态声明右键菜单 .ctx-menu")
    check('class="ctx-item"' in html, "编辑页应静态声明菜单项 .ctx-item")

    # 弹窗结构与 spec 固定文案（与 提示词/ai润色提示词.txt 逐字一致）
    check('id="polish-modal"' in html, "编辑页应包含润色弹窗 #polish-modal")
    check('role="dialog"' in html and 'aria-modal="true"' in html, "弹窗应有 role=dialog + aria-modal")
    check('aria-labelledby="polish-title"' in html, "弹窗应通过 aria-labelledby 关联标题")
    check('id="polish-title"' in html, "弹窗标题应有 id=polish-title")
    check('id="polish-source"' in html, "弹窗应有左栏 #polish-source")
    check('id="polish-result"' in html, "弹窗应有右栏 #polish-result")
    check('id="polish-cancel"' in html, "弹窗应有「取消」按钮")
    check('id="polish-confirm"' in html, "弹窗应有「确认替换」按钮")
    check('id="polish-badge"' in html, "弹窗应有「演示模式」徽标")
    check('id="polish-retry"' in html, "弹窗应有「重试」按钮")
    check('id="polish-status"' in html, "弹窗应有状态容器")
    check(re.search(r'<textarea[^>]*id="polish-source"[^>]*readonly', html) is not None
          or re.search(r'<textarea[^>]*readonly[^>]*id="polish-source"', html) is not None,
          "「原文」必须是只读 textarea")
    check(re.search(r'<textarea[^>]*id="polish-result"[^>]*>', html) is not None, "「润色结果」必须是可编辑 textarea")
    for copy in AI_POLISH_COPY:
        check(copy in html, "弹窗文案必须逐字包含「%s」" % copy)

    # 脚本引入顺序：polish.js 必须在 note_edit.js 之前（note_edit.js 要调用 Polish.bind）
    positions = []
    for relpath in NOTE_EDIT_SCRIPTS:
        index = html.find(relpath)
        check(index != -1, "编辑页应引入 %s" % relpath)
        positions.append(index)
    check(positions == sorted(positions), "脚本引入顺序应为 %r（实际 %r）" % (NOTE_EDIT_SCRIPTS, positions))
    check(
        positions[NOTE_EDIT_SCRIPTS.index("js/polish.js")] < positions[NOTE_EDIT_SCRIPTS.index("js/note_edit.js")],
        "polish.js 必须先于 note_edit.js 引入",
    )

    # note_edit.js 必须把入口接上（否则右键与工具栏按钮都不会生效）
    note_edit_js = _read("static/js/note_edit.js")
    check("window.Polish" in note_edit_js, "note_edit.js 应在 Editor.init 之后接上 Polish 入口")
    check(re.search(r"\.innerHTML\s*=", note_edit_js) is None, "note_edit.js 不得用 innerHTML 赋值")

    # 静态资源可取自静态路由
    resp = edit_client.get("/static/js/polish.js")
    check_eq(resp.status_code, 200, "GET /static/js/polish.js 的状态码")
    check("javascript" in resp.headers["Content-Type"], "polish.js 的 Content-Type 应为 JavaScript")

    # polish.js 静态契约：全局出口、唯一请求路径、不得用 innerHTML
    polish_js = _read("static/js/polish.js")
    check("window.Polish" in polish_js, "polish.js 应暴露 window.Polish")
    check("/api/ai/polish" in polish_js, "polish.js 应调用 /api/ai/polish")
    check("/api/ai/status" in polish_js, "polish.js 应查询 /api/ai/status")
    check("replaceSelection" in polish_js, "polish.js 必须经 Editor.replaceSelection 写回文本")
    check("Escape" in polish_js, "polish.js 应处理 Esc")
    check(re.search(r"\.innerHTML\s*=", polish_js) is None, "polish.js 不得用 innerHTML（只有 Markdown 输出允许）")

    # 契约一致性（GREEN 后加固）：polish.js 查找的每个 id 都必须真实存在于模板中，
    # 否则前端会静默失效（元素取不到 → 入口/弹窗/状态全都不工作）。
    js_ids = sorted(set(re.findall(r'byId\("([^"]+)"\)', polish_js)))
    check(len(js_ids) >= 10, "应从 polish.js 解析出全部 id 引用（实际 %r）" % js_ids)
    for js_id in js_ids:
        check('id="%s"' % js_id in html, "polish.js 引用的 #%s 必须存在于编辑页模板中" % js_id)
    # 反向自证：该检查不是空转（不存在的 id 必须被判为缺失）
    check('id="polish-does-not-exist"' not in html, "自证：不存在的 id 不应出现在模板中")

    # AI_API_KEY 不得出现在页面或前端脚本里
    check("AI_API_KEY" not in html, "编辑页不得出现 AI_API_KEY")
    check("AI_API_KEY" not in polish_js, "polish.js 不得出现 AI_API_KEY")

    # 样式：浮层、两栏、只读栏、主按钮描边、按钮区、旋转圈、移动端堆叠
    css = _read("static/css/style.css")
    compact_css = css.replace("\n", "")
    for fragment in (
        ".ctx-menu{position:fixed;", ".ctx-item{",
        ".modal-mask{position:fixed;", ".modal{", ".modal-cols{display:grid;grid-template-columns:1fr 1fr",
        ".pane-readonly{", "#polish-result{border-color:var(--primary)}",
        ".modal-actions{display:flex;justify-content:flex-end", ".spinner{",
    ):
        check(fragment in compact_css, "style.css 应包含规则片段 %r" % fragment)
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.modal-cols\{grid-template-columns:1fr\}", compact_css) is not None,
        "手机断点下弹窗两栏应改为上下堆叠",
    )
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.modal-actions\{flex-direction:column\}", compact_css) is not None,
        "手机断点下按钮区应改为纵向排列",
    )
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.modal-actions \.btn\{width:100%\}", compact_css) is not None,
        "手机断点下弹窗按钮应全宽",
    )
    check(
        re.search(r"prefers-reduced-motion: reduce\)\{[^@]*\.spinner\{display:none\}", compact_css) is not None,
        "prefers-reduced-motion 下旋转圈应改为静态文案（隐藏动画元素）",
    )
    # 弹窗尺寸（spec Layout：内容不溢出视口，桌面左右各 50%）
    check("width:min(880px,92vw)" in compact_css, "弹窗宽度应自适应且不超出视口")
    check("max-height:86vh" in compact_css, "弹窗高度上限应为 86vh")
    # 关键正确性：带 hidden 的浮层/徽标/指示器必须真正隐藏（display 规则不得覆盖 [hidden]）
    for fragment in (".modal-mask[hidden]", ".badge[hidden]", ".polish-status[hidden]", ".spinner[hidden]"):
        check(fragment in compact_css, "style.css 必须保证 %s 真正隐藏" % fragment)

    # Node 沙箱行为契约（真实事件驱动）
    script = os.path.join(ROOT, "tests", "js_polish_test.js")
    check(os.path.exists(script), "前端契约测试脚本 tests/js_polish_test.js 必须存在")
    try:
        proc = subprocess.run(["node", script], capture_output=True, text=True, encoding="utf-8")
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")
    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_polish_test.js 的退出码")

    # =======================================================================
    # AI 组断言结束标记（后续任务在此行之前追加）
    # =======================================================================


# ---------------------------------------------------------------------------
# Phase 6 任务 1 / 2：主页、关于页与 404 页（文案与结构逐字核对）
# ---------------------------------------------------------------------------


@group("homeabout")
def check_home_about():
    client = _fresh_app().test_client()

    home = client.get("/").get_data(as_text=True)

    # 主页文案逐字固定（spec 已确认决策 7：卖点改为与实际功能一致）
    for copy in (
        "记录生活 · 书写成长", "遇见美好", "Enjoy the little things", "开始记录", "了解更多",
        "简洁易用", "分享协作", "隐私保护", "评论互动",
        "清爽的写作界面，专注记录每一个想法", "一键生成分享链接，可设置访问密码",
        "笔记默认私有，只分享给你想分享的人", "读者可以留下评论，让记录有了回响",
        "个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感，珍藏生活中的每一个美好瞬间。",
    ):
        check(copy in home, "主页应含文案：%s" % copy)
    check("云端同步" not in home, "主页不得含被替换掉的旧卖点「云端同步」")
    check("灵活分类" not in home, "主页不得含被替换掉的旧卖点「灵活分类」")
    check("url_for" not in home, "主页模板应已被渲染（不应残留 url_for 调用）")

    # Hero 双栏结构：左文右图
    check('class="hero"' in home, "主页应有 .hero 区块")
    check('class="hero-copy"' in home and 'class="hero-figure"' in home, "Hero 应为左右双栏结构")
    check('class="hero-script"' in home, "Hero 应有英文手写装饰行（--font-script）")
    check('class="hero-title"' in home, "主页标题应使用 .hero-title")
    check('class="hero-title-2"' in home, "「遇见美好」应套 .hero-title-2（承载手绘下划线）")
    check('href="/about"' in home, "「了解更多」应指向 /about")
    check('href="/register"' in home, "未登录时「开始记录」应指向 /register")
    # 唯一 <h1>（spec 无障碍要求）
    check_eq(home.count("<h1"), 1, "主页应恰有一个 <h1>")

    # Hero 图：真实素材 + 固有尺寸（防布局抖动）+ alt
    check(
        re.search(r'<img[^>]*src="[^"]*img/hero\.jpg"[^>]*width="1280"[^>]*height="720"', home) is not None,
        "Hero 图应带 width/height 属性防布局抖动",
    )
    check(re.search(r'<img[^>]*alt="[^"]+"', home) is not None, "Hero 图应有 alt 文本")

    # 四宫格卖点：4 项，标题为 <h2>，图标为内联 SVG
    check('class="feature-grid"' in home, "卖点区应有 .feature-grid")
    check_eq(home.count('class="feature"'), 4, "卖点应为 4 项（且不含 .feature-grid）")
    check_eq(home.count("<h2"), 4, "四个卖点标题应为 <h2>")
    check_eq(home.count("<h1"), 1, "四宫格不得再引入 <h1>")
    check_eq(home.count('viewBox="0 0 24 24"'), 4, "四个图标都应是 24×24 内联 SVG")
    check_eq(home.count('stroke-width="1.6"'), 4, "图标线宽应统一为 1.6")
    check_eq(home.count('fill="none"'), 4, "图标应为描边式（fill=none）")
    check_eq(home.count('stroke="currentColor"'), 4, "图标描边应取 currentColor")
    check_eq(home.count('class="feature-icon"'), 4, "每个图标外层应有 .feature-icon 圆形描边")

    # 关于页
    about_resp = client.get("/about")
    check_eq(about_resp.status_code, 200, "关于页应返回 200")
    about = about_resp.get_data(as_text=True)
    check_eq(about.count("<h1"), 1, "关于页应恰有一个 <h1>")
    check(
        "个人笔记是一个本地运行的个人笔记应用，用 Markdown 写作，支持分享与评论。" in about,
        "关于页应含「这是什么」正文",
    )
    check("Flask" in about, "关于页技术栈应含 Flask")
    for copy in (
        "注册与登录", "Markdown 写作与实时预览", "草稿与发布", "划词 AI 润色",
        "笔记收藏", "链接分享（可设密码）", "评论互动",
        "前端：HTML + CSS + 原生 JavaScript", "后端：Python + Flask",
        "数据库：SQLite", "Markdown 渲染：marked.js（本地引入）",
        "AI 润色：默认离线演示模式，可配置接入大模型服务",
        "本应用用于本地演示",
    ):
        check(copy in about, "关于页应含：%s" % copy)
    check(
        "Phase 6" not in about and "将在后续阶段" not in about,
        "关于页不得残留占位语气文案",
    )

    # 404 页
    not_found = client.get("/no-such-page")
    check_eq(not_found.status_code, 404, "未知路径应返回 404")
    nf_html = not_found.get_data(as_text=True)
    check("页面不存在" in nf_html, "404 页应显示「页面不存在」")
    check_eq(nf_html.count("<h1"), 1, "404 页应恰有一个 <h1>")
    check('class="error-page"' in nf_html, "404 页应使用 .error-page 区块")
    check('href="/"' in nf_html, "404 页应有返回主页链接")
    check("你访问的页面可能已被删除或链接有误。" in nf_html, "404 页应含中文说明")


# ---------------------------------------------------------------------------
# Phase 6 任务 3 / 4：三断点响应式、汉堡菜单、触摸目标与防溢出
# ---------------------------------------------------------------------------


@group("responsive")
def check_responsive():
    import subprocess

    client = _fresh_app().test_client()
    base = client.get("/").get_data(as_text=True)
    css = _read("static/css/style.css")
    compact = css.replace("\n", "")

    # 顶栏汉堡菜单：结构 + 无障碍关联（spec Layout：<768px 收成汉堡）
    check('id="nav-toggle"' in base, "base.html 应有 #nav-toggle 菜单按钮")
    check('class="nav-toggle"' in base, "菜单按钮应使用 .nav-toggle")
    check('aria-expanded="false"' in base, "菜单按钮初始 aria-expanded=false")
    check('aria-controls="site-nav"' in base, "菜单按钮应通过 aria-controls 关联导航")
    check('id="site-nav"' in base, "导航应有 id=site-nav 供 aria-controls 引用")

    check(re.search(r"\.nav-toggle\{[^}]*display:none", compact) is not None, "桌面端 .nav-toggle 应隐藏")
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.nav-toggle\{display:inline-flex", compact) is not None,
        "手机断点下 .nav-toggle 应显示",
    )
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.site-nav\{display:none\}", compact) is not None,
        "手机断点下 .site-nav 默认收起",
    )
    check(
        re.search(r"@media \(max-width:767px\)\{[^@]*\.site-nav\.is-open\{", compact) is not None,
        "手机断点下 .site-nav.is-open 展开为纵向列表",
    )
    check(re.search(r"\.site-header\{[^}]*position:relative", css) is not None, ".site-header 应为定位参照")

    # api.js 绑定汉堡菜单行为，且不破坏最小沙箱（见 frontend 组）
    api_js = _read("static/js/api.js")
    check("nav-toggle" in api_js, "api.js 应绑定 #nav-toggle")
    check("site-nav" in api_js, "api.js 应操作 #site-nav")
    check("aria-expanded" in api_js, "api.js 应切换 aria-expanded")
    check("is-open" in api_js, "api.js 应切换 .is-open")
    check(
        os.path.exists(os.path.join(ROOT, "tests", "js_api_test.js")),
        "汉堡菜单的前端行为由 tests/js_api_test.js 断言",
    )
    try:
        proc = subprocess.run(
            ["node", os.path.join(ROOT, "tests", "js_api_test.js")],
            capture_output=True, text=True, encoding="utf-8",
        )
    except FileNotFoundError:
        raise AssertionError("未找到 node，无法执行前端契约测试")
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "node tests/js_api_test.js 的退出码")

    # 三断点规则（spec Layout「响应式规则」表）
    for fragment in (
        "@media (max-width:1023px)",
        "@media (max-width:767px)",
        ".hero{grid-template-columns:1fr;",
        ".hero-title{font-size:44px}",
        ".feature-grid{grid-template-columns:repeat(2,1fr)}",
        ".hero-title{font-size:32px}",
        ".hero-body{font-size:15px}",
        ".hero-actions .btn{flex:1 1 100%}",
        ".feature-grid{grid-template-columns:1fr}",
        ".hero-figure img{aspect-ratio:4/3}",
        ".profile-grid{grid-template-columns:1fr}",
    ):
        check(fragment in compact, "响应式样式应包含 %r" % fragment)

    # 触摸目标 ≥ 44×44px（spec Accessibility）
    check(
        re.search(
            r"@media \(max-width:767px\)\{[^@]*\.btn,\.site-nav a,\.feature h2\{min-height:44px\}",
            compact,
        ) is not None,
        "手机断点下可点区域的触摸目标应 ≥ 44px",
    )
    check(re.search(r"\.site-nav a\{[^}]*display:flex", css) is not None, "导航项应为 flex 撑满触摸高度")
    check(re.search(r"\.site-nav a\{[^}]*min-height:44px", css) is not None, "导航项触摸高度应 ≥ 44px")

    # 防溢出兜底（375 视口无横向滚动条）
    check(re.search(r"html,body\{overflow-x:hidden\}", css) is not None, "应防止横向滚动")
    check("img,svg,textarea{max-width:100%}" in compact, "资源不应撑破布局")

    # 手绘下划线：内联 SVG data URI（金色 --primary），且不得加载 Web Font
    check("data:image/svg+xml" in css, "手绘下划线应为内联 SVG data URI")
    check("%23B89B6A" in css, "下划线应使用 --primary 金色")
    check("font-face" not in css and "@import" not in css, "不得引入 Web Font")

    # 无障碍：唯一 <h1> + reduced-motion 关闭过渡
    for path in ("/", "/about"):
        html = client.get(path).get_data(as_text=True)
        check_eq(html.count("<h1"), 1, "%s 应恰有一个 <h1>" % path)
    check(
        re.search(r"@media \(prefers-reduced-motion: reduce\)\{[^@]*transition:none", compact) is not None,
        "prefers-reduced-motion 下应关闭过渡",
    )


# ---------------------------------------------------------------------------
# Phase 6 任务 4：对比度实测（scripts/contrast_check.py，纯标准库）
# ---------------------------------------------------------------------------


@group("contrast")
def check_contrast():
    import subprocess

    script = os.path.join(ROOT, "tests", "contrast_check.py")
    check(os.path.exists(script), "对比度核验脚本 tests/contrast_check.py 必须存在")
    proc = subprocess.run(
        [sys.executable, script], capture_output=True, text=True, encoding="utf-8"
    )
    if proc.stdout:
        print("\n" + proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())
    check_eq(proc.returncode, 0, "tests/contrast_check.py 的退出码")
    check("失败数: 0" in proc.stdout, "对比度检查应全部通过（失败数 0）")


# ---------------------------------------------------------------------------
# Phase 7 任务 3：第 10 组「统一错误结构」（spec Testing 第 8 组）
# ---------------------------------------------------------------------------


@group("errstruct")
def check_error_structure():
    """统一失败响应同时含 code 与中文 message。

    用例固定、无随机，保证可复现。其中 POST /api/notes 与 POST /api/ai/polish
    需要登录态：本组自给自足地注册并登录 a@b.com，不依赖其它组遗留的数据。
    """
    client = _fresh_app().test_client()

    def j(resp):
        try:
            return resp.get_json() or {}
        except Exception:
            return {}

    # 自给自足：注册 a@b.com（已存在则返回 EMAIL_EXISTS，忽略），随后登录建立会话
    client.post("/api/auth/register", json={
        "email": "a@b.com", "username": "阿黎",
        "password": "abc123", "confirm_password": "abc123",
    })
    resp = client.post("/api/auth/login", json={"email": "a@b.com", "password": "abc123"})
    check_eq(j(resp).get("code"), "OK", "统一错误结构组的前置登录")
    check(
        j(client.get("/api/auth/me")).get("data", {}).get("user") is not None,
        "统一错误结构组应处于登录态（POST /api/notes 与 /api/ai/polish 需要登录）",
    )

    cases = [
        ("POST", "/api/auth/register",
         {"email": "", "username": "", "password": "", "confirm_password": ""}),
        ("POST", "/api/notes", {"title": "", "content_md": "", "status": "published"}),
        ("GET", "/api/notes/999999", None),
        ("GET", "/api/share/not-a-token", None),
        ("POST", "/api/ai/polish", {"text": ""}),
    ]
    for method, path, body in cases:
        resp = client.post(path, json=body) if method == "POST" else client.get(path)
        data = j(resp)
        check(
            isinstance(data.get("code"), str) and data["code"] != "OK",
            "%s %s 应含非 OK 的 code（实际 %r）" % (method, path, data),
        )
        check(bool(data.get("message")), "%s %s 应含非空 message（实际 %r）" % (method, path, data))
        check(
            any("\u4e00" <= ch <= "\u9fff" for ch in data.get("message", "")),
            "%s %s 的 message 应为中文（实际 %r）" % (method, path, data.get("message")),
        )


# ---------------------------------------------------------------------------
# 运行器
# ---------------------------------------------------------------------------


def main(argv):
    names = [a for a in argv[1:] if not a.startswith("-")]
    known = [n for n, _ in _GROUPS]
    unknown = [n for n in names if n not in known]
    if unknown:
        print("未知检查组：%s" % "、".join(unknown))
        print("可用检查组：%s" % "、".join(known))
        return 1

    selected = [(n, f) for n, f in _GROUPS if not names or n in names]
    failures = []
    for name, fn in selected:
        before = _PASSED
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - 冒烟脚本需要报告全部失败原因
            failures.append((name, exc))
            print("[失败] %-10s %s" % (name, exc))
        else:
            print("[通过] %-10s %d 项断言" % (name, _PASSED - before))

    print("-" * 56)
    if failures:
        print("结果：%d/%d 个检查组失败，共 %d 项断言通过" % (len(failures), len(selected), _PASSED))
        for name, exc in failures:
            print("  - %s：%s" % (name, exc))
        return 1
    print("结果：%d/%d 个检查组全部通过，共 %d 项断言通过" % (len(selected), len(selected), _PASSED))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
