# Phase 3: 笔记管理与收藏

**Goal:** 笔记 CRUD（草稿/发布）与列表筛选可用；编辑页为 Markdown 文本域 + 实时预览分栏并适配移动端标签切换；详情页为羊皮纸纸面且正文对比度达标；收藏可切换并在个人主页列出。
**Prerequisites:** Phase 2 完成（认证、`login_required`、`api.js`、base 模板）
**Deliverables:** `tests/smoke_test.py` 第 4、5 组断言通过；`/notes`、`/notes/new`、`/notes/<id>`、`/notes/<id>/edit` 四个页面完整可交互。

**Interface Decisions Implemented:** 编辑页 50/50 分栏与移动端「编辑 / 预览」标签切换（spec Responsive Rules）；羊皮纸签名元素与 `--parchment-ink` 正文（spec Visual System）；列表三态空状态（spec Components 空状态）；「保存中…」加载态与删除二次确认（spec Components 加载中 / 危险操作）；笔记术语统一（spec 术语一致性）；URL 渲染结果必须经 DOMPurify 净化（spec Security）。

---

## Task 1: 笔记 CRUD 接口（测试先行）

**Goal:** 六个笔记接口按 spec 规则工作，草稿与发布的标题校验不同，越权一律按「不存在」处理。

**Files:**
- Create: `routes/notes.py`
- Modify: `app.py`（注册 `notes_bp`）、`tests/smoke_test.py`（追加第 4 组）

**Steps:**
- [x] 先追加第 4 组断言：

```python
section("4. 笔记")
# 当前登录用户为 a@b.com（Phase 2 末已登录）；先建一个"他人"账号用于越权测试
client.post("/api/auth/logout")
post("/api/auth/register", {"email": "other@b.com", "username": "他人", "password": "abc123", "confirm_password": "abc123"})
r = post("/api/notes", {"title": "他人的笔记", "content_md": "x", "status": "published"})
other_note_id = j(r).get("data", {}).get("id")
check("他人账号创建笔记成功", j(r).get("code") == "OK", j(r))
client.post("/api/auth/logout")
post("/api/auth/login", {"email": "a@b.com", "password": "abc123"})

r = post("/api/notes", {"title": "", "content_md": "草稿内容", "status": "draft"})
draft_id = j(r).get("data", {}).get("id")
check("空标题存草稿成功", j(r).get("code") == "OK" and draft_id, j(r))
r = post("/api/notes", {"title": "   ", "content_md": "x", "status": "published"})
check("空标题发布 → NOTE_TITLE_REQUIRED", j(r).get("code") == "NOTE_TITLE_REQUIRED", j(r))
r = post("/api/notes", {"title": "发布笔记", "content_md": "# 标题\n正文", "status": "published"})
pub_id = j(r).get("data", {}).get("id")
check("发布笔记成功", j(r).get("code") == "OK" and pub_id, j(r))
check("非法 status → INVALID_PARAMS", j(post("/api/notes", {"title": "x", "content_md": "", "status": "weird"})).get("code") == "INVALID_PARAMS")

r = get("/api/notes?status=all")
check("列表 all 含 2 条", len(j(r).get("data", {}).get("notes", [])) == 2, j(r))
r = get("/api/notes?status=draft")
check("列表 draft 含 1 条", len(j(r).get("data", {}).get("notes", [])) == 1, j(r))
r = get("/api/notes?status=published")
check("列表 published 含 1 条", len(j(r).get("data", {}).get("notes", [])) == 1, j(r))

r = get(f"/api/notes/{pub_id}")
check("详情可读且含正文", j(r).get("data", {}).get("note", {}).get("content_md") == "# 标题\n正文", j(r))
r = client.put(f"/api/notes/{pub_id}", json={"title": "改过的标题", "content_md": "改过的内容", "status": "published"})
check("更新成功", j(r).get("code") == "OK", j(r))
check("更新后标题已变", j(get(f"/api/notes/{pub_id}")).get("data", {}).get("note", {}).get("title") == "改过的标题")
r = get(f"/api/notes/{other_note_id}")
check("读他人笔记 → NOTE_NOT_FOUND", j(r).get("code") == "NOTE_NOT_FOUND", j(r))
r = client.put(f"/api/notes/{other_note_id}", json={"title": "x", "content_md": "", "status": "draft"})
check("改他人笔记 → NOTE_NOT_FOUND", j(r).get("code") == "NOTE_NOT_FOUND", j(r))
r = client.delete(f"/api/notes/{other_note_id}")
check("删他人笔记 → NOTE_NOT_FOUND", j(r).get("code") == "NOTE_NOT_FOUND", j(r))
check("不存在的 id → NOTE_NOT_FOUND", j(get("/api/notes/999999")).get("code") == "NOTE_NOT_FOUND")
r = client.delete(f"/api/notes/{draft_id}")
check("删除自己的草稿成功", j(r).get("code") == "OK", j(r))
check("删除后详情 → NOTE_NOT_FOUND", j(get(f"/api/notes/{draft_id}")).get("code") == "NOTE_NOT_FOUND")
```

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 4 组全部 `[FAIL]`（接口未实现）。

- [x] 实现 `routes/notes.py`（`notes_bp = Blueprint("notes", __name__, url_prefix="/api/notes")`，全部 `login_required`）：

| 接口 | 规则 |
|---|---|
| `GET ""` | `status` 取值 `all`（默认）/`draft`/`published`，其它值 → `INVALID_PARAMS`；SQL 固定带 `user_id = ?`；`ORDER BY updated_at DESC`；返回 `{"notes":[{id,title,status,updated_at,created_at,excerpt}]}`（`excerpt` = 正文去 Markdown 符号后前 60 字） |
| `POST ""` | `status` 非 `draft`/`published` → `INVALID_PARAMS`；`published` 且 `title.strip()` 为空 → `NOTE_TITLE_REQUIRED`；插入时 `created_at = updated_at = now_iso()`；`published` 时 `published_at = now_iso()`；返回 `ok({"id": ...}, 201)` |
| `GET "/<int:note_id>"` | 查不到或不属于当前用户 → `NOTE_NOT_FOUND` |
| `PUT "/<int:note_id>"` | 同 POST 的校验；更新 `updated_at`；仅当由 draft 变为 published 时填 `published_at`；返回 `ok({"id": ...})` |
| `DELETE "/<int:note_id>"` | 同越权规则；删除后返回 `ok()`（级联由外键处理） |

- [x] 越权实现要点：所有查询使用 `WHERE id = ? AND user_id = ?`，查不到即返回 `NOTE_NOT_FOUND`（**不使用 `FORBIDDEN`**，避免探测他人笔记是否存在）。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 4 组全部 `[OK]`。

**Security/Boundary Notes:** 每个接口都要有 `login_required`；SQL 不得出现 `f"...{note_id}"` 形式拼接。

---

## Task 2: 下载 vendored 渲染库并封装 `markdown.js`

**Goal:** 本地拥有 Markdown 解析与 HTML 净化能力，断网可用。

**Files:**
- Create: `static/vendor/marked.min.js`（或包内等价 UMD 构建，文件名以实际为准并记录）、`static/vendor/purify.min.js`
- Create: `static/js/markdown.js`

**Steps:**
- [x] 解析版本号（不猜）：

```bash
curl -s https://registry.npmmirror.com/marked/latest    | python -c "import sys,json;print(json.load(sys.stdin)['version'])"
curl -s https://registry.npmmirror.com/dompurify/latest | python -c "import sys,json;print(json.load(sys.stdin)['version'])"
```

  - Expected: 各输出一个形如 `1x.y.z` 的版本号。记下 `MARKED_VERSION` 与 `DOMPURIFY_VERSION`，写入 README。

- [x] 下载并放置文件：

```bash
# DOMPurify 的 npm 包内路径固定为 dist/purify.min.js
curl -sL -o /tmp/dompurify.tgz "https://registry.npmmirror.com/dompurify/-/dompurify-${DOMPURIFY_VERSION}.tgz"
tar -xzf /tmp/dompurify.tgz -C /tmp package/dist/purify.min.js
cp /tmp/package/dist/purify.min.js static/vendor/purify.min.js

# marked 的包内文件名随版本变化，先解包再挑 UMD/IIFE 构建
curl -sL -o /tmp/marked.tgz "https://registry.npmmirror.com/marked/-/marked-${MARKED_VERSION}.tgz"
tar -xzf /tmp/marked.tgz -C /tmp
ls -l /tmp/package /tmp/package/lib 2>/dev/null
```

  - Expected: 能看到一个浏览器可直接用的构建（UMD/IIFE）；把它复制成 `static/vendor/marked.min.js`。
  - 判定标准：该文件**不含**顶层 `export` / `import` 语句（浏览器 `<script>` 直接引入即可用）。
  - 若两种下载都失败：改用自研最小渲染子集（标题/加粗/斜体/有序无序列表/引用/行内与围栏代码/链接/图片/分隔线）+ 白名单净化，并把这一降级写进 README（见计划 Deferred #2）。

- [x] 校验下载结果：

```bash
wc -c static/vendor/*.js
grep -c "^export" static/vendor/*.js || true
```

  - Expected: 两个文件均 > 5000 字节；`export` 计数为 0。

- [x] 写 `static/js/markdown.js`：

```js
(function () {
  const SAFE_LINK = { ADD_ATTR: ["target", "rel"], FORBID_TAGS: ["style", "iframe", "form", "script"], FORBID_ATTR: ["style"] };

  function render(src) {
    if (typeof src !== "string" || !src) return "";
    const raw = window.marked.parse(src, { gfm: true, breaks: false });
    const clean = window.DOMPurify.sanitize(raw, SAFE_LINK);
    // 外链补 rel，避免 tabnabbing
    return clean.replace(/<a /g, '<a target="_blank" rel="noopener nofollow" ');
  }
  window.md = { render };
})();
```

- [x] Run: 临时在 `/notes/<id>` 详情页引入 `vendor/marked.min.js`、`vendor/purify.min.js`、`js/markdown.js`，控制台执行：

```js
window.md.render("[链接](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n## 标题")
```

  - 注意：`## 标题` **必须独占一行**（前面留一个空行），否则 CommonMark 不会把它解析为标题，断言会误判。

  - Expected: 输出中**不含** `javascript:`、不含 `onerror`，含 `<h2>标题</h2>`。

**Security/Boundary Notes:** 这是全站唯一允许产出 HTML 的模块；任何页面都不得绕过它直接 `innerHTML = marked.parse(...)`。

---

## Task 3: 编辑页（分栏 + 预览 + 保存/发布）

**Goal:** `/notes/new` 与 `/notes/<id>/edit` 可写可存，移动端切换标签。

**Files:**
- Create: `templates/note_edit.html`、`static/js/editor.js`、`static/js/note_edit.js`
- Modify: `routes/pages.py`、`static/css/style.css`

**Steps:**
- [x] 写 `static/js/editor.js`，暴露 `window.Editor`：

```js
window.Editor = (function () {
  let ta, preview, onChangeCb = null, timer = null;
  function init(textareaEl, previewEl) { ta = textareaEl; preview = previewEl; }
  function getValue() { return ta.value; }
  function setValue(v) { ta.value = v; refresh(); }
  function getSelection() {                       // 无选中时 text 为空串
    return { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  }
  function replaceSelection(text) {               // 优先 execCommand 以保留浏览器原生撤销栈
    const sel = getSelection();
    ta.focus();
    ta.setSelectionRange(sel.start, sel.end);
    const replaced = document.execCommand && document.execCommand("insertText", false, text);
    if (!replaced) {                              // 回退：手动拼接并把光标移到替换段之后
      ta.value = ta.value.slice(0, sel.start) + text + ta.value.slice(sel.end);
      ta.setSelectionRange(sel.start + text.length, sel.start + text.length);
    }
    refresh();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function refresh() { preview.innerHTML = window.md.render(ta.value); }
  function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(refresh, 150); }
  function onChange(cb) { onChangeCb = cb; }
  function init2() { /* 内部：绑定 input 事件 → scheduleRefresh + onChangeCb() */ }
  return { init, getValue, setValue, getSelection, replaceSelection, refresh, refreshSoon: scheduleRefresh, onChange };
})();
```

  - `init(textarea, previewEl)` 内绑定 `textarea.addEventListener("input", () => { scheduleRefresh(); onChangeCb && onChangeCb(); })`。

- [x] 写 `templates/note_edit.html`：

```
┌ 顶部条 ─────────────────────────────────────────────────┐
│ ← 返回   [标题输入框]        [AI 润色]  [保存草稿] [发布] │
├ 编辑区 .editor-split（≥768px 两栏 / <768px 单栏 + 标签）──┤
│  <textarea id="content" class="editor-pane">            │
│  <div id="preview" class="preview-pane parchment">      │
└──────────────────────────────────────────────────────────┘
```

  - 移动端标签：`<div class="editor-tabs"><button data-mode="edit">编辑</button><button data-mode="preview">预览</button></div>`，容器上切换 `data-mode="edit"|"preview"`；`.editor-tabs` **默认 `display:none`**（仅 `<768px` 由 Phase 6 的响应式规则改为 `display:flex`），此时按 `data-mode` 显示其一，默认 `edit`（不记忆，见计划 Deferred #8）。
  - `<script>` 引入顺序：`vendor/marked.min.js` → `vendor/purify.min.js` → `js/markdown.js` → `js/editor.js` → `js/note_edit.js`。
    **本阶段不要引入 `js/polish.js`**，也不要放置 `#ai-polish-btn` / `#editor-error` —— 它们由 Phase 5 Task 4 与本阶段之后添加，提前引用会产生 404。
  - `<textarea>` 必须带 `<label for="content">笔记内容</label>`（可视觉隐藏但存在），并带 `spellcheck="false"`。

- [x] 写 `static/js/note_edit.js`：

  - `GET /api/auth/me` 失败 → 跳 `/login`。
  - 编辑模式：`GET /api/notes/<id>` 回填标题与正文，`Editor.setValue()` 后 `Editor.refresh()`；不存在或无权限 → 展示 `message` 并给「返回列表」链接。
  - 「保存草稿」→ `POST /api/notes`（新建）或 `PUT /api/notes/<id>`，`status="draft"`；按钮文字变「保存中…」并 `disabled`；成功提示 `已保存草稿`（2 秒消失），新建成功后把 URL 换成 `/notes/<id>/edit`（`history.replaceState`）以免重复新建。
  - 「发布」→ 前端先校验标题非空，为空就地提示「请填写笔记标题」；成功后 `location.href = "/notes/<id>"`。
  - 所有失败都走 `api.showError(errorEl, r.message)`。

- [x] `routes/pages.py`：`/notes/new` 与 `/notes/<id>/edit` 未登录时 `redirect("/login")`。

- [x] Run: 浏览器新建笔记，输入 `# 标题` + 一段文字，点「保存草稿」再点「发布」
  - Expected: 草稿保存成功提示出现；发布后跳到详情页；右侧预览在输入时约 150ms 内更新。

- [x] Run: 375px 视口打开编辑页
  - Expected: 出现「编辑 / 预览」标签，点击可切换且无横向滚动条。

**Visual Verification:** 1440 视口两栏各 50%；768 视口为 55/45；375 视口单栏 + 标签；预览区为羊皮纸纸面。

---

## Task 4: 笔记列表页与筛选

**Goal:** `/notes` 可按「全部 / 已发布 / 草稿」筛选，含三态空状态。

**Files:**
- Create: `templates/notes_list.html`、`static/js/notes_list.js`
- Modify: `routes/pages.py`

**Steps:**
- [x] 写模板：顶部标题「我的笔记」+ 「写笔记」主按钮；筛选条用三个按钮（`data-status="all|published|draft"`，当前项加 `.is-active`）；列表项卡片显示标题（草稿无标题时显示 `无标题`）、状态徽标（`草稿` 用 `--text-muted`、`已发布` 用 `--primary-strong`——徽标承载文字，必须用强金色）、更新时间、摘要 `excerpt`、以及「编辑」「查看」链接。

- [x] 写 `static/js/notes_list.js`：点击筛选取 `GET /api/notes?status=<值>` 重渲染；空状态按 spec 文案：

  - `all` 无数据 → `还没有笔记，写下第一条吧` + 「写笔记」按钮
  - `draft` 无数据 → `草稿箱是空的`
  - `published` 无数据 → `还没有发布的笔记`

  - 列表项渲染必须用 `textContent` 赋值，禁止用 `innerHTML` 拼接标题/摘要。

- [x] Run: `POST` 创建 1 条草稿与 1 条已发布后，浏览器打开 `/notes`
  - Expected: 「全部」显示 2 条；切「草稿」显示 1 条；切「已发布」显示 1 条；筛选切换不整页刷新。

- [x] Run: 删掉全部笔记后打开 `/notes`
  - Expected: 显示对应空状态文案与「写笔记」按钮。

**Visual Verification:** 375 视口下列表不横向滚动；筛选条三个按钮可点区域 ≥ 44px。

---

## Task 5: 详情页（羊皮纸纸面）

**Goal:** `/notes/<id>` 渲染 Markdown、可收藏、可编辑/删除、可发起分享（Phase 4 接面板）。

**Files:**
- Create: `templates/note_detail.html`、`static/js/note_detail.js`
- Modify: `routes/pages.py`、`static/css/style.css`

**Steps:**
- [x] 加羊皮纸样式（**签名元素**，全站唯一定义处）：

```css
.note-paper{
  background: #F2E7D0 url("/static/img/parchment.jpg") center/100% 100% no-repeat;
  color: var(--parchment-ink);
  border-radius: var(--radius);
  padding: var(--space-6) var(--space-5);
  max-width: 760px; margin: 0 auto;
}
.note-paper h1,
.note-paper h2 { border-bottom: 2px solid var(--primary); display: inline-block; padding-bottom: 2px; }
.note-paper a { color: var(--primary-strong); }   /* 5.04:1 on 纸面底色，勿用 --primary */
.note-paper code, .note-paper pre { font-family: var(--font-mono); }
@media (max-width: 767px){ .note-paper{ padding: var(--space-5) var(--space-4); background-size: 100% 100%; } }
```

  - `background-size: 100% 100%` 是有意选择：保证素材图四角的花纹装饰始终落在纸面四角；纹理会有拉伸但对比度极低不显眼。**视觉走查时若拉伸明显，改为 `cover`**（Phase 6 走查项）。

- [x] 写模板：标题用衬线字体（`--font-serif`），下方显示更新时间；纸面上方操作条含：`收藏`（心形，收藏后实心 + `--accent` 填充）、`分享`、`编辑`、`删除`；纸面下方为评论区占位（Phase 4 填充）。

- [x] 写 `static/js/note_detail.js`：
  - `GET /api/notes/<id>`：成功则 `title.textContent = note.title || "无标题"`、`body.innerHTML = window.md.render(note.content_md)`、按 `note.favorited` 设置收藏按钮态。
  - 「收藏」→ `POST /api/notes/<id>/favorite`，用返回的 `favorited` 切按钮态与 `aria-pressed`。
  - 「删除」→ 先 `confirm("删除后无法恢复，确定要删除这篇笔记吗？")`，确认后 `DELETE /api/notes/<id>`，成功跳 `/notes`。
  - 「编辑」→ `location.href = "/notes/<id>/edit"`。
  - 失败（含 `NOTE_NOT_FOUND`）→ 整页显示 `message` + 「返回我的笔记」链接。

- [x] Run: 打开一条含 `# 标题`、加粗、列表、代码块、链接的笔记
  - Expected: 全部正确渲染；纸面四角可见花纹；正文为深褐色。

- [x] Run: 打开一条不存在的 id
  - Expected: 页面显示「笔记不存在」与返回链接，不出现堆栈或空白页。

**Visual Verification:** 1440 / 768 / 375 三视口下 760px 正文区不溢出；375 下纸面无横向滚动；正文与纸面背景对比度 ≥ 7:1（用取色器实测前景 `#4A3B2A` 与纸面实测底色）。

---

## Task 6: 收藏接口与个人主页收藏区

**Goal:** 收藏可切换，个人主页 `#favorites` 区块列出收藏的笔记。

**Files:**
- Modify: `routes/profile.py`（追加 `POST /api/notes/<id>/favorite` 与 `GET /api/favorites`）、`templates/profile.html`、`static/js/profile.js`、`tests/smoke_test.py`（追加第 5 组）

**Steps:**
- [x] 追加第 5 组断言：

```python
section("5. 收藏")
r = post(f"/api/notes/{pub_id}/favorite", {})
check("首次收藏 → favorited=True", j(r).get("data", {}).get("favorited") is True, j(r))
check("收藏列表含 1 条", len(j(get("/api/favorites")).get("data", {}).get("notes", [])) == 1)
r = post(f"/api/notes/{pub_id}/favorite", {})
check("再次点击 → favorited=False", j(r).get("data", {}).get("favorited") is False, j(r))
check("收藏列表清空", len(j(get("/api/favorites")).get("data", {}).get("notes", [])) == 0)
post(f"/api/notes/{pub_id}/favorite", {})
check("收藏他人笔记 → NOTE_NOT_FOUND", j(post(f"/api/notes/{other_note_id}/favorite", {})).get("code") == "NOTE_NOT_FOUND")
check("详情返回收藏态", j(get(f"/api/notes/{pub_id}")).get("data", {}).get("note", {}).get("favorited") is True)
client.delete(f"/api/notes/{pub_id}")
check("收藏的笔记被删除后收藏列表为空", len(j(get("/api/favorites")).get("data", {}).get("notes", [])) == 0)
```

- [x] 实现接口：`POST /api/notes/<id>/favorite`（`login_required` + `user_id` 过滤查笔记，查不到 `NOTE_NOT_FOUND`；存在则删、不存在则插；返回 `ok({"favorited": bool})`）；`GET /api/favorites` 返回 `{"notes":[...]}`，`JOIN` 笔记表按 `favorites.created_at DESC` 排序。

- [x] 详情页 `GET /api/notes/<id>` 的返回体增加 `favorited` 字段（用 `EXISTS` 子查询）。

- [x] `templates/profile.html` 的收藏区块：`<section id="favorites">` 标题「我的收藏」+ 列表（标题 + 更新时间 + 查看链接），空态文案 `还没有收藏，去笔记列表看看吧` + 「去笔记列表」链接（指向 `/notes`）。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 1–5 组全部 `[OK]`，失败数 0。

- [x] Run: 详情页点收藏 → 打开 `/profile#favorites`
  - Expected: 收藏列表出现该笔记；取消收藏后消失。

**Security/Boundary Notes:** 收藏只能针对自己的笔记；`GET /api/favorites` 必须带 `favorites.user_id = current_user.id`。

---

## Phase Completion Checklist

- [x] 全部 6 个任务完成
- [x] `python tests/smoke_test.py` 第 1–5 组全部 `[OK]`
- [x] `/notes` 三态筛选与空状态正确；`/notes/new` 分栏与移动端标签可用；详情页羊皮纸渲染无 XSS
- [x] XSS 冒烟：`<img src=x onerror=alert(1)>` 与 `[x](javascript:alert(1))` 均不执行
- [x] 准备进入 Phase 4
