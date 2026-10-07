// 个人笔记 —— 分享页交互：密码解锁、内容渲染、评论列表与提交。
//
// 边界（spec Security / Components）：
//   - 正文是全站唯一渲染 HTML 的地方，必须经 window.md.render（markdown.js 内部已净化）；
//   - 昵称、评论内容、标题、作者等一律用 textContent 赋值，绝不用 innerHTML；
//   - 错误提示统一取后端 message；密码错误时就地提示且**不清空**输入框；
//   - 评论提交失败就地展示 message，成功则清空内容框、重新拉取并滚动到新评论。

"use strict";

(function () {
  const lockEl = document.getElementById("share-lock");
  if (!lockEl) return; // 仅在分享页运行

  const contentEl = document.getElementById("share-content");
  const commentsEl = document.getElementById("share-comments");
  const invalidEl = document.getElementById("share-invalid");
  const titleEl = document.getElementById("share-title");
  const authorEl = document.getElementById("share-author");
  const timeEl = document.getElementById("share-time");
  const bodyEl = document.getElementById("share-body");
  const unlockInput = document.getElementById("unlock-password");
  const unlockBtn = document.getElementById("unlock-btn");
  const unlockErrorEl = document.getElementById("unlock-error");
  const commentListEl = document.getElementById("comment-list");
  const commentEmptyEl = document.getElementById("comment-empty");
  const commentForm = document.getElementById("comment-form");
  const nicknameField = document.getElementById("nickname-field");
  const nicknameInput = document.getElementById("nickname");
  const contentInput = document.getElementById("comment-content");
  const commentErrorEl = document.getElementById("comment-error");
  const submitBtn = commentForm ? commentForm.querySelector('button[type="submit"]') : null;
  const submitLabel = submitBtn ? submitBtn.textContent : "发表评论";

  const TOKEN = location.pathname.split("/").pop();

  // 已登录时评论区隐藏昵称字段，提交的 nickname 传空串（由后端取用户名）
  let loggedIn = false;

  function shareUrl(suffix) {
    return "/api/share/" + encodeURIComponent(TOKEN) + (suffix || "");
  }

  function setVisible(map) {
    const nodes = {
      lock: lockEl,
      content: contentEl,
      comments: commentsEl,
      invalid: invalidEl,
    };
    Object.keys(nodes).forEach(function (key) {
      if (nodes[key]) nodes[key].hidden = !map[key];
    });
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN");
  }

  function renderComments(comments) {
    if (!commentListEl) return;
    commentListEl.textContent = "";
    if (!comments.length) {
      if (commentEmptyEl) commentEmptyEl.hidden = false;
      return;
    }
    if (commentEmptyEl) commentEmptyEl.hidden = true;
    comments.forEach(function (comment) {
      const item = document.createElement("li");
      item.className = "comment-item";

      const name = document.createElement("strong");
      name.textContent = comment.nickname || "匿名";

      const time = document.createElement("time");
      time.textContent = formatTime(comment.created_at);

      const text = document.createElement("p");
      text.textContent = comment.content || "";

      item.appendChild(name);
      item.appendChild(time);
      item.appendChild(text);
      commentListEl.appendChild(item);
    });
  }

  async function loadComments() {
    const result = await window.api.get(shareUrl("/comments"));
    if (!result.ok) {
      // 加锁分享在未解锁时，评论接口也会拒绝
      if (result.code === "SHARE_PASSWORD_REQUIRED") {
        setVisible({ lock: true });
        return;
      }
      if (commentErrorEl) window.api.showError(commentErrorEl, result.message);
      return;
    }
    renderComments((result.data && result.data.comments) || []);
  }

  async function loadShare() {
    const result = await window.api.get(shareUrl(""));
    if (result.code === "SHARE_PASSWORD_REQUIRED") {
      setVisible({ lock: true });
      return;
    }
    if (result.code === "SHARE_NOT_FOUND") {
      setVisible({ invalid: true });
      return;
    }
    if (!result.ok) {
      setVisible({ invalid: true });
      return;
    }
    const note = (result.data && result.data.note) || {};
    if (titleEl) titleEl.textContent = note.title || "无标题";
    if (authorEl) authorEl.textContent = note.author_username || "";
    if (timeEl) timeEl.textContent = formatTime(note.updated_at);
    if (bodyEl) bodyEl.innerHTML = window.md.render(note.content_md || "");
    setVisible({ content: true, comments: true });
    await loadComments();
  }

  async function loadViewer() {
    const result = await window.api.get("/api/auth/me");
    if (result.ok && result.data && result.data.user) {
      loggedIn = true;
      if (nicknameField) nicknameField.hidden = true;
    }
  }

  async function unlock() {
    if (unlockErrorEl) window.api.clearError(unlockErrorEl);
    if (unlockBtn) unlockBtn.disabled = true;
    const password = unlockInput ? unlockInput.value : "";
    const result = await window.api.post(shareUrl("/unlock"), { password: password });
    if (unlockBtn) unlockBtn.disabled = false;
    if (!result.ok) {
      // 失败：就地提示、保留输入框内容、按钮恢复可点
      if (unlockErrorEl) window.api.showError(unlockErrorEl, result.message);
      return;
    }
    await loadShare();
  }

  async function submitComment(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (commentErrorEl) window.api.clearError(commentErrorEl);

    const payload = {
      nickname: loggedIn ? "" : nicknameInput ? nicknameInput.value : "",
      content: contentInput ? contentInput.value : "",
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "发表中…";
    }
    const result = await window.api.post(shareUrl("/comments"), payload);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
    }
    if (!result.ok) {
      if (commentErrorEl) window.api.showError(commentErrorEl, result.message);
      return;
    }
    if (contentInput) contentInput.value = "";
    await loadComments();
    const last = commentListEl ? commentListEl.lastElementChild : null;
    if (last && last.scrollIntoView) last.scrollIntoView({ block: "start" });
  }

  if (unlockBtn) unlockBtn.addEventListener("click", unlock);
  if (commentForm) commentForm.addEventListener("submit", submitComment);

  async function init() {
    await loadViewer();
    await loadShare();
  }

  init();
})();
