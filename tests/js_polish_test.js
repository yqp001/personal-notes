// 个人笔记 —— AI 润色前端 static/js/polish.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_polish_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：加载真实的 api.js + editor.js + polish.js（集成用例额外加载 note_edit.js），
// 用最小 DOM 替身驱动真实事件，把「右键菜单仅在非空选区弹出、弹窗左右对照、加载/失败/重试、
// 确认替换与取消、焦点锁定与 Esc、演示模式徽标」变成无需浏览器即可重复的断言。
//
// 已知无法在本沙箱覆盖、需交给最终阶段人工走查的部分（显式记录，不假装已覆盖）：
//   - execCommand('insertText') 的真实撤销栈（真实 Ctrl+Z 行为）；
//   - CSS 过渡/旋转的观感与 prefers-reduced-motion 的实际渲染；
//   - 真实 DOMPurify / marked 的净化与渲染。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const EDITOR_JS = path.join(__dirname, "..", "static", "js", "editor.js");
const POLISH_JS = path.join(__dirname, "..", "static", "js", "polish.js");
const NOTE_EDIT_JS = path.join(__dirname, "..", "static", "js", "note_edit.js");

// 与 static/js/polish.js 的常量保持一致（断言用字面量，避免“测试跟着实现改”）
const EMPTY_HINT = "请先选中需要润色的文本";
const LOADING_TEXT = "润色中…";
const RETRY_LABEL = "重试";
const BADGE_LABEL = "演示模式";
// 视口与菜单尺寸（stub 固定值，用于断言边缘回退）
const MENU_W = 120;
const MENU_H = 44;

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

function jsonResponse(status, body) {
  return { status, ok: status < 400, json: () => Promise.resolve(body) };
}

const ME_OK = {
  code: "OK",
  message: "操作成功",
  data: { user: { id: 1, email: "a@b.com", username: "阿黎", bio: "" } },
};

function statusBody(provider) {
  return { code: "OK", message: "操作成功", data: { provider, available: true } };
}

function polishBody(polished) {
  return { code: "OK", message: "操作成功", data: { polished, provider: "mock" } };
}

function failBody(code, message) {
  return { code, message, data: null };
}

class FakeEvent {
  constructor(type, init) {
    this.type = type;
    this.bubbles = !!(init && init.bubbles);
  }
}

/** 通用 responder：先查 "METHOD url" / "url" 映射，再回落到默认 mock 成功响应。 */
function responderFor(map) {
  const routes = map || {};
  return (url, requestOptions) => {
    const method = requestOptions && requestOptions.method ? requestOptions.method : "GET";
    if (routes[method + " " + url]) return routes[method + " " + url];
    if (routes[url]) return routes[url];
    if (url === "/api/ai/status") return jsonResponse(200, statusBody("mock"));
    if (url === "/api/ai/polish") return jsonResponse(200, polishBody("润色结果"));
    if (url === "/api/auth/me") return jsonResponse(200, ME_OK);
    return jsonResponse(404, failBody("NOT_FOUND", "页面不存在"));
  };
}

function flush(times) {
  const rounds = times || 6;
  let chain = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) {
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

/** 载入真实 api.js + editor.js + polish.js（可选 note_edit.js）并绑定。 */
function loadPolish(options) {
  const opts = options || {};
  const requests = [];
  const renders = [];
  const timers = [];
  const docHandlers = {};
  let activeElement = null;

  function makeEl(init) {
    const conf = init || {};
    const attrs = {};
    const classes = new Set();
    const handlers = {};
    const el = {
      value: conf.value || "",
      textContent: conf.textContent || "",
      placeholder: conf.placeholder === undefined ? "" : conf.placeholder,
      hidden: conf.hidden === undefined ? false : conf.hidden,
      disabled: conf.disabled === undefined ? false : conf.disabled,
      offsetWidth: conf.offsetWidth === undefined ? MENU_W : conf.offsetWidth,
      offsetHeight: conf.offsetHeight === undefined ? MENU_H : conf.offsetHeight,
      style: {},
      selectionStart: 0,
      selectionEnd: 0,
      focused: false,
      setAttribute(name, value) {
        attrs[name] = value;
      },
      getAttribute(name) {
        return attrs[name] === undefined ? null : attrs[name];
      },
      removeAttribute(name) {
        delete attrs[name];
      },
      addEventListener(type, fn) {
        (handlers[type] = handlers[type] || []).push(fn);
      },
      fire(type, event) {
        const calls = (handlers[type] || []).map((fn) => fn(event || { type }));
        return Promise.all(calls);
      },
      dispatchEvent(event) {
        (handlers[event.type] || []).forEach((fn) => fn(event));
        return true;
      },
      focus() {
        this.focused = true;
        activeElement = this;
      },
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => {
          if (on === undefined) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          } else if (on) classes.add(c);
          else classes.delete(c);
        },
      },
    };
    if (conf.className) conf.className.split(" ").forEach((c) => classes.add(c));
    return el;
  }

  const els = {
    content: makeEl({ value: opts.value === undefined ? "" : opts.value }),
    preview: makeEl({}),
    "ai-polish-btn": makeEl({ textContent: "AI 润色" }),
    "editor-error": makeEl({ hidden: true }),
    "editor-notice": makeEl({ hidden: true }),
    "ctx-menu": makeEl({ hidden: true }),
    "ctx-item": makeEl({ textContent: "AI 润色" }),
    "polish-modal": makeEl({ hidden: true }),
    "polish-source": makeEl({}),
    "polish-result": makeEl({}),
    "polish-status": makeEl({ hidden: true }),
    "polish-status-text": makeEl({ textContent: LOADING_TEXT }),
    "polish-spinner": makeEl({ hidden: true }),
    "polish-retry": makeEl({ hidden: true, textContent: RETRY_LABEL }),
    "polish-cancel": makeEl({ textContent: "取消" }),
    "polish-confirm": makeEl({ disabled: true, textContent: "确认替换" }),
    "polish-badge": makeEl({ hidden: true, textContent: BADGE_LABEL }),
    title: makeEl({}),
    "save-draft": makeEl({ textContent: "保存草稿" }),
    publish: makeEl({ textContent: "发布" }),
    "editor-back-list": makeEl({ hidden: true }),
    "logout-btn": null,
  };
  const split = makeEl({});
  split.setAttribute("data-mode", "edit");
  const tabEdit = makeEl({ textContent: "编辑" });
  tabEdit.setAttribute("data-mode", "edit");
  const tabPreview = makeEl({ textContent: "预览" });
  tabPreview.setAttribute("data-mode", "preview");

  let releasePolish = null;
  const polishGate = new Promise((resolve) => {
    releasePolish = resolve;
  });

  const responder = opts.responder || responderFor();

  const sandbox = {
    console,
    location: { href: opts.pathname || "/notes/new", pathname: opts.pathname || "/notes/new" },
    history: { replaceState: () => {} },
    innerWidth: opts.innerWidth === undefined ? 1440 : opts.innerWidth,
    innerHeight: opts.innerHeight === undefined ? 900 : opts.innerHeight,
    Event: FakeEvent,
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout() {},
    fetch(url, requestOptions) {
      requests.push({ url, opts: requestOptions });
      const response = responder(url, requestOptions);
      if (opts.holdPolish && url === "/api/ai/polish") {
        return polishGate.then(() => response);
      }
      return Promise.resolve(response);
    },
    md: {
      render(src) {
        renders.push(src);
        return "[MD]" + (src === undefined ? "" : src);
      },
    },
    document: {
      execCommand: opts.execCommand,
      getElementById: (id) => els[id] || null,
      querySelector: (selector) => (selector === ".editor-split" ? split : null),
      querySelectorAll: () => [tabEdit, tabPreview],
      addEventListener(type, fn) {
        (docHandlers[type] = docHandlers[type] || []).push(fn);
      },
      get activeElement() {
        return activeElement;
      },
    },
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(EDITOR_JS, "utf-8"), sandbox, { filename: "editor.js" });
  vm.runInContext(fs.readFileSync(POLISH_JS, "utf-8"), sandbox, { filename: "polish.js" });

  const ctx = {
    sandbox,
    els,
    requests,
    renders,
    timers,
    setActive(el) {
      activeElement = el;
    },
    getActive() {
      return activeElement;
    },
    fireDoc(type, event) {
      const calls = (docHandlers[type] || []).map((fn) => fn(event || { type }));
      return Promise.all(calls);
    },
    /** 模拟真实点击：浏览器会先把焦点移到被点的按钮上 */
    click(el) {
      activeElement = el;
      return el.fire("click", { type: "click", target: el });
    },
    contextMenu(x, y) {
      const event = {
        type: "contextmenu",
        clientX: x,
        clientY: y,
        defaultPrevented: false,
        target: els.content,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      const fired = els.content.fire("contextmenu", event);
      event.done = fired;
      return event;
    },
    key(key, shiftKey) {
      const event = {
        type: "keydown",
        key,
        shiftKey: !!shiftKey,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      event.done = this.fireDoc("keydown", event);
      return event;
    },
    releasePolish() {
      releasePolish();
    },
  };

  if (opts.withNoteEdit) {
    vm.runInContext(fs.readFileSync(NOTE_EDIT_JS, "utf-8"), sandbox, { filename: "note_edit.js" });
  } else {
    sandbox.Editor.init(els.content, els.preview);
    sandbox.Polish.bind(els.content);
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// 任务 4：右键菜单与工具栏入口
// ---------------------------------------------------------------------------

testCase("Polish.bind 是函数；绑定后查询一次 provider 状态，mock 时显示「演示模式」徽标", async () => {
  const ctx = loadPolish({});
  checkEq(typeof ctx.sandbox.Polish.bind, "function", "window.Polish.bind 应为函数");
  await flush();

  const statusCalls = ctx.requests.filter((r) => r.url === "/api/ai/status");
  checkEq(statusCalls.length, 1, "绑定后应查询一次 provider 状态");
  checkEq(statusCalls[0].opts.method, "GET", "provider 状态用 GET");
  checkEq(ctx.els["polish-badge"].hidden, false, "provider=mock 时应显示徽标");
  checkEq(ctx.els["polish-badge"].textContent, BADGE_LABEL, "徽标文案应为「演示模式」");
});

testCase("provider 非 mock 时不显示「演示模式」徽标", async () => {
  const ctx = loadPolish({
    responder: (url) => (url === "/api/ai/status"
      ? jsonResponse(200, statusBody("openai"))
      : jsonResponse(200, polishBody("x"))),
  });
  await flush();
  checkEq(ctx.els["polish-badge"].hidden, true, "真实 provider 不得显示「演示模式」徽标");
});

testCase("未选中文本时右键：保留浏览器原生菜单，且不弹出自定义菜单", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字" });
  await flush();

  ctx.els.content.setSelectionRange(3, 3);
  const event = ctx.contextMenu(100, 100);
  await event.done;

  checkEq(event.defaultPrevented, false, "选区为空时必须保留原生右键菜单");
  checkEq(ctx.els["ctx-menu"].hidden, true, "选区为空时不得显示自定义菜单");
});

testCase("仅空白选区（空格/换行）右键同样不弹菜单", async () => {
  const ctx = loadPolish({ value: "a   \nb" });
  await flush();

  ctx.els.content.setSelectionRange(1, 5);
  const event = ctx.contextMenu(50, 50);
  await event.done;

  checkEq(event.defaultPrevented, false, "纯空白选区也必须保留原生菜单");
  checkEq(ctx.els["ctx-menu"].hidden, true, "纯空白选区不得显示菜单");
});

testCase("选中文本后右键：拦截原生菜单，菜单出现在鼠标位置且只有一项「AI 润色」", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字" });
  await flush();

  ctx.els.content.setSelectionRange(2, 5);
  const event = ctx.contextMenu(400, 300);
  await event.done;

  checkEq(event.defaultPrevented, true, "有选区时应拦截原生右键菜单");
  checkEq(ctx.els["ctx-menu"].hidden, false, "应显示自定义菜单");
  checkEq(ctx.els["ctx-menu"].style.left, "400px", "菜单 X 应贴合鼠标");
  checkEq(ctx.els["ctx-menu"].style.top, "300px", "菜单 Y 应贴合鼠标");
  checkEq(ctx.els["ctx-item"].textContent, "AI 润色", "菜单项文案应为「AI 润色」");
});

testCase("视口边缘自动回退：375 视口下菜单不被裁切", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字", innerWidth: 375, innerHeight: 600 });
  await flush();

  ctx.els.content.setSelectionRange(2, 5);
  const event = ctx.contextMenu(370, 590);
  await event.done;

  checkEq(ctx.els["ctx-menu"].style.left, `${375 - MENU_W - 8}px`, "菜单应向左回退，避免超出右边界");
  checkEq(ctx.els["ctx-menu"].style.top, `${600 - MENU_H - 8}px`, "菜单应向上回退，避免超出下边界");
});

testCase("菜单点击空白或按 Esc 都能关闭", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字" });
  await flush();
  ctx.els.content.setSelectionRange(0, 4);

  await ctx.contextMenu(20, 20).done;
  checkEq(ctx.els["ctx-menu"].hidden, false, "前置：菜单已打开");
  await ctx.fireDoc("click", { type: "click" });
  checkEq(ctx.els["ctx-menu"].hidden, true, "点击页面空白应关闭菜单");

  await ctx.contextMenu(20, 20).done;
  checkEq(ctx.els["ctx-menu"].hidden, false, "前置：菜单再次打开");
  await ctx.key("Escape").done;
  checkEq(ctx.els["ctx-menu"].hidden, true, "Esc 应关闭菜单");
});

testCase("工具栏入口在未选中文本时提示「请先选中需要润色的文本」，且不打开弹窗、不发请求", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字" });
  await flush();

  ctx.els.content.setSelectionRange(2, 2);
  await ctx.click(ctx.els["ai-polish-btn"]);

  checkEq(ctx.els["editor-error"].textContent, EMPTY_HINT, "工具栏入口的空选区提示文案");
  checkEq(ctx.els["editor-error"].hidden, false, "提示必须可见");
  checkEq(ctx.els["polish-modal"].hidden, true, "空选区不得打开弹窗");
  checkEq(ctx.requests.filter((r) => r.url === "/api/ai/polish").length, 0, "空选区不得发起润色请求");
});

// ---------------------------------------------------------------------------
// 任务 5：润色弹窗、加载态、失败重试与「确认替换」
// ---------------------------------------------------------------------------

testCase("点击菜单项：先关菜单再打开弹窗（菜单不得压在弹窗上）", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字" });
  await flush();
  ctx.els.content.setSelectionRange(2, 5);

  await ctx.contextMenu(400, 300).done;
  await ctx.els["ctx-item"].fire("click", { type: "click" });

  checkEq(ctx.els["ctx-menu"].hidden, true, "点击菜单项后菜单必须关闭");
  checkEq(ctx.els["polish-modal"].hidden, false, "应打开润色弹窗");
});

testCase("打开弹窗：立即抓取选区快照，左栏显示原文、右栏加载态、确认替换禁用", async () => {
  const ctx = loadPolish({ value: "这是需要润色的文字", holdPolish: true });
  await flush();

  ctx.els.content.setSelectionRange(0, 2);
  await ctx.click(ctx.els["ai-polish-btn"]);

  checkEq(ctx.els["polish-modal"].hidden, false, "弹窗应可见");
  checkEq(ctx.els["polish-source"].value, "这是", "左栏「原文」应为选区快照");
  checkEq(ctx.els["polish-result"].value, "", "右栏「润色结果」初始应为空");
  checkEq(ctx.els["polish-result"].placeholder, LOADING_TEXT, "右栏占位应为「润色中…」");
  checkEq(ctx.els["polish-status"].hidden, false, "加载态应可见");
  checkEq(ctx.els["polish-status-text"].textContent, LOADING_TEXT, "加载文案应为「润色中…」");
  checkEq(ctx.els["polish-spinner"].hidden, false, "加载态应显示旋转指示器");
  checkEq(ctx.els["polish-retry"].hidden, true, "加载态不得显示「重试」");
  checkEq(ctx.els["polish-confirm"].disabled, true, "加载中「确认替换」必须禁用");
  checkEq(ctx.els["polish-result"].focused, true, "打开弹窗后焦点应移入弹窗");

  const posts = ctx.requests.filter((r) => r.url === "/api/ai/polish");
  checkEq(posts.length, 1, "应对 /api/ai/polish 发起一次请求");
  checkEq(posts[0].opts.method, "POST", "润色请求用 POST");
  checkEq(JSON.parse(posts[0].opts.body).text, "这是", "请求体应携带选区原文");

  ctx.releasePolish();
  await flush();
  checkEq(ctx.els["polish-status"].hidden, true, "请求完成后应隐藏加载态");
  checkEq(ctx.els["polish-result"].value, "润色结果", "成功后右栏应填入润色结果");
  checkEq(ctx.els["polish-confirm"].disabled, false, "成功后「确认替换」应可点");
});

testCase("润色失败：显示后端 message + 「重试」，「确认替换」保持禁用，正文零改动", async () => {
  const ctx = loadPolish({
    value: "abcdef",
    responder: (url) => (url === "/api/ai/polish"
      ? jsonResponse(502, failBody("AI_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试"))
      : jsonResponse(200, statusBody("mock"))),
  });
  await flush();

  ctx.els.content.setSelectionRange(0, 6);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();

  checkEq(ctx.els["polish-status"].hidden, false, "失败提示应可见");
  checkEq(ctx.els["polish-status-text"].textContent, "AI 服务暂时不可用，请稍后重试", "失败应展示后端 message");
  checkEq(ctx.els["polish-retry"].hidden, false, "失败应显示「重试」按钮");
  checkEq(ctx.els["polish-retry"].textContent, RETRY_LABEL, "按钮文案应为「重试」");
  checkEq(ctx.els["polish-spinner"].hidden, true, "非加载态不得显示旋转指示器");
  checkEq(ctx.els["polish-result"].value, "", "失败不得把任何内容写回结果框");
  checkEq(ctx.els["polish-result"].placeholder, LOADING_TEXT, "失败后右栏仍应是「润色中…」占位（不得写空串）");
  checkEq(ctx.els["polish-confirm"].disabled, true, "失败时「确认替换」必须保持禁用");
  checkEq(ctx.els.content.value, "abcdef", "失败时正文必须零改动");
});

testCase("「重试」重新请求，成功后恢复可替换", async () => {
  let attempt = 0;
  const ctx = loadPolish({
    value: "abcdef",
    responder: (url) => {
      if (url !== "/api/ai/polish") return jsonResponse(200, statusBody("mock"));
      attempt += 1;
      return attempt === 1
        ? jsonResponse(502, failBody("AI_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试"))
        : jsonResponse(200, polishBody("重试后的结果"));
    },
  });
  await flush();

  ctx.els.content.setSelectionRange(0, 6);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();
  checkEq(attempt, 1, "首次请求应失败");

  await ctx.els["polish-retry"].fire("click", { type: "click" });
  await flush();

  const posts = ctx.requests.filter((r) => r.url === "/api/ai/polish");
  checkEq(posts.length, 2, "「重试」应再次调用润色接口");
  checkEq(JSON.parse(posts[1].opts.body).text, "abcdef", "重试应使用左栏原文");
  checkEq(ctx.els["polish-result"].value, "重试后的结果", "重试成功后右栏应填入结果");
  checkEq(ctx.els["polish-confirm"].disabled, false, "重试成功后「确认替换」应可点");
  checkEq(ctx.els["polish-status"].hidden, true, "重试成功后应隐藏错误提示");
});

testCase("打开弹窗时抓取的原文快照不随后续选区变化而改变", async () => {
  const ctx = loadPolish({
    value: "abcdef",
    responder: (url) => (url === "/api/ai/polish"
      ? jsonResponse(502, failBody("AI_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试"))
      : jsonResponse(200, statusBody("mock"))),
  });
  await flush();

  ctx.els.content.setSelectionRange(0, 3);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();

  ctx.els.content.setSelectionRange(5, 5);   // 选区在弹窗打开后被清空
  await ctx.els["polish-retry"].fire("click", { type: "click" });
  await flush();

  const posts = ctx.requests.filter((r) => r.url === "/api/ai/polish");
  checkEq(posts.length, 2, "重试应再次请求");
  checkEq(JSON.parse(posts[1].opts.body).text, "abc", "重试必须使用打开弹窗时抓取的快照");
});

testCase("「确认替换」把结果写回选中位置、刷新预览、关闭弹窗并把焦点交回文本域", async () => {
  const ctx = loadPolish({
    value: "hello world",
    responder: (url) => (url === "/api/ai/polish"
      ? jsonResponse(200, polishBody("世界"))
      : jsonResponse(200, statusBody("mock"))),
  });
  await flush();

  ctx.els.content.setSelectionRange(6, 11);   // "world"
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();

  await ctx.click(ctx.els["polish-confirm"]);

  checkEq(ctx.els.content.value, "hello 世界", "「确认替换」应精确替换选中片段");
  checkEq(ctx.els.content.selectionStart, 8, "光标应落在替换段之后");
  checkEq(ctx.renders[ctx.renders.length - 1], "hello 世界", "替换后应刷新预览（经 window.md.render）");
  checkEq(ctx.els["polish-modal"].hidden, true, "替换后应关闭弹窗");
  checkEq(ctx.els.content.focused, true, "替换后焦点应回到文本域（便于继续编辑 / 撤销）");
});

testCase("支持 execCommand 时优先用它替换，以保留浏览器撤销栈", async () => {
  const commands = [];
  const ctx = loadPolish({
    value: "hello world",
    execCommand: (command, ui, text) => {
      commands.push({ command, ui, text });
      return true;
    },
    responder: (url) => (url === "/api/ai/polish"
      ? jsonResponse(200, polishBody("世界"))
      : jsonResponse(200, statusBody("mock"))),
  });
  await flush();

  ctx.els.content.setSelectionRange(6, 11);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();
  await ctx.click(ctx.els["polish-confirm"]);

  checkEq(commands.length, 1, "应调用 execCommand 一次");
  checkEq(commands[0].command, "insertText", "命令名应为 insertText");
  checkEq(commands[0].text, "世界", "插入内容应为润色结果");
});

testCase("「取消」关闭弹窗且不改动正文一个字符，焦点回到触发元素", async () => {
  const ctx = loadPolish({
    value: "hello world",
    responder: (url) => (url === "/api/ai/polish"
      ? jsonResponse(200, polishBody("世界"))
      : jsonResponse(200, statusBody("mock"))),
  });
  await flush();
  const rendersBefore = ctx.renders.length;

  ctx.els.content.setSelectionRange(6, 11);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();
  await ctx.click(ctx.els["polish-cancel"]);

  checkEq(ctx.els.content.value, "hello world", "「取消」必须不改动正文");
  checkEq(ctx.els.content.selectionStart, 6, "「取消」不得改动选区");
  checkEq(ctx.renders.length, rendersBefore, "「取消」不得刷新预览");
  checkEq(ctx.els["polish-modal"].hidden, true, "「取消」应关闭弹窗");
  checkEq(ctx.els["ai-polish-btn"].focused, true, "关闭后焦点应回到触发按钮");
});

testCase("按 Esc 关闭弹窗；点击遮罩关闭；点击弹窗内容不关闭", async () => {
  const ctx = loadPolish({ value: "abc def" });
  await flush();

  ctx.els.content.setSelectionRange(0, 3);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();

  await ctx.key("Escape").done;
  checkEq(ctx.els["polish-modal"].hidden, true, "Esc 应关闭弹窗");
  checkEq(ctx.els["ai-polish-btn"].focused, true, "Esc 关闭后焦点应回到触发元素");

  ctx.els["polish-modal"].hidden = false;
  await ctx.els["polish-result"].fire("click", { type: "click", target: ctx.els["polish-result"] });
  await flush();
  checkEq(ctx.els["polish-modal"].hidden, false, "点击弹窗内容不得关闭弹窗");

  await ctx.els["polish-modal"].fire("click", { type: "click", target: ctx.els["polish-modal"] });
  await flush();
  checkEq(ctx.els["polish-modal"].hidden, true, "点击遮罩本身应关闭弹窗");
});

testCase("焦点锁定：Tab / Shift+Tab 在弹窗内循环，不逃出弹窗", async () => {
  const ctx = loadPolish({ value: "abc def" });
  await flush();

  ctx.els.content.setSelectionRange(0, 3);
  await ctx.click(ctx.els["ai-polish-btn"]);
  await flush();

  checkEq(ctx.getActive(), ctx.els["polish-result"], "打开后焦点应在右栏");
  // 成功路径下「重试」隐藏，可聚焦顺序为：原文 → 结果 → 取消 → 确认替换
  const tab1 = ctx.key("Tab");
  await tab1.done;
  checkEq(tab1.defaultPrevented, true, "Tab 必须被拦截，避免焦点逃出弹窗");
  checkEq(ctx.getActive(), ctx.els["polish-cancel"], "Tab 应前进到「取消」");

  await ctx.key("Tab").done;
  checkEq(ctx.getActive(), ctx.els["polish-confirm"], "Tab 应前进到「确认替换」");

  await ctx.key("Tab").done;
  checkEq(ctx.getActive(), ctx.els["polish-source"], "Tab 到末尾应回卷到「原文」");

  await ctx.key("Tab", true).done;
  checkEq(ctx.getActive(), ctx.els["polish-confirm"], "Shift+Tab 应反向回卷到「确认替换」");

  const inside = [ctx.els["polish-source"], ctx.els["polish-result"], ctx.els["polish-cancel"], ctx.els["polish-confirm"]];
  check(inside.indexOf(ctx.getActive()) !== -1, "循环后焦点必须仍在弹窗内");
});

// ---------------------------------------------------------------------------
// 集成与容错
// ---------------------------------------------------------------------------

testCase("集成：note_edit.js 在 Editor.init 之后自动绑定 polish 入口", async () => {
  const ctx = loadPolish({ value: "这是一段需要润色的文字", withNoteEdit: true });
  check(ctx.requests.some((r) => r.url === "/api/ai/status"), "绑定后应查询 provider 状态");
  await flush();

  // Editor.init 已生效：输入会调度 150ms 防抖刷新
  await ctx.els.content.fire("input", { type: "input" });
  check(
    ctx.timers.some((timer) => timer.ms === 150),
    "note_edit.js 必须完成 Editor.init（输入应调度 150ms 防抖刷新）"
  );

  // Polish.bind 已生效：划词右键能拦到自定义菜单
  ctx.els.content.setSelectionRange(2, 5);
  const event = ctx.contextMenu(300, 200);
  await event.done;

  checkEq(event.defaultPrevented, true, "note_edit.js 必须完成 Polish.bind（右键应能拦截）");
  checkEq(ctx.els["ctx-menu"].hidden, false, "绑定后划词右键应弹出菜单");
});

testCase("容错：页面上没有润色元素时 polish.js 不抛异常", () => {
  const sandbox = {
    console,
    innerWidth: 1024,
    innerHeight: 768,
    Event: FakeEvent,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: () => Promise.reject(new Error("不应发起请求")),
    md: { render: () => "" },
    document: {
      execCommand: undefined,
      getElementById: () => null,
      addEventListener: () => {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(POLISH_JS, "utf-8"), sandbox, { filename: "polish.js" });
  sandbox.Polish.bind(null);
  passed += 1;
});

// ---------------------------------------------------------------------------
// 运行器
// ---------------------------------------------------------------------------

(async () => {
  const failures = [];
  for (const [name, fn] of cases) {
    const before = passed;
    try {
      await fn();
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
