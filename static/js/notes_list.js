// 个人笔记 —— 笔记列表页交互：三态筛选、卡片渲染、三态空状态。
//
// 约定：所有请求走 window.api；失败只展示后端 message；
// 列表项的标题与摘要一律用 textContent 赋值，禁止用 innerHTML 拼接（防注入）。

"use strict";

(function () {
  const listEl = document.getElementById("notes-list");
  if (!listEl) return;

  const errorEl = document.getElementById("notes-error");
  const emptyEl = document.getElementById("notes-empty");
  const emptyText = document.getElementById("notes-empty-text");
  const emptyAction = document.getElementById("notes-empty-action");
  const filterButtons = Array.prototype.slice.call(
    document.querySelectorAll(".filter-bar button")
  );

  const EMPTY_COPY = {
    all: "还没有笔记，写下第一条吧",
    draft: "草稿箱是空的",
    published: "还没有发布的笔记",
  };
  const STATUS_LABEL = { draft: "草稿", published: "已发布" };

  let status = "all";

  function setActive(value) {
    filterButtons.forEach(function (button) {
      if (button.getAttribute("data-status") === value) button.classList.add("is-active");
      else button.classList.remove("is-active");
    });
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN");
  }

  function renderItem(note) {
    const item = document.createElement("li");
    item.className = "note-card";

    const title = document.createElement("a");
    title.className = "note-card-title";
    title.href = "/notes/" + note.id;
    title.textContent = note.title || "无标题";

    const badge = document.createElement("span");
    badge.className = "note-badge note-badge-" + note.status;
    badge.textContent = STATUS_LABEL[note.status] || note.status;

    const time = document.createElement("time");
    time.className = "note-card-time";
    time.textContent = formatTime(note.updated_at);

    const excerpt = document.createElement("p");
    excerpt.className = "note-card-excerpt";
    excerpt.textContent = note.excerpt || "";

    const actions = document.createElement("p");
    actions.className = "note-card-actions";

    const edit = document.createElement("a");
    edit.className = "btn btn-ghost";
    edit.href = "/notes/" + note.id + "/edit";
    edit.textContent = "编辑";

    const view = document.createElement("a");
    view.className = "btn btn-ghost";
    view.href = "/notes/" + note.id;
    view.textContent = "查看";

    actions.appendChild(edit);
    actions.appendChild(view);

    item.appendChild(title);
    item.appendChild(badge);
    item.appendChild(time);
    item.appendChild(excerpt);
    item.appendChild(actions);
    return item;
  }

  function render(notes) {
    listEl.textContent = "";
    if (!notes.length) {
      listEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (emptyText) emptyText.textContent = EMPTY_COPY[status] || EMPTY_COPY.all;
      // 只有「全部」空态才给「写笔记」入口，草稿/已发布空态只给文案
      if (emptyAction) emptyAction.hidden = status !== "all";
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.hidden = false;
    notes.forEach(function (note) {
      listEl.appendChild(renderItem(note));
    });
  }

  async function load() {
    if (errorEl) window.api.clearError(errorEl);
    const result = await window.api.get("/api/notes?status=" + status);
    if (!result.ok) {
      if (result.code === "AUTH_REQUIRED") {
        location.href = "/login";
        return;
      }
      if (errorEl) window.api.showError(errorEl, result.message);
      return;
    }
    render((result.data && result.data.notes) || []);
  }

  filterButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      status = button.getAttribute("data-status");
      setActive(status);
      load();
    });
  });

  setActive(status);
  load();
})();
