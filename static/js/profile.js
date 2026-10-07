// 个人笔记 —— 个人主页交互：加载时回填、保存时就地提示。
//
// 约定：所有请求走 window.api；失败只展示后端 message；成功提示「已保存」2 秒后消失。
// 不使用 innerHTML 回填任何内容。

"use strict";

(function () {
  const form = document.querySelector("form[data-profile-form]");
  if (!form) return;

  const errorEl = form.querySelector("[data-error]");
  const noticeEl = form.querySelector("[data-notice]");
  const submitBtn = form.querySelector('button[type="submit"]');
  const idleLabel = submitBtn ? submitBtn.textContent : "";
  const NOTICE_MS = 2000;

  let noticeTimer = null;

  function showNotice(text) {
    if (!noticeEl) return;
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    if (noticeTimer !== null) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      noticeEl.textContent = "";
      noticeEl.hidden = true;
      noticeTimer = null;
    }, NOTICE_MS);
  }

  function fill(user) {
    if (!user) return;
    if (form.elements.username) form.elements.username.value = user.username || "";
    if (form.elements.bio) form.elements.bio.value = user.bio || "";
  }

  async function loadCurrentUser() {
    const result = await window.api.get("/api/auth/me");
    if (result.ok) fill(result.data && result.data.user);
  }

  // --- 我的收藏 ---
  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN");
  }

  function renderFavorites(listEl, emptyEl, notes) {
    listEl.textContent = "";
    if (!notes.length) {
      listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    notes.forEach(function (note) {
      const item = document.createElement("li");
      item.className = "link-item";

      const title = document.createElement("a");
      title.className = "link-title";
      title.href = "/notes/" + note.id;
      title.textContent = note.title || "无标题";

      const time = document.createElement("time");
      time.className = "link-time";
      time.textContent = formatTime(note.updated_at);

      item.appendChild(title);
      item.appendChild(time);
      listEl.appendChild(item);
    });
  }

  async function loadFavorites() {
    const listEl = document.getElementById("favorites-list");
    if (!listEl) return;
    const emptyEl = document.getElementById("favorites-empty");
    const result = await window.api.get("/api/favorites");
    if (!result.ok) {
      if (result.code === "AUTH_REQUIRED") {
        location.href = "/login";
        return;
      }
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    renderFavorites(listEl, emptyEl, (result.data && result.data.notes) || []);
  }

  // --- 我的笔记 ---
  const STATUS_LABEL = { draft: "草稿", published: "已发布" };

  function renderNotes(listEl, emptyEl, notes) {
    listEl.textContent = "";
    if (!notes.length) {
      listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    notes.forEach(function (note) {
      const item = document.createElement("li");
      item.className = "link-item";

      const title = document.createElement("a");
      title.className = "link-title";
      title.href = "/notes/" + note.id;
      title.textContent = note.title || "无标题";

      const badge = document.createElement("span");
      badge.className = "note-badge note-badge-" + note.status;
      badge.textContent = STATUS_LABEL[note.status] || note.status;

      const time = document.createElement("time");
      time.className = "link-time";
      time.textContent = formatTime(note.updated_at);

      const actions = document.createElement("span");
      actions.className = "link-actions";

      const view = document.createElement("a");
      view.className = "btn btn-ghost";
      view.href = "/notes/" + note.id;
      view.textContent = "查看";

      const edit = document.createElement("a");
      edit.className = "btn btn-ghost";
      edit.href = "/notes/" + note.id + "/edit";
      edit.textContent = "编辑";

      actions.appendChild(view);
      actions.appendChild(edit);

      item.appendChild(title);
      item.appendChild(badge);
      item.appendChild(time);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }

  async function loadNotes() {
    const listEl = document.getElementById("my-notes-list");
    if (!listEl) return;
    const emptyEl = document.getElementById("my-notes-empty");
    const result = await window.api.get("/api/notes?status=all");
    if (!result.ok) {
      if (result.code === "AUTH_REQUIRED") {
        location.href = "/login";
        return;
      }
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    renderNotes(listEl, emptyEl, (result.data && result.data.notes) || []);
  }

  // --- 分享管理 ---
  let shareItems = [];

  function copyShareLink(button, url) {
    if (!button) return;
    const link = location.origin + url;
    const done = function () {
      button.textContent = "链接已复制";
      window.setTimeout(function () {
        button.textContent = "复制链接";
      }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, done);
      return;
    }
    done();
  }

  async function cancelShare(noteId) {
    if (errorEl) window.api.clearError(errorEl);
    const result = await window.api.del("/api/notes/" + noteId + "/share");
    if (!result.ok) {
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    shareItems = shareItems.filter(function (share) {
      return share.note_id !== noteId;
    });
    const listEl = document.getElementById("shares-list");
    const emptyEl = document.getElementById("shares-empty");
    if (listEl) renderShares(listEl, emptyEl, shareItems);
  }

  function renderShares(listEl, emptyEl, shares) {
    listEl.textContent = "";
    if (!shares.length) {
      listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    shares.forEach(function (share) {
      const item = document.createElement("li");
      item.className = "link-item";

      const title = document.createElement("a");
      title.className = "link-title";
      title.href = "/notes/" + share.note_id;
      title.textContent = share.note_title || "无标题";

      const badge = document.createElement("span");
      badge.className = "note-badge";
      badge.textContent = share.has_password ? "需要密码" : "无需密码";

      const time = document.createElement("time");
      time.className = "link-time";
      time.textContent = formatTime(share.created_at);

      const actions = document.createElement("span");
      actions.className = "link-actions";

      const open = document.createElement("a");
      open.className = "btn btn-ghost";
      open.href = share.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "打开";

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn btn-ghost";
      copy.textContent = "复制链接";
      copy.addEventListener("click", function () {
        copyShareLink(copy, share.url);
      });

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-ghost";
      cancel.textContent = "取消分享";
      cancel.addEventListener("click", function () {
        cancelShare(share.note_id);
      });

      actions.appendChild(open);
      actions.appendChild(copy);
      actions.appendChild(cancel);

      item.appendChild(title);
      item.appendChild(badge);
      item.appendChild(time);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }

  async function loadShares() {
    const listEl = document.getElementById("shares-list");
    if (!listEl) return;
    const emptyEl = document.getElementById("shares-empty");
    const result = await window.api.get("/api/share/mine");
    if (!result.ok) {
      if (result.code === "AUTH_REQUIRED") {
        location.href = "/login";
        return;
      }
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    shareItems = (result.data && result.data.shares) || [];
    renderShares(listEl, emptyEl, shareItems);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (errorEl) window.api.clearError(errorEl);

    const payload = {
      username: String(form.elements.username ? form.elements.username.value : "").trim(),
      bio: form.elements.bio ? form.elements.bio.value : "",
    };

    // 与服务端一致的前端预校验（文案与 core/codes.py 的 MESSAGES 逐字一致）
    if (!payload.username) {
      if (errorEl) window.api.showError(errorEl, "请输入用户名");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "保存中…";
    }

    const result = await window.api.put("/api/profile", payload);

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = idleLabel;
    }
    if (result.ok) {
      showNotice("已保存");
      return;
    }
    if (errorEl) window.api.showError(errorEl, result.message);
  });

  loadCurrentUser();
  loadFavorites();
  loadNotes();
  loadShares();
})();
