// 个人笔记 —— 编辑区：文本域选区读写、预览刷新（防抖）、写入替换。
//
// 边界（spec Components / Data Flow）：
//   - 本模块只负责「文本域 ↔ 预览」的读写与替换，不处理任何网络请求；
//   - 预览内容一律经 window.md.render（markdown.js），不自行拼 HTML；
//   - 替换优先走 execCommand('insertText') 以保留浏览器原生撤销栈。

window.Editor = (function () {
  const DEBOUNCE_MS = 150;

  let ta = null;
  let preview = null;
  let onChangeCb = null;
  let timer = null;

  function init(textareaEl, previewEl) {
    ta = textareaEl;
    preview = previewEl;
    ta.addEventListener("input", function () {
      scheduleRefresh();
      if (onChangeCb) onChangeCb();
    });
  }

  function getValue() {
    return ta.value;
  }

  function setValue(value) {
    ta.value = value;
    refresh();
  }

  function getSelection() {
    // 无选中时 text 为空串
    return {
      start: ta.selectionStart,
      end: ta.selectionEnd,
      text: ta.value.slice(ta.selectionStart, ta.selectionEnd),
    };
  }

  function replaceSelection(text) {
    const sel = getSelection();
    ta.focus();
    ta.setSelectionRange(sel.start, sel.end);

    let replaced = false;
    if (document.execCommand) {
      replaced = document.execCommand("insertText", false, text);
    }
    if (!replaced) {
      // 回退：手动拼接并把光标移到替换段之后
      ta.value = ta.value.slice(0, sel.start) + text + ta.value.slice(sel.end);
      ta.setSelectionRange(sel.start + text.length, sel.start + text.length);
    }

    refresh();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function refresh() {
    preview.innerHTML = window.md.render(ta.value);
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  }

  function onChange(cb) {
    onChangeCb = cb;
  }

  return {
    init,
    getValue,
    setValue,
    getSelection,
    replaceSelection,
    refresh,
    refreshSoon: scheduleRefresh,
    onChange,
  };
})();
