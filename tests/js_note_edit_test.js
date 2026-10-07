// 个人笔记 —— 写笔记页交互 static/js/note_edit.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_note_edit_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：加载真实的 api.js + editor.js + note_edit.js，用最小 DOM 替身驱动；
// 预览经 window.md.render（打桩记录），从而无需浏览器即可断言
// 「登录守卫、编辑回填、保存草稿、发布校验、失败提示、标签切换」等行为。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const EDITOR_JS = path.join(__dirname, "..", "static", "js", "editor.js");
const NOTE_EDIT_JS = path.join(__dirname, "..", "static", "js", "note_edit.js");

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

function makeEl(init) {
  const options = init || {};
  const attrs = {};
  const classes = new Set();
  const handlers = {};
  const node = {
    value: options.value || "",
    textContent: options.textContent || "",
    innerHTML: "",
    hidden: options.hidden === undefined ? true : options.hidden,
    disabled: false,
    classes,
    handlers,
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
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined) {
          if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        } else if (on) {
          classes.add(c);
        } else {
          classes.delete(c);
        }
      },
    },
  };
  if (options.className) {
    options.className.split(" ").forEach((c) => classes.add(c));
  }
  return node;
}

function flush(times) {
  const rounds = times || 4;
  let chain = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) {
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

/**
 * 载入真实 api.js + editor.js + note_edit.js。
 * @param {object} options
 * @param {string} options.pathname 进入页面时的 location.pathname
 * @param {(url: string, opts: object) => object} options.responder
 */
function loadNoteEdit(options) {
  const opts = options || {};
  const pathname = opts.pathname || "/notes/new";
  const requests = [];
  const timers = [];
  const cleared = [];
  const replaceStates = [];
  const renders = [];

  const els = {
    title: makeEl({ className: "editor-title" }),
    content: makeEl({}),
    preview: makeEl({}),
    "editor-error": makeEl({ hidden: true }),
    "editor-notice": makeEl({ hidden: true }),
    "save-draft": makeEl({ textContent: "保存草稿" }),
    publish: makeEl({ textContent: "发布" }),
    "editor-back-list": makeEl({ hidden: true }),
  };
  const split = makeEl({});
  split.setAttribute("data-mode", "edit");
  const tabEdit = makeEl({ textContent: "编辑" });
  tabEdit.setAttribute("data-mode", "edit");
  const tabPreview = makeEl({ textContent: "预览" });
  tabPreview.setAttribute("data-mode", "preview");
  const tabs = [tabEdit, tabPreview];

  const sandbox = {
    console,
    location: { href: pathname, pathname },
    history: {
      replaceState(state, title, url) {
        replaceStates.push(url);
        sandbox.location.pathname = url;
      },
    },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: (selector) => (selector === ".editor-split" ? split : null),
      querySelectorAll: (selector) => (selector === ".editor-tabs button" ? tabs : []),
    },
    fetch: (url, requestOptions) => {
      requests.push({ url, opts: requestOptions });
      return Promise.resolve(opts.responder(url, requestOptions));
    },
    md: {
      render(src) {
        renders.push(src);
        return "[MD]" + (src === undefined ? "" : src);
      },
    },
    document_execCommand: undefined,
  };
  sandbox.window = sandbox;
  sandbox.document.execCommand = undefined;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(EDITOR_JS, "utf-8"), sandbox, { filename: "editor.js" });
  vm.runInContext(fs.readFileSync(NOTE_EDIT_JS, "utf-8"), sandbox, { filename: "note_edit.js" });

  return { sandbox, els, split, tabs, tabPreview, requests, timers, cleared, replaceStates, renders };
}

const ME_OK = {
  code: "OK",
  message: "操作成功",
  data: { user: { id: 1, email: "a@b.com", username: "阿黎", bio: "" } },
};

function noteBody() {
  return {
    code: "OK",
    message: "操作成功",
    data: { note: { id: 7, title: "旧标题", content_md: "# 正文", status: "draft" } },
  };
}

/** 通用 responder：键为 "METHOD url"（或仅 url，默认 GET）。 */
function responderFor(map) {
  return (url, opts) => {
    const key = (opts && opts.method ? opts.method : "GET") + " " + url;
    if (map[key]) return map[key];
    if (map[url]) return map[url];
    if (url === "/api/auth/me") return jsonResponse(200, ME_OK);
    return jsonResponse(404, { code: "NOTE_NOT_FOUND", message: "笔记不存在", data: null });
  };
}

function bodyOf(request) {
  return JSON.parse(request.opts.body);
}

// ---------------------------------------------------------------------------
// 用例：登录守卫
// ---------------------------------------------------------------------------

testCase("未登录时跳转 /login，且不请求笔记", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/new",
    responder: () => jsonResponse(200, { code: "OK", message: "操作成功", data: { user: null } }),
  });
  await flush();

  checkEq(ctx.sandbox.location.href, "/login", "应跳转登录页");
  checkEq(ctx.requests.filter((r) => r.url.indexOf("/api/notes") === 0).length, 0, "不得请求笔记");
});

// ---------------------------------------------------------------------------
// 用例：编辑模式回填
// ---------------------------------------------------------------------------

testCase("编辑模式：回填标题与正文并刷新预览", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/7/edit",
    responder: responderFor({ "/api/notes/7": jsonResponse(200, noteBody()) }),
  });
  await flush();

  checkEq(ctx.requests[0].url, "/api/auth/me", "先做登录守卫");
  checkEq(ctx.requests[1].url, "/api/notes/7", "再读取笔记");
  checkEq(ctx.requests[1].opts.method, "GET", "读取笔记用 GET");
  checkEq(ctx.els.title.value, "旧标题", "标题应回填");
  checkEq(ctx.els.content.value, "# 正文", "正文应回填");
  check(ctx.els.preview.innerHTML.indexOf("# 正文") !== -1, "预览应随回填刷新");
  checkEq(ctx.split.getAttribute("data-mode"), "edit", "默认应与「编辑」标签一致");
});

testCase("新建模式不读取笔记，标题与正文为空", async () => {
  const ctx = loadNoteEdit({ pathname: "/notes/new", responder: responderFor({}) });
  await flush();

  checkEq(ctx.requests.filter((r) => r.url.indexOf("/api/notes") === 0).length, 0, "新建模式不应读取笔记");
  checkEq(ctx.els.title.value, "", "标题应为空");
  checkEq(ctx.els.content.value, "", "正文应为空");
});

testCase("笔记不存在：展示后端 message、隐藏编辑区、给出返回列表链接", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/7/edit",
    responder: responderFor({
      "/api/notes/7": jsonResponse(404, { code: "NOTE_NOT_FOUND", message: "笔记不存在", data: null }),
    }),
  });
  await flush();

  checkEq(ctx.els["editor-error"].textContent, "笔记不存在", "应展示后端 message");
  checkEq(ctx.els["editor-error"].hidden, false, "错误应可见");
  checkEq(ctx.split.hidden, true, "编辑区应隐藏");
  checkEq(ctx.els["editor-back-list"].hidden, false, "应显示「返回列表」链接");
});

// ---------------------------------------------------------------------------
// 用例：保存草稿
// ---------------------------------------------------------------------------

testCase("新建后保存草稿：POST、按钮「保存中…」、提示「已保存草稿」、URL 换成编辑地址", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/new",
    responder: responderFor({
      "POST /api/notes": jsonResponse(201, { code: "OK", message: "操作成功", data: { id: 42 } }),
    }),
  });
  await flush();

  ctx.els.title.value = "我的标题";
  ctx.els.content.value = "我的正文";

  const pending = ctx.els["save-draft"].fire("click");
  checkEq(ctx.els["save-draft"].disabled, true, "保存中按钮应禁用");
  check(ctx.els["save-draft"].textContent.indexOf("保存中") !== -1, "按钮文字应为「保存中…」");
  await pending;
  await flush();

  const posts = ctx.requests.filter((r) => r.url === "/api/notes");
  checkEq(posts.length, 1, "应有一次新建请求");
  checkEq(posts[0].opts.method, "POST", "新建应使用 POST");
  const body = bodyOf(posts[0]);
  checkEq(body.title, "我的标题", "请求体 title");
  checkEq(body.content_md, "我的正文", "请求体 content_md");
  checkEq(body.status, "draft", "保存草稿应以 draft 提交");

  checkEq(ctx.els["save-draft"].disabled, false, "保存结束后按钮应恢复");
  checkEq(ctx.els["save-draft"].textContent, "保存草稿", "按钮文字应复原");
  checkEq(ctx.els["editor-notice"].textContent, "已保存草稿", "成功提示文案");
  checkEq(ctx.els["editor-notice"].hidden, false, "成功提示应可见");
  checkEq(ctx.timers.length, 1, "应调度一次消失定时器");
  checkEq(ctx.timers[0].ms, 2000, "提示应 2 秒后消失");
  checkEq(ctx.replaceStates.length, 1, "新建成功后应替换 URL");
  checkEq(ctx.replaceStates[0], "/notes/42/edit", "替换为编辑地址，避免重复新建");
  checkEq(ctx.sandbox.location.href, "/notes/new", "保存草稿不应整页跳转");
});

testCase("编辑已有笔记保存草稿：使用 PUT", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/7/edit",
    responder: responderFor({
      "GET /api/notes/7": jsonResponse(200, noteBody()),
      "PUT /api/notes/7": jsonResponse(200, { code: "OK", message: "操作成功", data: { id: 7 } }),
    }),
  });
  await flush();

  await ctx.els["save-draft"].fire("click");
  await flush();

  const put = ctx.requests.filter((r) => r.url === "/api/notes/7" && r.opts.method === "PUT");
  checkEq(put.length, 1, "编辑模式应使用 PUT");
  checkEq(bodyOf(put[0]).status, "draft", "保存草稿以 draft 提交");
  checkEq(ctx.replaceStates.length, 0, "编辑模式无需替换 URL");
  checkEq(ctx.els["editor-notice"].textContent, "已保存草稿", "编辑模式也应提示已保存");
});

testCase("保存成功但提示 2 秒后消失", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/new",
    responder: responderFor({
      "POST /api/notes": jsonResponse(201, { code: "OK", message: "操作成功", data: { id: 42 } }),
    }),
  });
  await flush();
  ctx.els.content.value = "x";
  await ctx.els["save-draft"].fire("click");
  await flush();

  checkEq(ctx.timers.length, 1, "应调度一次消失定时器");
  ctx.timers[0].fn();
  checkEq(ctx.els["editor-notice"].textContent, "", "定时器触发后应清空提示");
  checkEq(ctx.els["editor-notice"].hidden, true, "定时器触发后应隐藏提示");
});

// ---------------------------------------------------------------------------
// 用例：发布
// ---------------------------------------------------------------------------

testCase("发布前标题为空：就地提示「请填写笔记标题」，不发请求", async () => {
  const ctx = loadNoteEdit({ pathname: "/notes/new", responder: responderFor({}) });
  await flush();

  ctx.els.title.value = "   ";
  await ctx.els.publish.fire("click");
  await flush();

  checkEq(ctx.els["editor-error"].textContent, "请填写笔记标题", "就地提示文案");
  checkEq(ctx.requests.filter((r) => r.url.indexOf("/api/notes") === 0).length, 0, "不得发保存请求");
});

testCase("发布成功：以 published 提交并跳转详情页", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/new",
    responder: responderFor({
      "POST /api/notes": jsonResponse(201, { code: "OK", message: "操作成功", data: { id: 9 } }),
    }),
  });
  await flush();

  ctx.els.title.value = "发布标题";
  ctx.els.content.value = "正文";
  await ctx.els.publish.fire("click");
  await flush();

  const posts = ctx.requests.filter((r) => r.url === "/api/notes" && r.opts.method === "POST");
  checkEq(posts.length, 1, "应有一次发布请求");
  checkEq(bodyOf(posts[0]).status, "published", "发布应以 published 提交");
  checkEq(ctx.sandbox.location.href, "/notes/9", "发布成功应跳转详情页");
});

// ---------------------------------------------------------------------------
// 用例：失败提示
// ---------------------------------------------------------------------------

testCase("保存失败：就地展示后端 message 且不提示已保存", async () => {
  const ctx = loadNoteEdit({
    pathname: "/notes/new",
    responder: responderFor({
      "POST /api/notes": jsonResponse(400, {
        code: "INVALID_PARAMS",
        message: "请求参数不完整或格式不正确",
        data: null,
      }),
    }),
  });
  await flush();

  ctx.els.content.value = "x";
  await ctx.els["save-draft"].fire("click");
  await flush();

  checkEq(ctx.els["editor-error"].textContent, "请求参数不完整或格式不正确", "应展示后端 message");
  checkEq(ctx.els["editor-error"].hidden, false, "错误应可见");
  checkEq(ctx.els["editor-notice"].hidden, true, "失败时不得显示「已保存草稿」");
  checkEq(ctx.els["save-draft"].disabled, false, "失败后按钮应恢复可点");
});

// ---------------------------------------------------------------------------
// 用例：移动端标签
// ---------------------------------------------------------------------------

testCase("点击「预览」标签把容器切到 data-mode=preview", async () => {
  const ctx = loadNoteEdit({ pathname: "/notes/new", responder: responderFor({}) });
  await flush();

  await ctx.tabPreview.fire("click");
  checkEq(ctx.split.getAttribute("data-mode"), "preview", "容器应切到预览模式");
  checkEq(ctx.tabPreview.classList.contains("is-active"), true, "当前标签应有 .is-active");
  checkEq(ctx.tabs[0].classList.contains("is-active"), false, "另一标签应移除 .is-active");
});

// ---------------------------------------------------------------------------
// 用例：容错
// ---------------------------------------------------------------------------

testCase("页面上没有编辑容器时 note_edit.js 不抛异常", () => {
  const sandbox = {
    console,
    location: { href: "/", pathname: "/" },
    history: { replaceState: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      execCommand: undefined,
    },
    fetch: () => Promise.reject(new Error("不应发起请求")),
    md: { render: () => "" },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(EDITOR_JS, "utf-8"), sandbox, { filename: "editor.js" });
  vm.runInContext(fs.readFileSync(NOTE_EDIT_JS, "utf-8"), sandbox, { filename: "note_edit.js" });
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
