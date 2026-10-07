// 个人笔记 —— AI 润色前端：右键菜单、工具栏键盘等价入口、左右对照弹窗与精确替换。
//
// 边界（spec Components / Data Flow §1）：
//   - 只经 window.api 发请求；失败只展示后端 message，绝不把空串写回文本域；
//   - 文本读写一律经 window.Editor 的选区接口（replaceSelection 保留撤销栈），
//     本模块不直接操作 textarea 的结构，也不做 HTML 渲染（替换结果不经过 innerHTML）；
//   - 菜单与弹窗结构静态写在模板里，本模块只切换 hidden / 位置 / 文案。

"use strict";

window.Polish = (function () {
  const MENU_MARGIN = 8;                       // 菜单与视口边缘的最小间距
  const EMPTY_HINT = "请先选中需要润色的文本";   // 与 codes.AI_EMPTY_TEXT 逐字一致
  const LOADING_TEXT = "润色中…";
  const DIALOG_ID = "polish-modal";

  let editor = null;
  let textarea = null;
  let menu = null;
  let menuItem = null;
  let modal = null;
  let sourceEl = null;
  let resultEl = null;
  let statusEl = null;
  let statusTextEl = null;
  let spinnerEl = null;
  let retryBtn = null;
  let cancelBtn = null;
  let confirmBtn = null;
  let badgeEl = null;
  let errorEl = null;
  let lastFocus = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function hasSelection() {
    const sel = editor.getSelection();
    return !!(sel && sel.text && sel.text.trim());
  }

  function showMenu(x, y) {
    if (!menu) return;
    menu.hidden = false;
    // 边缘回退：菜单不得超出视口
    const maxLeft = Math.max(0, (window.innerWidth || 0) - (menu.offsetWidth || 0) - MENU_MARGIN);
    const maxTop = Math.max(0, (window.innerHeight || 0) - (menu.offsetHeight || 0) - MENU_MARGIN);
    menu.style.left = Math.min(x, maxLeft) + "px";
    menu.style.top = Math.min(y, maxTop) + "px";
  }

  function hideMenu() {
    if (menu) menu.hidden = true;
  }

  function showStatus(text, options) {
    const opts = options || {};
    if (statusEl) {
      statusEl.hidden = !!opts.hidden;
      // 错误态即「重试」可见态：用 --danger 让错误与加载态在视觉上可区分
      statusEl.classList.toggle("is-error", !!opts.retry);
    }
    if (statusTextEl) statusTextEl.textContent = text;
    if (spinnerEl) spinnerEl.hidden = !opts.spinner;
    if (retryBtn) retryBtn.hidden = !opts.retry;
  }

  // 弹窗内可聚焦元素（顺序与 DOM 顺序一致）；禁用/隐藏的控件不参与循环
  function focusables() {
    return [sourceEl, resultEl, retryBtn, cancelBtn, confirmBtn].filter(function (el) {
      return !!el && !el.disabled && !el.hidden;
    });
  }

  function trapFocus(event) {
    const list = focusables();
    if (!list.length) return;
    if (event.preventDefault) event.preventDefault();
    const step = event.shiftKey ? -1 : 1;
    const current = list.indexOf(document.activeElement);
    const start = current === -1 ? (step === 1 ? -1 : 0) : current;
    const target = list[(start + step + list.length) % list.length];
    if (target && target.focus) target.focus();
  }

  function isOpen() {
    return !!modal && !modal.hidden;
  }

  function openModal() {
    // 打开时立刻抓取选区快照：之后焦点/选区的变化都不再影响本次润色
    const sel = editor.getSelection();
    if (sourceEl) sourceEl.value = sel.text;
    if (resultEl) {
      resultEl.value = "";
      resultEl.placeholder = LOADING_TEXT;
    }
    if (confirmBtn) confirmBtn.disabled = true;
    showStatus(LOADING_TEXT, { spinner: true, retry: false });
    if (modal) modal.hidden = false;
    lastFocus = document.activeElement;
    if (resultEl && resultEl.focus) resultEl.focus();
    requestPolish(sel.text);
  }

  function closeModal() {
    if (modal) modal.hidden = true;
    const target = lastFocus;
    lastFocus = null;
    if (target && target.focus) target.focus();   // 焦点回到触发元素
  }

  async function requestPolish(text) {
    const result = await window.api.post("/api/ai/polish", { text: text });
    if (result.ok) {
      if (resultEl) resultEl.value = (result.data && result.data.polished) || "";
      showStatus("", { hidden: true });
      if (confirmBtn) confirmBtn.disabled = false;
      return;
    }
    // 失败：展示后端 message + 「重试」，保持「确认替换」禁用；
    // 右栏保持原样（绝不把空串写回文本域），正文零改动
    showStatus(result.message, { spinner: false, retry: true });
    if (confirmBtn) confirmBtn.disabled = true;
  }

  async function refreshProviderStatus() {
    if (!badgeEl) return;
    const result = await window.api.get("/api/ai/status");
    if (result.ok && result.data && result.data.provider === "mock") {
      badgeEl.hidden = false;   // Mock 模式：标题旁提示「演示模式」
    }
  }

  function bind(textareaEl) {
    textarea = textareaEl || null;
    editor = window.Editor;
    if (!textarea || !editor) return;

    menu = byId("ctx-menu");
    menuItem = byId("ctx-item");
    modal = byId(DIALOG_ID);
    sourceEl = byId("polish-source");
    resultEl = byId("polish-result");
    statusEl = byId("polish-status");
    statusTextEl = byId("polish-status-text");
    spinnerEl = byId("polish-spinner");
    retryBtn = byId("polish-retry");
    cancelBtn = byId("polish-cancel");
    confirmBtn = byId("polish-confirm");
    badgeEl = byId("polish-badge");
    errorEl = byId("editor-error");

    // 划词右键：仅当选区非空时才出现自定义菜单，否则保留浏览器原生菜单
    textarea.addEventListener("contextmenu", function (event) {
      if (!hasSelection()) {
        hideMenu();
        return;
      }
      if (event.preventDefault) event.preventDefault();
      showMenu(event.clientX, event.clientY);
    });

    document.addEventListener("click", function () { hideMenu(); });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hideMenu();
        if (isOpen()) closeModal();
        return;
      }
      if (event.key === "Tab" && isOpen()) trapFocus(event);
    });

    // 键盘等价入口：工具栏的「AI 润色」按钮
    const entryBtn = byId("ai-polish-btn");
    if (entryBtn) {
      entryBtn.addEventListener("click", function () {
        if (!hasSelection()) {
          window.api.showError(errorEl, EMPTY_HINT);
          return;
        }
        openModal();
      });
    }

    if (menuItem) {
      menuItem.addEventListener("click", function () {
        hideMenu();     // 先关菜单，避免菜单压在弹窗上
        openModal();
      });
    }

    if (cancelBtn) cancelBtn.addEventListener("click", function () { closeModal(); });

    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        editor.replaceSelection(resultEl ? resultEl.value : "");   // 保留撤销栈
        closeModal();
        if (textarea.focus) textarea.focus();
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        showStatus(LOADING_TEXT, { spinner: true, retry: false });
        if (confirmBtn) confirmBtn.disabled = true;
        requestPolish(sourceEl ? sourceEl.value : "");
      });
    }

    if (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeModal();   // 点击遮罩本身即关闭
      });
    }

    // Editor 初始化后查询一次 provider 状态，决定是否显示「演示模式」徽标
    refreshProviderStatus();
  }

  return { bind: bind };
})();
