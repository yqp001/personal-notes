// 个人笔记 —— 写笔记页交互：登录守卫、编辑回填、保存草稿 / 发布、移动端标签切换。
//
// 约定：所有请求走 window.api；失败只展示后端 message；
// 文本读写一律通过 window.Editor，不直接操作 textarea 的选区。

"use strict";

(function () {
  const split = document.querySelector(".editor-split");
  const textarea = document.getElementById("content");
  const preview = document.getElementById("preview");
  if (!split || !textarea || !preview) return;

  const titleInput = document.getElementById("title");
  const errorEl = document.getElementById("editor-error");
  const noticeEl = document.getElementById("editor-notice");
  const draftBtn = document.getElementById("save-draft");
  const publishBtn = document.getElementById("publish");
  const backList = document.getElementById("editor-back-list");
  const tabs = Array.prototype.slice.call(document.querySelectorAll(".editor-tabs button"));

  const NOTICE_MS = 2000;
  const BUSY_LABEL = "保存中…";

  const matched = /^\/notes\/(\d+)\/edit$/.exec(location.pathname);
  let noteId = matched ? Number(matched[1]) : null;
  let noticeTimer = null;

  window.Editor.init(textarea, preview);
  // AI 润色入口（右键菜单 + 工具栏按钮）：必须在 Editor 初始化之后绑定，
  // 因为 polish.js 依赖 Editor 的选区接口；polish.js 未加载时静默跳过。
  if (window.Polish) window.Polish.bind(textarea);

  // --- 移动端「编辑 / 预览」标签（每次进入默认「编辑」，不记忆） ---
  function setMode(mode) {
    split.setAttribute("data-mode", mode);
    tabs.forEach(function (btn) {
      if (btn.getAttribute("data-mode") === mode) btn.classList.add("is-active");
      else btn.classList.remove("is-active");
    });
  }

  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setMode(btn.getAttribute("data-mode"));
    });
  });
  setMode("edit");

  // --- 提示 ---
  function showNotice(text) {
    if (!noticeEl) return;
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(function () {
      noticeEl.textContent = "";
      noticeEl.hidden = true;
      noticeTimer = null;
    }, NOTICE_MS);
  }

  function showFatal(message) {
    split.hidden = true;
    if (backList) backList.hidden = false;
    if (errorEl) window.api.showError(errorEl, message);
  }

  // --- 登录守卫 + 回填 ---
  async function guard() {
    const result = await window.api.get("/api/auth/me");
    if (!result.ok || !result.data || !result.data.user) {
      location.href = "/login";
      return false;
    }
    return true;
  }

  async function load() {
    if (noteId === null) return;
    const result = await window.api.get("/api/notes/" + noteId);
    if (!result.ok) {
      showFatal(result.message);
      return;
    }
    const note = result.data.note || {};
    if (titleInput) titleInput.value = note.title || "";
    window.Editor.setValue(note.content_md || "");
    window.Editor.refresh();
    setMode("edit");
  }

  // --- 保存 / 发布 ---
  async function save(status) {
    if (errorEl) window.api.clearError(errorEl);

    if (status === "published" && titleInput && !titleInput.value.trim()) {
      if (errorEl) window.api.showError(errorEl, "请填写笔记标题");
      return;
    }

    const payload = {
      title: titleInput ? titleInput.value : "",
      content_md: window.Editor.getValue(),
      status: status,
    };

    const btn = status === "draft" ? draftBtn : publishBtn;
    const idleLabel = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = BUSY_LABEL;
    }

    const result = noteId === null
      ? await window.api.post("/api/notes", payload)
      : await window.api.put("/api/notes/" + noteId, payload);

    if (btn) {
      btn.disabled = false;
      btn.textContent = idleLabel;
    }

    if (!result.ok) {
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }

    const savedId = (result.data && result.data.id) || noteId;

    if (status === "draft") {
      if (noteId === null && savedId) {
        // 新建成功后换成编辑地址，避免重复新建
        noteId = savedId;
        history.replaceState(null, "", "/notes/" + savedId + "/edit");
      }
      showNotice("已保存草稿");
      return;
    }

    location.href = "/notes/" + savedId;
  }

  if (draftBtn) draftBtn.addEventListener("click", function () { save("draft"); });
  if (publishBtn) publishBtn.addEventListener("click", function () { save("published"); });

  (async function () {
    if (!(await guard())) return;
    await load();
  })();
})();
