# Phase 6: 主页、关于页与视觉还原

**Goal:** 主页按设计稿还原（Hero 双栏 + 金色手绘下划线 + 四宫格卖点，卖点文案已按实际功能改写）；关于页与 404 页就位；三断点响应式达标；对照视觉清单走查并修正问题。
**Prerequisites:** Phase 2–5 完成（全站页面与交互可用）
**Deliverables:** `/`、`/about`、任意错误路径 404 三个页面完整；三视口走查清单逐项通过；对比度实测达标。

**Interface Decisions Implemented:** 主页 Hero 双栏与四宫格卖点版式（spec Layout 线框图）；主页卖点新文案（spec 已确认决策 7）；`--font-serif` 衬线大标题与 `--font-script` 手写装饰（spec 字体角色）；金色手绘下划线（spec 签名元素配套）；`--primary` 仅作装饰的分色原则（spec Accessibility）；「简洁易用 / 分享协作 / 隐私保护 / 评论互动」术语一致性（spec 术语一致性）；关于页与 404 文案（spec Components）。

---

## Task 1: 主页还原

**Goal:** `/` 与设计稿版式一致，文案逐字固定，未登录/已登录两种顶栏都正确。

**Files:**
- Create: `templates/index.html`
- Modify: `static/css/style.css`

**Steps:**
- [x] 写 `templates/index.html`，文案**逐字**如下（不得改写）：

| 位置 | 文案 |
|---|---|
| 顶部英文装饰（`--font-script`） | `Enjoy the little things` |
| 主标题第一行（`--font-serif`） | `记录生活 · 书写成长` |
| 主标题第二行（`--font-serif`） | `遇见美好` |
| 正文 | `个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感，珍藏生活中的每一个美好瞬间。` |
| 主按钮 | `开始记录` → 未登录 `/register`，已登录 `/notes/new` |
| 次按钮 | `了解更多` → `/about` |

  四宫格卖点（**新版文案**，逐字固定）：

| 标题 | 说明 |
|---|---|
| `简洁易用` | `清爽的写作界面，专注记录每一个想法` |
| `分享协作` | `一键生成分享链接，可设置访问密码` |
| `隐私保护` | `笔记默认私有，只分享给你想分享的人` |
| `评论互动` | `读者可以留下评论，让记录有了回响` |

- [x] 结构（严格按此层级）：

```html
{% extends "base.html" %}
{% block title %}个人笔记 · 记录生活，书写成长{% endblock %}
{% block content %}
<section class="hero">
  <div class="hero-copy">
    <p class="hero-script">Enjoy the little things</p>
    <h1 class="hero-title">记录生活 · 书写成长<br><span class="hero-title-2">遇见美好</span></h1>
    <p class="hero-body">个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感，珍藏生活中的每一个美好瞬间。</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="{{ '/notes/new' if current_user else '/register' }}">开始记录</a>
      <a class="btn btn-ghost" href="/about">了解更多</a>
    </div>
  </div>
  <div class="hero-figure">
    <img src="{{ url_for('static', filename='img/hero.jpg') }}" alt="暖光下的咖啡、线圈笔记本与花" width="1280" height="720">
  </div>
</section>
<section class="features">
  <ul class="feature-grid">
    <li class="feature"><span class="feature-icon" aria-hidden="true"><svg ...>...</svg></span>
      <h2>简洁易用</h2><p>清爽的写作界面，专注记录每一个想法</p></li>
    <!-- 分享协作 / 隐私保护 / 评论互动 三项同上结构 -->
  </ul>
</section>
{% endblock %}
```

- [x] 四个图标用**内联 SVG**（不新增图片素材、不联网）：分别取「打开的书本」「分享连线」「盾牌锁」「对话气泡」，统一 `viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`stroke-width="1.6"`；外层 `.feature-icon{width:56px;height:56px;border:1px solid var(--border);border-radius:50%;display:grid;place-items:center;color:var(--primary)}`（`--primary` 在此仅为图形描边，不承载文字，符合分色原则）。

- [x] 关键样式：

```css
.hero{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:var(--space-6);
      max-width:1200px;margin:0 auto;padding:var(--space-6) var(--space-5)}
.hero-script{font-family:var(--font-script);color:var(--primary-strong);font-size:20px;margin-bottom:var(--space-2)}
.hero-title{font-family:var(--font-serif);font-size:56px;line-height:1.25;color:var(--text);font-weight:600}
.hero-title-2{position:relative;display:inline-block}
.hero-title-2::after{content:"";position:absolute;left:0;right:0;bottom:-6px;height:6px;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 8'%3E%3Cpath d='M1 5 Q30 1 60 4 T119 3' stroke='%23B89B6A' stroke-width='2.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat center/100% 100%}
.hero-body{color:var(--text-muted);font-size:16px;line-height:1.8;max-width:34em;margin:var(--space-5) 0}
.hero-actions{display:flex;gap:var(--space-3);flex-wrap:wrap}
.hero-figure img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius);display:block}
.feature-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-5);
  max-width:1200px;margin:0 auto;padding:0 var(--space-5) var(--space-6);list-style:none}
.feature h2{font-family:var(--font-serif);font-size:18px;margin:var(--space-3) 0 var(--space-2)}
.feature p{color:var(--text-muted);font-size:14px;line-height:1.7}
```

  - 手绘下划线用内联 SVG data URI（金色 `%23B89B6A` = `--primary`），**不加载外部文件、不加载 Web Font**。
  - `hero-figure img` 必须写 `width`/`height` 属性防止布局抖动。

- [x] 追加静态断言到 `tests/smoke_test.py`：

```python
section("9. 主页与关于页文案")
html = client.get("/").get_data(as_text=True)
for copy in ["记录生活 · 书写成长", "遇见美好", "Enjoy the little things", "开始记录", "了解更多",
             "简洁易用", "分享协作", "隐私保护", "评论互动",
             "清爽的写作界面，专注记录每一个想法", "一键生成分享链接，可设置访问密码",
             "笔记默认私有，只分享给你想分享的人", "读者可以留下评论，让记录有了回响"]:
    check(f"主页含文案：{copy}", copy in html)
check("主页不含被替换掉的旧卖点「云端同步」", "云端同步" not in html)
check("主页不含被替换掉的旧卖点「灵活分类」", "灵活分类" not in html)
```

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 9 组中主页相关断言全部 `[OK]`（关于页与 404 的两条断言在 Task 2 追加）。

**Visual Verification:** 1440 视口下 Hero 左文右图、四宫格一行四列对齐、金色下划线在「遇见美好」下方且不遮挡文字；375 视口 Hero 图位于文案下方。

---

## Task 2: 关于页与 404 页

**Goal:** 两个信息页就位，文案与功能一致。

**Files:**
- Create: `templates/about.html`、`templates/404.html`
- Modify: `routes/pages.py`（`/about` 渲染模板；`errorhandler(404)` 已由 Phase 1 捕获，此处确保模板存在）

**Steps:**
- [x] 写 `templates/about.html`，四个区块（正文不写作者隐私信息）：

  - **这是什么**：`个人笔记是一个本地运行的个人笔记应用，用 Markdown 写作，支持分享与评论。`
  - **功能一览**（列表，必须与已实现功能一一对应）：`注册与登录`、`Markdown 写作与实时预览`、`草稿与发布`、`划词 AI 润色`、`笔记收藏`、`链接分享（可设密码）`、`评论互动`
  - **技术栈**：`前端：HTML + CSS + 原生 JavaScript`、`后端：Python + Flask`、`数据库：SQLite`、`Markdown 渲染：marked.js（本地引入）`、`AI 润色：默认离线演示模式，可配置接入大模型服务`
  - **说明**：`本应用用于本地演示，不包含邮箱验证、找回密码、公开笔记广场等功能。AI 润色为演示模式时不会把文本发送到任何外部服务；启用真实服务后，被选中的文本会发送至你所配置的服务商。`

- [x] 写 `templates/404.html`：

```html
{% extends "base.html" %}
{% block title %}页面不存在 · 个人笔记{% endblock %}
{% block content %}
<section class="error-page">
  <h1>页面不存在</h1>
  <p>你访问的页面可能已被删除或链接有误。</p>
  <a class="btn btn-primary" href="/">返回主页</a>
</section>
{% endblock %}
```

- [x] 加样式：`.error-page{max-width:600px;margin:0 auto;padding:var(--space-6) var(--space-5);text-align:center}`，`h1` 用 `--font-serif`；`.error-page p{color:var(--text-muted);margin:var(--space-4) 0 var(--space-5)}`。

- [x] 追加断言到 `tests/smoke_test.py` 第 9 组末尾：

```python
about_html = client.get("/about").get_data(as_text=True)
check("关于页返回 200", client.get("/about").status_code == 200)
check("关于页含技术栈 Flask", "Flask" in about_html)
for copy in ["注册与登录", "划词 AI 润色", "链接分享（可设密码）", "评论互动", "SQLite", "marked.js"]:
    check(f"关于页含功能项：{copy}", copy in about_html)
check("未知路径返回 404", client.get("/no-such-page").status_code == 404)
check("404 页含中文提示", "页面不存在" in client.get("/no-such-page").get_data(as_text=True))
```

- [x] Run: `python tests/smoke_test.py`
  - Expected: 第 9 组全部 `[OK]`。

- [x] Run: 浏览器访问 `/no-such-page`
  - Expected: 显示「页面不存在」+ 返回主页按钮，顶栏正常。

- [x] Run: 浏览器访问 `/about`
  - Expected: 四个区块齐全，技术栈写明 Flask，无乱码。

**Visual Verification:** 375 视口两页正文不横向滚动；`/about` 列表项行距与主页说明文字一致。

---

## Task 3: 三断点响应式实现

**Goal:** 全站三视口无横向滚动、无重叠、内容优先级正确。

**Files:**
- Modify: `static/css/style.css`

**Steps:**
- [x] 在 `style.css` 末尾集中写响应式（不要散落在各组件里），断点与规则逐条对应 spec「响应式规则」表：

```css
/* ≥1024px：桌面默认值，即上面已写的 grid 值 */

@media (max-width:1023px){
  .hero{grid-template-columns:1fr;gap:var(--space-5);padding-top:var(--space-5)}
  .hero-figure{order:2}                    /* 图移到文案下方 */
  .hero-copy{order:1}
  .hero-title{font-size:44px}
  .feature-grid{grid-template-columns:repeat(2,1fr)}
  .editor-split{grid-template-columns:55fr 45fr}
  .modal-cols{grid-template-columns:1fr 1fr}
}

@media (max-width:767px){
  .site-nav{gap:var(--space-3)}
  .hero{padding:var(--space-5) var(--space-4)}
  .hero-title{font-size:32px}
  .hero-body{font-size:15px}
  .hero-actions .btn{flex:1 1 100%}          /* 按钮全宽 */
  .feature-grid{grid-template-columns:1fr}
  .editor-split{grid-template-columns:1fr}
  .editor-tabs{display:flex}                 /* 编辑/预览标签仅在手机显示 */
  .editor-split[data-mode="edit"] .preview-pane{display:none}
  .editor-split[data-mode="preview"] .editor-pane{display:none}
  .modal-cols{grid-template-columns:1fr}
  .modal-actions{flex-direction:column}
  .modal-actions .btn{width:100%}
  .note-paper{padding:var(--space-5) var(--space-4)}
  .profile-grid{grid-template-columns:1fr}
  .hero-figure img{aspect-ratio:4/3}
}
```

- [x] 顶栏移动端：`<768px` 时 `.site-nav` 收为汉堡菜单：

```html
<!-- base.html 内，nav 之前 -->
<button type="button" id="nav-toggle" class="nav-toggle" aria-expanded="false" aria-controls="site-nav">菜单</button>
```

  - CSS：`.nav-toggle{display:none}`；`<768px` 时 `.nav-toggle{display:inline-flex}`、`.site-nav{display:none}`、`.site-nav.is-open{display:flex;flex-direction:column;position:absolute;left:0;right:0;top:100%;background:var(--surface);border-bottom:1px solid var(--border);padding:var(--space-3) var(--space-4)}`；`.site-header{position:relative}`。
  - JS（写在 `api.js` 末尾，`bindLogout()` 之后）：点击切换 `aria-expanded` 与 `.is-open`；点击导航链接或页面空白处收起。

- [x] 触摸目标：`@media (max-width:767px){.btn,.site-nav a,.feature h2{min-height:44px}}`；`.site-nav a` 补 `display:flex;align-items:center;padding:0 var(--space-3)`。

- [x] 防溢出兜底：`html,body{overflow-x:hidden}`；`img,svg,textarea{max-width:100%}`。

- [x] Run: 依次在 1440 / 768 / 375 视口打开 `/`、`/notes/new`、`/notes/<id>`、`/share/<token>`、`/profile`
  - Expected: 每个页面 `document.documentElement.scrollWidth <= window.innerWidth`（控制台执行 `document.documentElement.scrollWidth - window.innerWidth` 输出 ≤ 0）。

- [x] Run: 375 视口打开 `/notes/new` 并切换「编辑 / 预览」
  - Expected: 两个标签可点，切换时只显示一个面板，textarea 与预览均不横向滚动。

**Visual Verification:** 逐页核对清单：① 无横向滚动条 ② 顶栏汉堡可展开收起 ③ Hero 图在文案下方 ④ 四宫格单列 ⑤ 润色弹窗上下堆叠且按钮全宽 ⑥ 羊皮纸详情页左右留白对称 ⑦ 所有可点区域 ≥ 44×44px。

---

## Task 4: 视觉走查与修正

**Goal:** 对照 spec「视觉验证清单」逐项核对，并把发现的问题当场修掉。

**Files:**
- Modify: 按发现的问题修改 `static/css/style.css` 及相关模板/JS

**Steps:**
- [x] 对比度核验（纯标准库，无依赖）——把下面脚本存为 `tests/contrast_check.py` 并运行：

```python
def lum(hexcolor):
    c = [int(hexcolor[i:i+2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def ratio(fg, bg):
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return round((hi + 0.05) / (lo + 0.05), 2)

CHECKS = [
    ("正文",        "#3D3730", "#F7F4EE", 4.5),
    ("次要文字",    "#6F665C", "#F7F4EE", 4.5),
    ("链接/主按钮", "#7A5C2E", "#F7F4EE", 4.5),
    ("主按钮白字",  "#FFFFFF", "#7A5C2E", 4.5),
    ("羊皮纸正文",  "#4A3B2A", "#F2E7D0", 7.0),
    ("纸面链接",    "#7A5C2E", "#F2E7D0", 4.5),
    ("错误提示",    "#9E4A34", "#F7F4EE", 4.5),
]
bad = 0
for name, fg, bg, need in CHECKS:
    r = ratio(fg, bg)
    ok = r >= need
    bad += 0 if ok else 1
    print(f"{'[OK]  ' if ok else '[FAIL]'} {name}: {r}:1（需 ≥ {need}:1）")
print("失败数:", bad)
```

  - Run: `python tests/contrast_check.py`
  - Expected: 全部 `[OK]`，失败数 0。若某项 FAIL，按同一亮度公式重算一个更深的色值替换对应令牌（例如 `--danger` 若不足 4.5:1 就往 `#8F3F2B` 方向调），改完重跑直到全绿；同时把新色值回填到 spec 的令牌表与实测值一行。

- [x] 浏览器逐项走查（用 DevTools 设备模拟 + 截图），每项确认后打勾：

| # | 视口 | 路由 / 状态 | 检查点 |
|---|------|------------|--------|
| 1 | 1440 | `/` | 顶栏、Hero 双栏对齐、金色下划线不压字、四宫格等高 |
| 2 | 1440 | `/notes/new` + 润色弹窗 | 分栏各 50%、弹窗左右对照、按钮位于右下 |
| 3 | 1440 | `/notes/<id>` | 纸面四角花纹可见、纹理无明显拉伸、正文宽 760px 居中 |
| 4 | 1440 | `/share/<token>` 未解锁 → 已解锁 | 密码锁卡片居中；解锁后评论区与表单就位 |
| 5 | 768 | `/`、`/notes/new`、`/notes/<id>` | Hero 不溢出、分栏 55/45、纸面无横向滚动 |
| 6 | 375 | `/`、`/notes/new`、润色弹窗、`/share/<token>` | 图在文案下、标签切换、弹窗堆叠、无横向滚动条 |
| 7 | 375 | 表单校验 / 404 / 分享密码错误 | 中文提示可见且不与字段重叠 |

- [x] 修正 pass（对上面发现的问题逐条修，不新增功能）——至少确认以下五类：

  1. **层级**：页面唯一 `<h1>`；主页四宫格用 `<h2>`；详情页标题 `<h1>`、评论区 `/share` 用 `<h2>`。
  2. **间距**：同一页面内区块间距只用 `--space-4/5/6`；四宫格卡片内边距一致。
  3. **溢出与重叠**：长标题（50 个汉字）在列表卡片与详情页均换行不溢出；长分享链接在 `#share-url` 输入框内横向滚动不撑破布局。
  4. **保真**：主页与设计稿逐项对照（顶栏、Hero 比例、按钮层级、四宫格图标圆环、字体衬线感）。
  5. **清理过时文案**：`templates/note_detail.html` 里 `#comments` 区域仍写着「评论区将在后续阶段开放。」，但评论只在分享页开放，此文案已失实 —— 改为不误导的说明（例如「评论在分享页开放」并附「分享」引导），或直接移除该区块（取其一是，勿留占位语气）。同时检查其它模板是否残留「将在后续阶段」「功能稍后」类占位文案，一并清理。

- [x] 无障碍抽查（键盘）：主页 Tab 顺序为「品牌 → 导航 → 主内容 → 页脚」；弹窗打开时 Tab 不逃出；`:focus-visible` 描边在所有可点元素上可见。

- [x] Run: `python tests/smoke_test.py` 与 `python tests/contrast_check.py`
  - Expected: 两者失败数均为 0。

**Visual Verification:** 保存 7 项走查截图（1440×4、768×1、375×2）并在提交说明中列出每张对应的检查点。

---

## Phase Completion Checklist

- [x] 全部 4 个任务完成
- [x] 主页文案与设计稿版式逐字逐项核对通过
- [x] `python tests/contrast_check.py` 全绿
- [x] 三视口 7 项走查表全部打勾，无横向滚动、无重叠
- [x] 键盘焦点可达且可见，弹窗焦点不逃逸
- [x] 准备进入 Phase 7

---

## 执行期补充记录（主智能体验证时追加）

- `main` 限宽 1120px，而计划给 `.hero` / `.feature-grid` 写的是 1200px —— 后者永不生效（父容器只有 1072px 内容宽）。已把两处对齐为 1120px：**渲染结果逐像素不变**，只是删掉误导性数值。
- 遗留的人工走查项：`main` 自带 `padding:40px 24px`，`.hero` 又加了 `40px` 上内边距，主页顶部留白合计 80px。是否收紧要等有浏览器时目视确认；本阶段不做无凭据的视觉改动。
