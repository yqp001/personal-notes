// 个人笔记 —— 详情页交互：渲染 Markdown、收藏切换、删除（二次确认）、错误态。
//
// 边界（spec Security / Components）：
//   - 正文是全站唯一渲染 HTML 的地方，必须经 window.md.render（markdown.js 内部已 DOMPurify 净化）；
//   - 标题、错误提示等一律用 textContent 赋值；
//   - 「分享」按钮在 Phase 4 接入分享面板，此处仅占位。

"use strict";

(function () {
  const titleEl = document.getElementById("note-title");
  if (!titleEl) return;

  const metaEl = document.getElementById("note-meta");
  const timeEl = document.getElementById("note-time");
  const bodyEl = document.getElementById("note-body");
  const actionsEl = document.getElementById("note-actions");
  const errorEl = document.getElementById("note-error");
  const backEl = document.getElementById("note-back");
  const favoriteBtn = document.getElementById("favorite-btn");
  const favoriteLabel = document.getElementById("favorite-label");
  const editBtn = document.getElementById("edit-btn");
  const deleteBtn = document.getElementById("delete-btn");
  const commentsEl = document.getElementById("comments");
  // 分享面板（Phase 4 任务 1）：生成 / 重新生成 / 取消分享链接
  const shareBtn = document.getElementById("share-btn");
  const sharePanel = document.getElementById("share-panel");
  const sharePassword = document.getElementById("share-password");
  const shareGenerate = document.getElementById("share-generate");
  const shareResult = document.getElementById("share-result");
  const shareUrl = document.getElementById("share-url");
  const shareCopy = document.getElementById("share-copy");
  const shareCancel = document.getElementById("share-cancel");
  const shareError = document.getElementById("share-error");

  const FAVORITE_ON = "已收藏";
  const FAVORITE_OFF = "收藏";
  const COPY_LABEL = "复制链接";
  const COPIED_LABEL = "链接已复制";
  const COPY_RESET_MS = 2000;

  let copyTimer = null;

  const matched = /^\/notes\/(\d+)\/?$/.exec(location.pathname);
  const noteId = matched ? Number(matched[1]) : null;

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN");
  }

  function setFavorite(on) {
    if (!favoriteBtn) return;
    favoriteBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) favoriteBtn.classList.add("is-favorited");
    else favoriteBtn.classList.remove("is-favorited");
    if (favoriteLabel) favoriteLabel.textContent = on ? FAVORITE_ON : FAVORITE_OFF;
  }

  function showFatal(message) {
    if (actionsEl) actionsEl.hidden = true;
    if (commentsEl) commentsEl.hidden = true;
    if (metaEl) metaEl.hidden = true;
    if (bodyEl) {
      bodyEl.hidden = true;
      bodyEl.textContent = "";
    }
    // 页面唯一的 <h1> 直接承载服务端 message（如「笔记不存在」）
    titleEl.textContent = message;
    if (backEl) backEl.hidden = false;
  }

  async function load() {
    const result = await window.api.get("/api/notes/" + noteId);
    if (!result.ok) {
      if (result.code === "AUTH_REQUIRED") {
        location.href = "/login";
        return;
      }
      showFatal(result.message);
      return;
    }

    const note = result.data.note || {};
    titleEl.textContent = note.title || "无标题";
    if (timeEl) timeEl.textContent = formatTime(note.updated_at);
    if (bodyEl) bodyEl.innerHTML = window.md.render(note.content_md || "");
    if (actionsEl) actionsEl.hidden = false;
    if (editBtn) editBtn.href = "/notes/" + noteId + "/edit";
    setFavorite(!!note.favorited);
  }

  async function toggleFavorite() {
    if (errorEl) window.api.clearError(errorEl);
    const result = await window.api.post("/api/notes/" + noteId + "/favorite", {});
    if (!result.ok) {
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    setFavorite(!!result.data.favorited);
  }

  async function removeNote() {
    if (!window.confirm("删除后无法恢复，确定要删除这篇笔记吗？")) return;
    if (errorEl) window.api.clearError(errorEl);
    const result = await window.api.del("/api/notes/" + noteId);
    if (!result.ok) {
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    location.href = "/notes";
  }

  // --- 分享面板 ---
  function toggleSharePanel() {
    if (!sharePanel) return;
    sharePanel.hidden = !sharePanel.hidden;
  }

  async function generateShare() {
    if (shareError) window.api.clearError(shareError);
    const password = sharePassword ? sharePassword.value : "";
    // 只发相对 url，前端用 location.origin 拼完整链接
    const result = await window.api.post("/api/notes/" + noteId + "/share", { password: password });
    if (!result.ok) {
      if (shareError) window.api.showError(shareError, result.message);
      return;
    }
    if (shareUrl) shareUrl.value = location.origin + result.data.url;
    if (shareResult) shareResult.hidden = false;
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    const link = shareUrl.value;
    let copied = false;
    // 优先异步剪贴板；不可用时回退到选中 + execCommand("copy")
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch (err) {
        copied = false;
      }
    }
    if (!copied && shareUrl.select) {
      shareUrl.select();
      if (document.execCommand) copied = document.execCommand("copy");
    }
    if (!copied || !shareCopy) return;
    shareCopy.textContent = COPIED_LABEL;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(function () {
      shareCopy.textContent = COPY_LABEL;
      copyTimer = null;
    }, COPY_RESET_MS);
  }

  async function cancelShare() {
    if (!window.confirm("取消后原链接将失效，确定吗？")) return;
    if (shareError) window.api.clearError(shareError);
    const result = await window.api.del("/api/notes/" + noteId + "/share");
    if (!result.ok) {
      if (shareError) window.api.showError(shareError, result.message);
      return;
    }
    if (shareResult) shareResult.hidden = true;
  }

  if (favoriteBtn) favoriteBtn.addEventListener("click", toggleFavorite);
  if (deleteBtn) deleteBtn.addEventListener("click", removeNote);
  if (shareBtn) shareBtn.addEventListener("click", toggleSharePanel);
  if (shareGenerate) shareGenerate.addEventListener("click", generateShare);
  if (shareCopy) shareCopy.addEventListener("click", copyShareUrl);
  if (shareCancel) shareCancel.addEventListener("click", cancelShare);

  if (noteId === null) showFatal("笔记不存在");
  else load();
})();
