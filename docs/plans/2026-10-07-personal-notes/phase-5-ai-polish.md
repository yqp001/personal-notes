# Phase 5: AI 润色

**Goal:** 编辑页内划词选中文本 → 右键出现「AI 润色」菜单 → 弹出左右对照窗口 → 「确认替换」把结果精确写回选中位置；Mock 为默认 provider 可离线演示，配置后可切真实 OpenAI 兼容调用。
**Prerequisites:** Phase 3 完成（`editor.js` 选区接口、编辑页分栏、`markdown.js`）；Phase 2 完成（`login_required`）
**Deliverables:** `tests/smoke_test.py` 第 8 组断言通过；编辑页划词右键与工具栏按钮两条入口都能完成一次润色替换；无 Key 时显示「演示模式」徽标。

**Interface Decisions Implemented:** 右键菜单仅一项「AI 润色」且选区为空时不弹（spec 主要旅程 2 / 已确认决策 5）；弹窗标题「AI 文本润色」、左「原文」只读、右「润色结果」可编辑、右下「取消 / 确认替换」（spec Layout 线框图与 Components）；「润色中…」加载态、失败提示 + 「重试」（spec Components 加载中 / Error Handling）；「演示模式」徽标（spec Components 润色弹窗）；取消时原文零改动（spec 失败分支）；键盘等价入口 + 焦点锁定 + Esc（spec Accessibility）；`execCommand('insertText')` 保留撤销栈（spec Boundaries 假设）。

---

## Task 1: Provider 抽象与 Mock 实现

**Goal:** 润色能力可插拔，默认 Mock 完全离线且输出确定。

**Files:**
- Create: `core/ai/base.py`、`core/ai/mock.py`

**Steps:**
- [x] 写 `core/ai/base.py`：

```python
import core.codes as codes

class PolishError(Exception):
    """携带错误码，由路由层直接映射为 fail(code)。"""
    def __init__(self, code, detail=""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail

class PolishProvider:
    name = "base"
    def polish(self, text: str) -> str:
        raise NotImplementedError
    @property
    def available(self) -> bool:
        return True

_cache = {}

def get_provider():
    """按 config.AI_PROVIDER 返回单例；未知取值回退 mock 并打日志。"""
```

  - `get_provider()` 从 `flask.current_app.config` 读取 `AI_PROVIDER`；`"mock"` → `MockProvider()`，`"openai"` → `OpenAICompatProvider()`（Task 2 实现，此任务先用 `raise PolishError(codes.AI_UNAVAILABLE)` 占位），其它值 → 记 `current_app.logger.warning` 后回退 mock。

- [x] 写 `core/ai/mock.py`，`MockProvider.name = "mock"`，`polish()` 依次应用 4 条规则（顺序固定，纯函数、无随机）：

```python
import re
CJK = r"\u4e00-\u9fff"
_PUNCT_MAP = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！"}
_END = "。！？…～）」』\"'"

def _collapse_ws(text):
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))

def _normalize_punct(text):
    # 仅当 ASCII 标点紧跟在汉字之后时转全角，避免破坏英文与代码
    def repl(m):
        return m.group(1) + _PUNCT_MAP[m.group(2)]
    for half, full in _PUNCT_MAP.items():
        text = re.sub(f"([{CJK}])\\{half}", lambda m, f=full: m.group(1) + f, text)
    return text

def _ensure_end_punct(text):
    stripped = text.rstrip()
    if not stripped:
        return text
    if stripped[-1] not in _END and stripped[-1] not in "。！？；，：、】》":
        return stripped + "。"
    return text

def _dedupe_words(text):
    text = re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", text)                 # 重复的英文词
    return re.sub(r"([\u4e00-\u9fff]{2,4})\1+", r"\1", text)          # 紧邻重复的 2–4 字中文词
```

  - `polish()` 的顺序为：`_collapse_ws` → `_strip_cjk_spaces` → `_normalize_punct` → `_collapse_punct` → `_ensure_end_punct` → `_dedupe_words`（去重放最后，避免把标点并入重复片段）。
  - **规则 5、6 是执行时依据 spec Deferred #1「演示效果不理想可增补规则」补上的**：只做前 4 步会把示例输入变成 `这是 一段，,需要润色的文字。`，留着汉字间空格与 `，,` 混用标点。规则 5 = 去除汉字之间的空格（不动中英之间的空格），规则 6 = 合并紧邻的重复/混用标点（仅在含全角标点或紧邻汉字时合并，以免破坏英文省略号 `a...b`、`1.2`、`e.g.`）。增补后示例输出为 `这是一段，需要润色的文字。`，且二次润色结果不再变化。

- [x] Run: `python -c "from core.ai.mock import MockProvider; p=MockProvider(); s='这是  一段,,需要润色的文字'; print(repr(p.polish(s))); print(repr(p.polish(s))==repr(p.polish(s)))"`
  - Expected: 输出形如 `'这是一段，需要润色的文字。'`，第二行 `True`（确定性）。

- [x] Run: `python -c "from core.ai.mock import MockProvider; print(MockProvider().polish('已经很好的句子。'))"`
  - Expected: 原样返回（不强行改写已规范文本）。

**Security/Boundary Notes:** Mock 不做任何网络访问、不读环境变量；不得引入事实性改写（只做格式规范化）。

---

## Task 2: 真实 Provider（OpenAI 兼容）

**Goal:** 配置环境变量后走真实大模型；未配置或上游异常时映射为明确中文错误。

**Files:**
- Create: `core/ai/openai_compat.py`
- Modify: `core/ai/base.py`（接上真实实现）

**Steps:**
- [x] 写 `core/ai/openai_compat.py`：

```python
import json, requests
from flask import current_app
import core.codes as codes
from core.ai.base import PolishError, PolishProvider

SYSTEM_PROMPT = (
    "你是一位中文写作润色助手。请在不改变原意、不增删事实的前提下，"
    "提升输入文本的流畅度、清晰度与文采。只输出润色后的文本本身，"
    "不要输出任何解释、前后缀、引号或 Markdown 代码块。"
)

class OpenAICompatProvider(PolishProvider):
    name = "openai"

    def __init__(self):
        c = current_app.config
        self.base_url = (c.get("AI_BASE_URL") or "").rstrip("/")
        self.api_key = c.get("AI_API_KEY") or ""
        self.model = c.get("AI_MODEL") or ""
        self.timeout = c.get("AI_TIMEOUT", 15)
        self.temperature = c.get("AI_TEMPERATURE", 0.3)

    @property
    def available(self):
        return bool(self.base_url and self.api_key and self.model)

    def polish(self, text: str) -> str:
        if not self.available:
            raise PolishError(codes.AI_UNAVAILABLE, "AI 服务未配置")
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        }
        try:
            resp = requests.post(
                url, json=payload, timeout=self.timeout,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            )
        except requests.Timeout:
            raise PolishError(codes.AI_TIMEOUT)
        except requests.RequestException:
            raise PolishError(codes.AI_UNAVAILABLE)
        if resp.status_code != 200:
            current_app.logger.warning("AI 上游返回 %s: %s", resp.status_code, resp.text[:300])
            raise PolishError(codes.AI_UNAVAILABLE)
        try:
            content = resp.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise PolishError(codes.AI_UNAVAILABLE, "无法解析上游响应")
        if not content or not content.strip():
            current_app.logger.warning("AI 上游返回空内容")
            raise PolishError(codes.AI_UNAVAILABLE, "上游返回空内容")
        return content.strip()
```

- [x] `core/ai/base.py` 的 `get_provider()` 接上 `OpenAICompatProvider`（延迟 import，避免 `requests` 未装时影响 mock 模式启动）。

- [x] Run: `AI_PROVIDER=openai python -c "import app; from core.ai.base import get_provider; get_provider().polish('测试')"`（不提供任何 KEY 环境变量）
  - Expected: 抛出 `PolishError`，`code == 'AI_UNAVAILABLE'`（不是 `ImportError`、不是 `KeyError`）。

- [x] Run: `python -c "import app, os; from core.ai.base import get_provider; p=get_provider(); print(p.name, getattr(p,'available',None))"`（默认 mock）
  - Expected: `mock True`

**Security/Boundary Notes:** `AI_API_KEY` 不出现在任何日志、响应与模板中；`Authorization` 头只在请求内构造；`resp.text[:300]` 只写日志不返回前端。README 必须写明「启用真实 provider 会把选中文本发送至所配置的服务商」。

**Dependencies:** `requests`（已在 `requirements.txt` 锁定）。

---

## Task 3: 润色接口（测试先行）

**Goal:** `/api/ai/status` 与 `/api/ai/polish` 按 spec 工作。

**Files:**
- Create: `routes/ai.py`
- Modify: `app.py`（注册 `ai_bp`）、`tests/smoke_test.py`（追加第 8 组）

**Steps:**
- [x] 追加第 8 组断言：

```python
section("8. AI 润色")
from unittest.mock import patch
from core.ai.base import PolishError

r = get("/api/ai/status")
check("status 返回 provider=mock", j(r).get("data", {}).get("provider") == "mock", j(r))
check("status available=True", j(r).get("data", {}).get("available") is True, j(r))
r = post("/api/ai/polish", {"text": "   "})
check("空文本 → AI_EMPTY_TEXT", j(r).get("code") == "AI_EMPTY_TEXT", j(r))
r = post("/api/ai/polish", {"text": "字" * 2001})
check("超长 → AI_TOO_LONG", j(r).get("code") == "AI_TOO_LONG", j(r))
src = "这是  一段,,需要润色的文字"
r = post("/api/ai/polish", {"text": src})
body = j(r)
check("润色成功且 provider=mock", body.get("code") == "OK" and body.get("data", {}).get("provider") == "mock", body)
check("润色结果非空且与原文不同", body.get("data", {}).get("polished") and body["data"]["polished"] != src, body)
check("同一输入两次结果一致", post("/api/ai/polish", {"text": src}).get_json()["data"]["polished"] == body["data"]["polished"])

class _Unavailable:
    name = "mock"; available = True
    def polish(self, text): raise PolishError("AI_UNAVAILABLE")
class _Timeout:
    name = "mock"; available = True
    def polish(self, text): raise PolishError("AI_TIMEOUT")

with patch("routes.ai.get_provider", return_value=_Unavailable()):
    check("上游不可用 → AI_UNAVAILABLE", j(post("/api/ai/polish", {"text": "abcdef"})).get("code") == "AI_UNAVAILABLE")
with patch("routes.ai.get_provider", return_value=_Timeout()):
    check("上游超时 → AI_TIMEOUT", j(post("/api/ai/polish", {"text": "abcdef"})).get("code") == "AI_TIMEOUT")

r = post("/api/ai/polish", {})
check("缺少 text 字段 → INVALID_PARAMS", j(r).get("code") == "INVALID_PARAMS", j(r))
anon = app.test_client()
check("未登录调用 → AUTH_REQUIRED", anon.post("/api/ai/polish", json={"text": "x"}).get_json().get("code") == "AUTH_REQUIRED")
```

  - 注意：`routes/ai.py` 必须以 `from core.ai.base import get_provider` 的形式导入，测试才能 `patch("routes.ai.get_provider")`。

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 8 组全部 `[FAIL]`。

- [x] 实现 `routes/ai.py`（`ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")`，两个接口都 `login_required`）：

| 接口 | 规则 |
|---|---|
| `GET /status` | 返回 `ok({"provider": p.name, "available": bool(p.available)})` |
| `POST /polish` | body 无 `text` 字段或非字符串 → `INVALID_PARAMS`；`text.strip()` 为空 → `AI_EMPTY_TEXT`；`len(text) > AI_MAX_CHARS` → `AI_TOO_LONG`；调用 `get_provider().polish(text)`；捕获 `PolishError` → `fail(e.code)` 并 `current_app.logger.warning`；其它异常 → 记录后 `fail(codes.AI_UNAVAILABLE)`；成功 → `ok({"polished": result, "provider": p.name})` |

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 1–8 组全部 `[OK]`，失败数 0。

**Security/Boundary Notes:** 必须 `login_required`（spec 滥用限制）；长度上限用 `AI_MAX_CHARS` 而非硬编码；异常一律换算成 spec 错误码，不把上游报文透传给前端。

---

## Task 4: 右键菜单与工具栏入口

**Goal:** 划词后右键只出现「AI 润色」；未选中时不弹；工具栏提供键盘等价入口。

**Files:**
- Create: `static/js/polish.js`
- Modify: `templates/note_edit.html`（加工具栏按钮与脚本引入）、`static/css/style.css`

**Steps:**
- [x] 在 `templates/note_edit.html` 顶部条加入口（**键盘等价入口**）：

```html
<button type="button" id="ai-polish-btn" class="btn btn-ghost">AI 润色</button>
```

- [x] 写 `static/js/polish.js` 的菜单部分：

```js
(function () {
  let editor = null, menu = null, lastProvider = null;

  function buildMenu() {
    menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.hidden = true;
    menu.innerHTML = '<button type="button" class="ctx-item">AI 润色</button>';
    menu.querySelector(".ctx-item").addEventListener("click", () => { hideMenu(); openModal(); });
    document.body.appendChild(menu);
  }
  function showMenu(x, y) {
    menu.hidden = false;
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top  = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + "px";
  }
  function hideMenu() { if (menu) menu.hidden = true; }

  function bind(textarea) {
    buildMenu();
    textarea.addEventListener("contextmenu", (e) => {
      const sel = editor.getSelection();
      if (!sel.text.trim()) { hideMenu(); return; }   // 未选中：保留浏览器原生菜单
      e.preventDefault();
      showMenu(e.clientX, e.clientY);
    });
    document.addEventListener("click", hideMenu);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideMenu(); });
    document.getElementById("ai-polish-btn").addEventListener("click", () => {
      const sel = editor.getSelection();
      if (!sel.text.trim()) { window.api.showError(document.getElementById("editor-error"), "请先选中需要润色的文本"); return; }
      openModal();
    });
  }
  window.Polish = { bind };
})();
```

  - `openModal()` 在 Task 5 实现；`hideMenu()` 必须先于打开弹窗执行，避免菜单压在弹窗上。
  - 菜单样式：`.ctx-menu{position:fixed;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-btn);box-shadow:var(--shadow);padding:var(--space-1);z-index:100}`；`.ctx-item{display:block;width:100%;padding:var(--space-2) var(--space-3);background:none;border:0;text-align:left;cursor:pointer;font-size:14px;color:var(--text);border-radius:6px}`，hover 用 `var(--bg)`。

- [x] 在 `note_edit.html` 增加 `<p class="form-error" id="editor-error" hidden></p>`（工具栏下方），用于工具栏入口的「请先选中需要润色的文本」提示。

- [x] Run: 编辑页不选中任何文本 → 右键
  - Expected: 出现浏览器原生菜单，不出现自定义菜单。

- [x] Run: 划词选中一段 → 右键
  - Expected: 出现仅含「AI 润色」的自定义菜单，位置贴合鼠标且不出视口。

- [x] Run: 不选中文本，点工具栏「AI 润色」
  - Expected: 显示红字「请先选中需要润色的文本」。

**Visual Verification:** 375 视口下菜单不被裁切（边缘自动回退）；`Esc` 与点击空白都能关掉菜单。

---

## Task 5: 润色弹窗与「确认替换」

**Goal:** 弹窗完成左右对照、加载态、错误重试与精确替换，且不破坏撤销栈。

**Files:**
- Modify: `static/js/polish.js`、`templates/note_edit.html`（弹窗结构可静态写在模板里）、`static/css/style.css`

**Steps:**
- [x] 在 `templates/note_edit.html` 加入弹窗结构：

```html
<div class="modal-mask" id="polish-modal" hidden>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="polish-title">
    <h2 id="polish-title">AI 文本润色 <span class="badge" id="polish-badge" hidden>演示模式</span></h2>
    <div class="modal-cols">
      <section class="modal-col">
        <h3>原文</h3>
        <textarea id="polish-source" class="pane-readonly" readonly></textarea>
      </section>
      <section class="modal-col">
        <h3>润色结果</h3>
        <textarea id="polish-result" placeholder="润色中…"></textarea>
        <div class="polish-status" id="polish-status" hidden>
          <span class="spinner" aria-hidden="true"></span><span id="polish-status-text">润色中…</span>
          <button type="button" id="polish-retry" class="btn btn-ghost" hidden>重试</button>
        </div>
      </section>
    </div>
    <div class="modal-actions">
      <button type="button" id="polish-cancel" class="btn btn-ghost">取消</button>
      <button type="button" id="polish-confirm" class="btn btn-primary" disabled>确认替换</button>
    </div>
  </div>
</div>
```

- [x] 在 `static/js/polish.js` 实现 `openModal()`：

```js
function openModal() {          // 打开时立刻抓取选区快照，避免后续焦点变化导致选区丢失
  const sel = editor.getSelection();
  sourceEl.value = sel.text;
  resultEl.value = "";
  resultEl.placeholder = "润色中…";
  confirmBtn.disabled = true;
  showStatus("润色中…", { spinner: true, retry: false });
  modal.hidden = false;
  lastFocus = document.activeElement;
  resultEl.focus();
  trapFocus();
  requestPolish(sel.text);
}
async function requestPolish(text) {
  const r = await window.api.post("/api/ai/polish", { text });
  if (r.ok) {
    resultEl.value = r.data.polished;
    showStatus("", { hidden: true });
    confirmBtn.disabled = false;
  } else {
    showStatus(r.message, { spinner: false, retry: true });
    confirmBtn.disabled = true;      // 失败时不允许替换
  }
}
```

  - 「确认替换」→ `editor.replaceSelection(resultEl.value)` → `closeModal()` → `textarea.focus()`。
  - 「取消」→ 直接 `closeModal()`，**不触碰 textarea 一个字符**。
  - 「重试」→ `requestPolish(sourceEl.value)`。
  - 「演示模式」徽标：`Editor` 初始化后调用一次 `GET /api/ai/status`，`provider === "mock"` 时移除 `hidden`。
  - 焦点锁定 `trapFocus()`：`Tab`/`Shift+Tab` 在弹窗内可聚焦元素间循环；`Esc` → `closeModal()`；关闭后 `lastFocus.focus()`（工具栏按钮或 textarea）。
  - 点击 `.modal-mask`（事件目标即遮罩本身）→ `closeModal()`。

- [x] 加样式：`.modal-mask{position:fixed;inset:0;background:rgba(61,55,48,.35);display:flex;align-items:center;justify-content:center;z-index:200}`；`.modal{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);width:min(880px,92vw);max-height:86vh;overflow:auto;padding:var(--space-5)}`；`.modal-cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)}`；`.pane-readonly{background:var(--bg);color:var(--text-muted)}`；`#polish-result{border-color:var(--primary)}`；`.modal-actions{display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-5)}`；`.spinner` 为纯 CSS 旋转圈（在 `prefers-reduced-motion` 下改为静态文案）。

- [x] 移动端规则：`@media (max-width:767px){.modal-cols{grid-template-columns:1fr}.modal-actions{flex-direction:column}.modal-actions .btn{width:100%}}`。

- [x] Run: 划词选中「这是  一段,,需要润色的文字」→ 右键「AI 润色」
  - Expected: 弹窗打开，左侧显示原文，右侧先「润色中…」再出现结果；「确认替换」变为可点。

- [x] Run: 点「确认替换」后立刻按 `Ctrl+Z`
  - Expected: 文本回到替换前状态（证明撤销栈保留）；右侧预览同步刷新。

- [x] Run: 点「取消」后检查文本
  - Expected: 文本与预览完全不变。

- [x] Run: 把 `AI_PROVIDER` 改为 `openai` 且不配 Key，重启后再次润色
  - Expected: 弹窗右侧显示「AI 服务暂时不可用，请稍后重试」+「重试」按钮，「确认替换」保持禁用；关闭弹窗后文本未变。

- [x] Run: 键盘走查（Tab 进入工具栏 → Enter 打开弹窗 → Tab 循环不逃出弹窗 → Esc 关闭）
  - Expected: 焦点始终在弹窗内；关闭后焦点回到触发处。

**Visual Verification:** 1440 视口左右对照各 50%、按钮在右下；375 视口两栏上下堆叠、按钮全宽；弹窗内容不溢出视口（`max-height:86vh` 生效）。

**Security/Boundary Notes:** 右侧结果框是用户可编辑的普通 textarea，替换时**不经过 HTML 渲染**，避免注入；`replaceSelection` 直接写 `textarea.value` 片段。

---

## Phase Completion Checklist

- [x] 全部 5 个任务完成
- [x] `python tests/smoke_test.py` 第 1–8 组全部 `[OK]`
- [x] 无外网、无 API Key 状态下润色可完整演示（Mock）
- [x] 右键菜单、工具栏入口、取消、确认替换、Ctrl+Z 撤销、错误重试、Esc 关闭七项手工验证通过
- [x] 准备进入 Phase 6
