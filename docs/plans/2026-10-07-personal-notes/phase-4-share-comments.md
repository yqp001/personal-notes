# Phase 4: 分享与评论

**Goal:** 笔记可生成带可选密码的**实时**分享链接；未登录访问者解锁后可阅读并评论（填昵称），登录用户评论自动取用户名；个人主页可管理已生成的分享链接。
**Prerequisites:** Phase 3 完成（笔记 CRUD、`markdown.js` 渲染出口、详情页）
**Deliverables:** `tests/smoke_test.py` 第 6、7 组断言通过；`/share/<token>` 页完整可用；详情页分享面板与个人主页分享管理可用。

**Interface Decisions Implemented:** 分享为实时视图（spec 已确认决策 6）；分享页密码锁卡片与「错误不清空输入」（spec Components 分享页密码锁 / Error Handling）；评论表单游客带昵称、登录用户仅内容（spec Components 评论表单）；分享面板「已生成分享链接 / 复制链接 / 链接已复制」（spec Components 分享面板）；分享页不返回隐私字段（spec Security 敏感信息）。

---

## Task 1: 分享管理接口与详情页分享面板

**Goal:** 作者可生成、重新生成、取消分享链接，并可一键复制。

**Files:**
- Create: `routes/share.py`（本阶段先实现分享管理部分，公开读取在 Task 2 追加）
- Modify: `app.py`（注册 `share_bp`）、`templates/note_detail.html`、`static/js/note_detail.js`、`static/css/style.css`

**Steps:**
- [x] 实现两个接口（`share_bp = Blueprint("share", __name__, url_prefix="/api")`）：

| 接口 | 规则 |
|---|---|
| `POST /api/notes/<int:note_id>/share` | `login_required`；`note_id + user_id` 查不到 → `NOTE_NOT_FOUND`；body 的 `password` 可为空串（= 无密码）；非空时 `len >= 4` 否则 `INVALID_PARAMS`；已存在分享记录 → 更新 `password_hash` 并重新生成 token；不存在 → 生成 `secrets.token_urlsafe(16)` 后插入；返回 `ok({"token": t, "url": f"/share/{t}", "has_password": bool})` |
| `DELETE /api/notes/<int:note_id>/share` | 同上越权校验；删除分享记录（**不删笔记**）；返回 `ok()` |

  - 返回体只给 `token` 与相对 `url`；前端用 `location.origin + url` 拼完整链接。

- [x] 详情页操作条加「分享」按钮，点击展开 `#share-panel`：

```html
<div id="share-panel" class="share-panel" hidden>
  <label for="share-password">访问密码（留空表示无需密码）</label>
  <input id="share-password" type="text" autocomplete="off" placeholder="至少 4 位">
  <button type="button" id="share-generate" class="btn btn-primary">生成分享链接</button>
  <div id="share-result" hidden>
    <p>已生成分享链接</p>
    <input id="share-url" type="text" readonly>
    <button type="button" id="share-copy" class="btn btn-ghost">复制链接</button>
    <button type="button" id="share-cancel" class="btn btn-ghost">取消分享</button>
  </div>
  <p class="form-error" id="share-error" hidden></p>
</div>
```

- [x] `static/js/note_detail.js` 追加行为：

  - 「生成分享链接」→ `POST /api/notes/<id>/share`，body `{password: 输入值}`；成功后 `#share-url.value = location.origin + r.data.url`，显示 `#share-result`；失败 `api.showError(#share-error, r.message)`。
  - 「复制链接」→ 优先 `navigator.clipboard.writeText()`；不可用时回退 `input.select() + document.execCommand("copy")`；成功后按钮文字变 `链接已复制`，2 秒后还原。
  - 「取消分享」→ `confirm("取消后原链接将失效，确定吗？")` → `DELETE` → 隐藏 `#share-result`。

- [x] Run: 详情页点「分享」，密码留空，生成链接后新开无痕窗口访问
  - Expected: 无痕窗口能直接读到内容（无需密码）。

- [x] Run: 再把密码设为 `123`（3 位）
  - Expected: 分享面板内红字提示参数不合法（`INVALID_PARAMS` 的中文 `message`）。

**Security/Boundary Notes:** 分享管理接口必须校验 `note.user_id == current_user.id`；分享密码哈希用 `core.security.hash_share_password`，不得与登录密码复用同一字段。

---

## Task 2: 公开读取与密码解锁接口

**Goal:** 未登录可读分享内容；设密码时先返回明确的待解锁态。

**Files:**
- Modify: `routes/share.py`、`tests/smoke_test.py`（追加第 6 组）

**Steps:**
- [x] 追加第 6 组断言：

```python
section("6. 分享")
client.post("/api/auth/login", {"email": "a@b.com", "password": "abc123"})
r = post("/api/notes", {"title": "分享用笔记", "content_md": "分享正文", "status": "published"})
share_note_id = j(r).get("data", {}).get("id")
r = post(f"/api/notes/{share_note_id}/share", {"password": ""})
token = j(r).get("data", {}).get("token")
check("生成免密分享链接", bool(token), j(r))
r = client.get(f"/api/share/{token}")
check("免密分享可读", j(r).get("data", {}).get("note", {}).get("content_md") == "分享正文", j(r))
check("分享响应不含作者邮箱", "a@b.com" not in json.dumps(j(r), ensure_ascii=False))
check("分享响应不含笔记 id", "id" not in j(r).get("data", {}).get("note", {}))
r = post(f"/api/notes/{share_note_id}/share", {"password": "pass1234"})
token2 = j(r).get("data", {}).get("token")
r = client.get(f"/api/share/{token2}")
check("带密码未解锁 → SHARE_PASSWORD_REQUIRED", j(r).get("code") == "SHARE_PASSWORD_REQUIRED", j(r))
r = post(f"/api/share/{token2}/unlock", {"password": "wrong"})
check("密码错误 → SHARE_PASSWORD_WRONG", j(r).get("code") == "SHARE_PASSWORD_WRONG", j(r))
r = post(f"/api/share/{token2}/unlock", {"password": "pass1234"})
check("密码正确解锁成功", j(r).get("code") == "OK", j(r))
r = client.get(f"/api/share/{token2}")
check("解锁后可读", j(r).get("code") == "OK" and j(r).get("data", {}).get("note", {}).get("content_md") == "分享正文", j(r))
check("无效 token → SHARE_NOT_FOUND", j(client.get("/api/share/not-a-token")).get("code") == "SHARE_NOT_FOUND")
r = client.delete(f"/api/notes/{share_note_id}/share")
check("取消分享成功", j(r).get("code") == "OK", j(r))
check("取消后原 token 失效", j(client.get("/api/share/{0}".format(token))).get("code") == "SHARE_NOT_FOUND")
```

- [x] 实现三个公开接口（**无 `login_required`**）：

| 接口 | 规则 |
|---|---|
| `GET /api/share/<token>` | 查 `shares` → 不存在 `SHARE_NOT_FOUND`；有 `password_hash` 且 `not is_share_unlocked(token)` → `SHARE_PASSWORD_REQUIRED`；否则返回 `ok({"note": {"title","content_md","author_username","updated_at","has_password": true}, "unlocked": bool})` |
| `POST /api/share/<token>/unlock` | 同上存在性校验；无密码时直接 `ok()`；有密码时 `verify_share_password` 失败 → `SHARE_PASSWORD_WRONG`，成功 → `set_share_unlocked(token)` + `ok()` |
| `GET /api/share/<token>/comments` | 见 Task 4 |

  - 响应体**只含** share 所需字段：作者用户名、标题、正文、更新时间；**不含** note id、author id、作者邮箱、token 列表。

- [x] 明确不做「作者免密」特例：作者本人打开自己的加锁分享链接同样需要解锁（保持逻辑单一，行为一致）。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 6 组全部 `[OK]`（评论相关断言在 Task 4 追加）。

**Security/Boundary Notes:** `unlocked_shares` 存 session，仅存 token 字符本身，不存密码；解锁态随 session 过期失效。

---

## Task 3: 分享页模板与前端

**Goal:** `/share/<token>` 页可用：未解锁显示密码锁，解锁后渲染内容与评论区。

**Files:**
- Create: `templates/share.html`、`static/js/share.js`
- Modify: `routes/pages.py`、`static/css/style.css`

**Steps:**
- [x] 写 `templates/share.html`（`{% extends "base.html" %}`，但顶栏在分享页应保持简洁：此处不覆写顶栏，未登录访客看到「登录 / 注册 / 关于」是预期行为）：

```html
<section class="share-lock" id="share-lock" hidden>
  <h1>该分享需要密码</h1>
  <label for="unlock-password">访问密码</label>
  <input id="unlock-password" type="password" autocomplete="off">
  <p class="form-error" id="unlock-error" hidden></p>
  <button type="button" id="unlock-btn" class="btn btn-primary">解锁</button>
</section>

<article class="note-paper" id="share-content" hidden>
  <h1 id="share-title"></h1>
  <p class="note-meta">作者：<span id="share-author"></span> · 更新于 <time id="share-time"></time></p>
  <div id="share-body" class="markdown-body"></div>
</article>

<section class="comments" id="share-comments" hidden>
  <h2>评论</h2>
  <div id="comment-list"></div>
  <p id="comment-empty" hidden>还没有评论，来说点什么吧</p>
  <form id="comment-form">
    <div id="nickname-field">
      <label for="nickname">昵称</label>
      <input id="nickname" autocomplete="nickname">
    </div>
    <label for="comment-content">评论内容</label>
    <textarea id="comment-content" rows="3"></textarea>
    <p class="form-error" id="comment-error" hidden></p>
    <button type="submit" class="btn btn-primary">发表评论</button>
  </form>
</section>

<section class="share-invalid" id="share-invalid" hidden>
  <h1>分享链接无效或已取消</h1>
  <a class="btn btn-ghost" href="/">返回主页</a>
</section>
```

- [x] 写 `static/js/share.js`（`TOKEN = location.pathname.split("/").pop()`）：

  1. 页面加载 `GET /api/share/<token>`：
     - `code === "SHARE_PASSWORD_REQUIRED"` → 只显示 `#share-lock`。
     - `code === "SHARE_NOT_FOUND"` → 只显示 `#share-invalid`。
     - `ok` → 显示 `#share-content` 与 `#share-comments`，`#share-title.textContent = note.title || "无标题"`，`#share-author.textContent = note.author_username`，`#share-time.textContent` 用 `new Date(note.updated_at).toLocaleString("zh-CN")`，`#share-body.innerHTML = window.md.render(note.content_md)`。
  2. 解锁：「解锁」→ `POST /api/share/<token>/unlock`，成功则重新走步骤 1；失败 `api.showError(#unlock-error, r.message)` 且**保留输入框内容**、按钮恢复可点。
  3. 评论区：`GET /api/auth/me`，已登录则隐藏 `#nickname-field`；提交调 `POST /api/share/<token>/comments`，body 为 `{nickname, content}`（已登录时 `nickname` 传空串，由后端取用户名）；失败就地展示 `message`。
  4. 评论渲染：昵称与内容一律用 `textContent` 赋值，绝对不用 `innerHTML`。

- [x] `routes/pages.py`：`/share/<token>` 渲染 `share.html`，不做登录判断。

- [x] `<script>` 顺序：`vendor/marked.min.js` → `vendor/purify.min.js` → `js/markdown.js` → `js/api.js`（base 已引）→ `js/share.js`。

- [x] Run: 无痕窗口访问设了密码的分享链接
  - Expected: 只见密码锁；输错密码就地提示「分享密码错误」且输入框内容还在；输对后内容与评论区出现。

- [x] Run: 访问 `/share/not-a-token`
  - Expected: 显示「分享链接无效或已取消」+ 返回主页。

**Visual Verification:** 375 视口下密码锁卡片居中不溢出；内容区羊皮纸纸面与 760px 正文宽度与详情页一致。

---

## Task 4: 评论接口

**Goal:** 游客与登录用户都能评论，校验与文案按 spec。

**Files:**
- Modify: `routes/share.py`、`tests/smoke_test.py`（追加第 7 组）

**Steps:**
- [x] 追加第 7 组断言：

```python
section("7. 评论")
tag = client  # 当前为登录用户 a@b.com
r = post(f"/api/share/{token}/comments", {"nickname": "", "content": "登录用户评论"})
check("登录用户评论成功", j(r).get("code") == "OK", j(r))
r = post(f"/api/share/{token}/comments", {"nickname": "", "content": "   "})
check("空内容 → COMMENT_EMPTY", j(r).get("code") == "COMMENT_EMPTY", j(r))
r = post(f"/api/share/{token}/comments", {"nickname": "", "content": "字" * 501})
check("超长 → COMMENT_TOO_LONG", j(r).get("code") == "COMMENT_TOO_LONG", j(r))

guest = app.test_client()   # 新的无 session 客户端 = 游客
r = guest.post(f"/api/share/{token}/comments", json={"nickname": "", "content": "游客评论"})
check("游客缺昵称 → NICKNAME_REQUIRED", r.get_json().get("code") == "NICKNAME_REQUIRED", r.get_json())
r = guest.post(f"/api/share/{token}/comments", json={"nickname": "路过的猫", "content": "游客评论"})
check("游客填昵称后评论成功", r.get_json().get("code") == "OK", r.get_json())

r = guest.get(f"/api/share/{token}/comments")
names = [c["nickname"] for c in r.get_json().get("data", {}).get("comments", [])]
check("评论列表含两条", len(names) == 2, names)
check("登录评论昵称取用户名", names[0] == "阿黎改名", names)
check("游客评论昵称为其填写值", names[1] == "路过的猫", names)
```

- [x] 实现两个评论接口：

| 接口 | 规则 |
|---|---|
| `GET /api/share/<token>/comments` | 不存在 → `SHARE_NOT_FOUND`；返回 `ok({"comments":[{"nickname","content","created_at"}]})`，`ORDER BY created_at ASC`；**不返回 user_id 与邮箱** |
| `POST /api/share/<token>/comments` | 不存在 → `SHARE_NOT_FOUND`；`content.strip()` 为空 → `COMMENT_EMPTY`；`len(content) > 500` → `COMMENT_TOO_LONG`；已登录 → `user_id = 当前用户`、`nickname = 当前用户 username`（忽略传入昵称）；未登录 → `nickname.strip()` 为空则 `NICKNAME_REQUIRED`（超 30 字 → `INVALID_PARAMS`）、`user_id = NULL`；返回 `ok({"id": ...}, 201)` |

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 1–7 组全部 `[OK]`。

**Security/Boundary Notes:** 加锁分享的评论接口是否也要求解锁？**不要求**评论区位于解锁后的页面上时，接口本身若不校验解锁态就会允许绕过密码留言。实现取**更严格**方案：`POST /api/share/<token>/comments` 与 `GET /api/share/<token>/comments` 在分享设有密码且未解锁时返回 `SHARE_PASSWORD_REQUIRED`。对应断言在 Task 4 中加入第 6 组——**必须插在 `client.delete(.../share)` 取消分享那一步之前**，否则 token 已失效。

---

## Task 5: 评论区 UI 完善与个人主页分享管理

**Goal:** 评论区完整可用；个人主页可看到并取消已生成的分享链接。

**Files:**
- Modify: `templates/share.html`、`static/js/share.js`、`templates/profile.html`、`static/js/profile.js`、`routes/profile.py`

**Steps:**
- [x] 分享页评论区完善：
  - 评论项渲染：`<li><strong>{nickname}</strong><time>{本地时间}</time><p>{content}</p></li>`，全部用 `textContent`。
  - 提交成功后清空 `#comment-content`，重新拉取列表并滚动到新评论处。
  - 空态：列表为空时显示 `#comment-empty` 文案 `还没有评论，来说点什么吧`。
  - 提交中按钮文字变「发表中…」并 `disabled`。

- [x] `routes/profile.py` 追加 `GET /api/share/mine`：`login_required`，返回 `ok({"shares":[{"note_id","note_title","token","url","has_password","created_at"}]})`，按 `shares.created_at DESC`，只含当前用户的笔记。

- [x] `templates/profile.html` 分享管理区块：列表显示笔记标题、是否有密码、创建时间、「打开」链接、「复制链接」与「取消分享」按钮；空态 `还没有分享任何笔记，去笔记详情页点「分享」试试`。

- [x] **顺带补齐 Phase 3 遗留的计划缺口**：`templates/profile.html` 的「我的笔记」区块仍写着占位文案 `功能将在后续阶段填充`，但 spec 的 Components 表要求个人主页展示「我的笔记」。本任务把它填成真实列表：
  - `static/js/profile.js` 加载时调 `GET /api/notes?status=all`，渲染标题（无标题显示 `无标题`）、状态徽标（`草稿` 用 `--text-muted`、`已发布` 用 `--primary-strong`）、更新时间、「查看」「编辑」链接；列表项渲染一律用 `textContent`。
  - 空态文案 `还没有笔记，写下第一条吧` + 「写笔记」按钮（指向 `/notes/new`）。
  - 同步把 `profile` 组的断言从 `"功能将在后续阶段填充"` 改为真实列表断言（例如存在 `id="my-notes-list"` 容器、且不再包含占位文案）。

- [x] `static/js/profile.js` 追加：加载 `GET /api/share/mine` 渲染；「取消分享」→ `DELETE /api/notes/<note_id>/share` → 成功后从列表移除；失败就地提示 `message`。

- [x] Run: `python tests/smoke_test.py` 并在第 6 组末尾补一条：

```python
r = client.get("/api/share/mine")
check("分享管理返回我的分享", j(r).get("code") == "OK" and isinstance(j(r).get("data", {}).get("shares"), list), j(r))
```

  - Expected: 全部 `[OK]`。

- [x] Run: 生成 2 个分享 → 打开 `/profile` → 点「取消分享」其一
  - Expected: 列表立即少一条；被取消的链接访问返回 `SHARE_NOT_FOUND`。

**Visual Verification:** 375 视口下评论表单与分享管理列表不横向滚动；评论项长文本换行不撑破容器。

---

## Phase Completion Checklist

- [x] 全部 5 个任务完成
- [x] `python tests/smoke_test.py` 第 1–7 组全部 `[OK]`
- [x] 免密分享、加锁分享（错误/正确密码）、游客评论、登录评论、取消分享全链路手工验证通过
- [x] 分享相关响应体中确认无邮箱、无 note id、无密码哈希
- [x] 准备进入 Phase 5
