// 个人笔记 —— 编辑区静态契约 static/js/editor.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_editor_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：editor.js 只在 textarea / preview / document / window 上操作，本脚本用最小替身驱动它，
// 把「选区读写、防抖刷新、替换后光标位置、优先 execCommand 保留撤销栈」变成可重复的断言。
// 预览内容一律经 window.md.render（即 markdown.js），因此这里对 window.md 打桩并记录调用。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EDITOR_JS = path.join(__dirname, "..", "static", "js", "editor.js");

let passed = 0;
const cases = [];

function testCase(name, fn) {
  cases.push([name, fn]);
}

function fail(message) {
  throw new Error(message);
}

function check(condition, label) {
  if (!condition) fail(label);
  passed += 1;
}

function checkEq(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
  passed += 1;
}

function makeTextarea(value) {
  const handlers = {};
  return {
    value: value === undefined ? "" : value,
    selectionStart: 0,
    selectionEnd: 0,
    focused: false,
    handlers,
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    dispatchEvent(event) {
      (handlers[event.type] || []).forEach((fn) => fn(event));
      return true;
    },
    focus() {
      this.focused = true;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
}

function fire(textarea, type) {
  (textarea.handlers[type] || []).forEach((fn) => fn({ type }));
}

class FakeEvent {
  constructor(type, init) {
    this.type = type;
    this.bubbles = !!(init && init.bubbles);
  }
}

/**
 * 载入真实 editor.js 并完成 init()。
 * @param {object} options
 * @param {string} [options.value]        textarea 初值
 * @param {Function} [options.execCommand] document.execCommand 的替身（不传表示浏览器不支持）
 */
function loadEditor(options) {
  const opts = options || {};
  const renders = [];
  const timers = [];
  const cleared = [];
  const textarea = makeTextarea(opts.value);
  const preview = { innerHTML: "" };

  const sandbox = {
    console,
    Event: FakeEvent,
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
    document: { execCommand: opts.execCommand },
    md: {
      render(src) {
        renders.push(src);
        return "[MD]" + (src === undefined ? "" : src);
      },
    },
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(EDITOR_JS, "utf-8"), sandbox, { filename: "editor.js" });
  sandbox.Editor.init(textarea, preview);
  return { Editor: sandbox.Editor, textarea, preview, renders, timers, cleared };
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

testCase("暴露 init / getValue / setValue / getSelection / replaceSelection / refresh / refreshSoon / onChange", () => {
  const { Editor } = loadEditor({});
  for (const name of [
    "init", "getValue", "setValue", "getSelection",
    "replaceSelection", "refresh", "refreshSoon", "onChange",
  ]) {
    checkEq(typeof Editor[name], "function", `Editor.${name} 应为函数`);
  }
});

testCase("输入触发 150ms 防抖刷新，并回调 onChange", () => {
  const ctx = loadEditor({ value: "# 标题" });
  let changed = 0;
  ctx.Editor.onChange(() => {
    changed += 1;
  });

  fire(ctx.textarea, "input");

  checkEq(changed, 1, "onChange 应被调用一次");
  checkEq(ctx.timers.length, 1, "应调度一次刷新");
  checkEq(ctx.timers[0].ms, 150, "防抖间隔应为 150ms");
  checkEq(ctx.renders.length, 0, "定时器触发前不应刷新");

  ctx.timers[0].fn();
  checkEq(ctx.renders.length, 1, "定时器触发后应刷新一次");
  checkEq(ctx.renders[0], "# 标题", "应把 textarea 的当前值交给渲染出口");
  check(ctx.preview.innerHTML.indexOf("[MD]") === 0, "预览内容应来自 window.md.render");
});

testCase("连续刷新只执行最后一次（防抖取消前一次）", () => {
  const ctx = loadEditor({ value: "a" });

  ctx.Editor.refreshSoon();
  ctx.Editor.refreshSoon();
  ctx.Editor.refreshSoon();

  checkEq(ctx.timers.length, 3, "应有三次调度");
  check(
    ctx.timers.every((timer) => timer.ms === 150),
    "每次调度都应为 150ms"
  );
  check(ctx.cleared.length >= 2, "每次调度前都应清除上一次的定时器");
  checkEq(ctx.renders.length, 0, "调度阶段不应刷新");

  ctx.timers[2].fn();
  checkEq(ctx.renders.length, 1, "只应刷新一次");
  checkEq(ctx.renders[0], "a", "刷新应使用 textarea 当前值");
});

testCase("getValue / setValue 读写文本域并立即刷新预览", () => {
  const ctx = loadEditor({ value: "" });
  ctx.Editor.setValue("## 新内容");

  checkEq(ctx.textarea.value, "## 新内容", "setValue 应写入 textarea");
  checkEq(ctx.Editor.getValue(), "## 新内容", "getValue 应读出 textarea 的值");
  checkEq(ctx.renders[ctx.renders.length - 1], "## 新内容", "setValue 应触发一次刷新");
  check(ctx.preview.innerHTML.indexOf("## 新内容") !== -1, "预览应更新");
});

testCase("getSelection 无选中时 text 为空串，有选中时返回片段", () => {
  const ctx = loadEditor({ value: "abcdef" });

  ctx.textarea.setSelectionRange(2, 2);
  const empty = ctx.Editor.getSelection();
  checkEq(empty.start, 2, "空选中的 start");
  checkEq(empty.end, 2, "空选中的 end");
  checkEq(empty.text, "", "空选中的 text 必须是空串");

  ctx.textarea.setSelectionRange(1, 4);
  const sel = ctx.Editor.getSelection();
  checkEq(sel.start, 1, "start");
  checkEq(sel.end, 4, "end");
  checkEq(sel.text, "bcd", "选中文本");
});

testCase("replaceSelection：不支持 execCommand 时手动拼接并把光标移到替换段之后", () => {
  const ctx = loadEditor({ value: "hello world" });
  ctx.textarea.setSelectionRange(6, 11); // "world"

  ctx.Editor.replaceSelection("世界");

  checkEq(ctx.textarea.value, "hello 世界", "应替换选中片段");
  checkEq(ctx.textarea.selectionStart, 8, "光标应落在替换段之后");
  checkEq(ctx.textarea.selectionEnd, 8, "光标处应为零宽选区");
  checkEq(ctx.renders[ctx.renders.length - 1], "hello 世界", "替换后应刷新预览");
});

testCase("replaceSelection：优先用 execCommand('insertText') 以保留撤销栈", () => {
  const calls = [];
  const ctx = loadEditor({
    value: "abcdef",
    execCommand: (command, ui, text) => {
      calls.push({ command, ui, text });
      return true;
    },
  });
  ctx.textarea.setSelectionRange(0, 2);

  ctx.Editor.replaceSelection("XY");

  checkEq(calls.length, 1, "应调用 execCommand 一次");
  checkEq(calls[0].command, "insertText", "命令名");
  checkEq(calls[0].ui, false, "第二参数应为 false");
  checkEq(calls[0].text, "XY", "插入的文本");
  checkEq(ctx.textarea.focused, true, "替换前应聚焦文本域");
  checkEq(ctx.textarea.value, "abcdef", "execCommand 成功时不得再做手动拼接");
});

testCase("replaceSelection：execCommand 返回 false 时回退到手动拼接", () => {
  const ctx = loadEditor({
    value: "abcdef",
    execCommand: () => false,
  });
  ctx.textarea.setSelectionRange(0, 2);

  ctx.Editor.replaceSelection("XY");

  checkEq(ctx.textarea.value, "XYcdef", "回退路径应完成替换");
  checkEq(ctx.textarea.selectionStart, 2, "回退路径光标位置");
});

testCase("replaceSelection 派发 input 事件，使外部监听者与预览同步", () => {
  const ctx = loadEditor({ value: "abcdef" });
  let changed = 0;
  ctx.Editor.onChange(() => {
    changed += 1;
  });

  ctx.textarea.setSelectionRange(0, 0);
  ctx.Editor.replaceSelection("Z");

  checkEq(changed, 1, "应派发 input 事件触发 onChange");
});

// ---------------------------------------------------------------------------
// 运行器
// ---------------------------------------------------------------------------

(() => {
  const failures = [];
  for (const [name, fn] of cases) {
    const before = passed;
    try {
      fn();
      console.log(`[通过] ${name}（${passed - before} 项断言）`);
    } catch (err) {
      failures.push([name, err.message]);
      console.log(`[失败] ${name}：${err.message}`);
    }
  }

  console.log("-".repeat(56));
  if (failures.length) {
    console.log(`结果：${failures.length}/${cases.length} 个用例失败，共 ${passed} 项断言通过`);
    process.exit(1);
  }
  console.log(`结果：${cases.length}/${cases.length} 个用例全部通过，共 ${passed} 项断言通过`);
})();
