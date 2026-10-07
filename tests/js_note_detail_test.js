// 个人笔记 —— 详情页交互 static/js/note_detail.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_note_detail_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：加载真实 api.js + note_detail.js，用最小 DOM 替身驱动；
// 正文渲染经 window.md.render（打桩记录），因此无需浏览器即可断言
// 「渲染、收藏切换、删除二次确认、错误态与返回链接」等行为。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const NOTE_DETAIL_JS = path.join(__dirname, "..", "static", "js", "note_detail.js");

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
  const el = {
    textContent: options.textContent || "",
    innerHTML: "",
    value: options.value || "",
    hidden: options.hidden === undefined ? true : options.hidden,
    disabled: false,
    href: options.href || "",
    classes,
    handlers,
    select() {
      el.selected = true;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    getAttribute(name) {
      return attrs[name] === undefined ? null : attrs[name];
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
      toggle: () => {},
    },
  };
  return el;
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
 * 载入真实 api.js + note_detail.js。
 * @param {object} options
 * @param {string} options.pathname
 * @param {boolean} options.confirmAnswer  window.confirm 的返回值
 * @param {(url: string, opts: object) => object} options.responder
 */
function loadNoteDetail(options) {
  const opts = options || {};
  const pathname = opts.pathname || "/notes/7";
  const requests = [];
  const confirmCalls = [];

  const els = {
    "note-title": makeEl({}),
    "note-meta": makeEl({}),
    "note-time": makeEl({}),
    "note-body": makeEl({}),
    "note-actions": makeEl({ hidden: true }),
    "note-error": makeEl({ hidden: true }),
    "note-back": makeEl({ hidden: true }),
    "favorite-btn": makeEl({}),
    "favorite-label": makeEl({ textContent: "收藏" }),
    "share-btn": makeEl({}),
    "edit-btn": makeEl({ href: "#" }),
    "delete-btn": makeEl({}),
    comments: makeEl({}),
    // 分享面板（Phase 4 任务 1）
    "share-panel": makeEl({ hidden: true }),
    "share-password": makeEl({ value: "" }),
    "share-generate": makeEl({}),
    "share-result": makeEl({ hidden: true }),
    "share-url": makeEl({ value: "" }),
    "share-copy": makeEl({ textContent: "复制链接" }),
    "share-cancel": makeEl({}),
    "share-error": makeEl({ hidden: true }),
  };
  els["favorite-btn"].setAttribute("aria-pressed", "false");

  const timers = [];
  const cleared = [];
  const clipboard = { written: [] };

  const sandbox = {
    console,
    location: { href: pathname, pathname, origin: "https://notes.test" },
    confirm(message) {
      confirmCalls.push(message);
      return opts.confirmAnswer === undefined ? true : opts.confirmAnswer;
    },
    navigator: {
      clipboard: {
        writeText(text) {
          clipboard.written.push(text);
          return opts.clipboardFails ? Promise.reject(new Error("denied")) : Promise.resolve();
        },
      },
    },
    document: {
      getElementById: (id) => els[id] || null,
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      cleared.push(id);
    },
    fetch: (url, requestOptions) => {
      requests.push({ url, opts: requestOptions });
      return Promise.resolve(opts.responder(url, requestOptions));
    },
    md: {
      render(src) {
        return "[MD]" + (src === undefined ? "" : src);
      },
    },
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(NOTE_DETAIL_JS, "utf-8"), sandbox, {
    filename: "note_detail.js",
  });

  return { sandbox, els, requests, confirmCalls, timers, cleared, clipboard };
}

function notePayload(note) {
  return { code: "OK", message: "操作成功", data: { note } };
}

const NOTE = {
  id: 7,
  title: "我的笔记",
  content_md: "# 正文",
  status: "published",
  created_at: "2026-10-07T09:00:00Z",
  updated_at: "2026-10-07T10:00:00Z",
  published_at: "2026-10-07T09:30:00Z",
  favorited: false,
};

// ---------------------------------------------------------------------------
// 用例：渲染
// ---------------------------------------------------------------------------

testCase("加载成功：渲染标题、更新时间、正文与编辑链接", async () => {
  const ctx = loadNoteDetail({
    responder: () => jsonResponse(200, notePayload(NOTE)),
  });
  await flush();

  checkEq(ctx.requests[0].url, "/api/notes/7", "应读取笔记详情");
  checkEq(ctx.requests[0].opts.method, "GET", "详情使用 GET");
  checkEq(ctx.els["note-title"].textContent, "我的笔记", "标题");
  checkEq(
    ctx.els["note-time"].textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "更新时间应为本地时间字符串"
  );
  checkEq(ctx.els["note-body"].innerHTML, "[MD]# 正文", "正文应经 window.md.render 渲染");
  checkEq(ctx.els["note-actions"].hidden, false, "操作条应可见");
  checkEq(ctx.els["edit-btn"].href, "/notes/7/edit", "编辑链接应指向编辑页");
  checkEq(ctx.els["favorite-btn"].getAttribute("aria-pressed"), "false", "默认未收藏");
  checkEq(ctx.els["favorite-label"].textContent, "收藏", "默认按钮文案");
});

testCase("无标题笔记显示「无标题」", async () => {
  const ctx = loadNoteDetail({
    responder: () => jsonResponse(200, notePayload(Object.assign({}, NOTE, { title: "" }))),
  });
  await flush();

  checkEq(ctx.els["note-title"].textContent, "无标题", "空标题回退文案");
});

testCase("已收藏的笔记：按钮为按下态且文案为「已收藏」", async () => {
  const ctx = loadNoteDetail({
    responder: () => jsonResponse(200, notePayload(Object.assign({}, NOTE, { favorited: true }))),
  });
  await flush();

  checkEq(ctx.els["favorite-btn"].getAttribute("aria-pressed"), "true", "aria-pressed 应为 true");
  checkEq(ctx.els["favorite-label"].textContent, "已收藏", "按钮文案");
  checkEq(ctx.els["favorite-btn"].classList.contains("is-favorited"), true, "应加实心态样式类");
});

// ---------------------------------------------------------------------------
// 用例：收藏
// ---------------------------------------------------------------------------

testCase("点击收藏：POST 收藏接口并按返回的 favorited 切换按钮态", async () => {
  const ctx = loadNoteDetail({
    responder: (url, opts) => {
      if (url === "/api/notes/7/favorite") {
        return jsonResponse(200, { code: "OK", message: "操作成功", data: { favorited: true } });
      }
      return jsonResponse(200, notePayload(NOTE));
    },
  });
  await flush();

  await ctx.els["favorite-btn"].fire("click");
  await flush();

  const posts = ctx.requests.filter((r) => r.url === "/api/notes/7/favorite");
  checkEq(posts.length, 1, "应调用一次收藏接口");
  checkEq(posts[0].opts.method, "POST", "收藏应使用 POST");
  checkEq(ctx.els["favorite-btn"].getAttribute("aria-pressed"), "true", "应切换为按下态");
  checkEq(ctx.els["favorite-label"].textContent, "已收藏", "按钮文案应更新");
});

testCase("收藏失败：就地展示后端 message，按钮态不变", async () => {
  const ctx = loadNoteDetail({
    responder: (url) =>
      url === "/api/notes/7/favorite"
        ? jsonResponse(404, { code: "NOTE_NOT_FOUND", message: "笔记不存在", data: null })
        : jsonResponse(200, notePayload(NOTE)),
  });
  await flush();

  await ctx.els["favorite-btn"].fire("click");
  await flush();

  checkEq(ctx.els["note-error"].textContent, "笔记不存在", "应展示后端 message");
  checkEq(ctx.els["note-error"].hidden, false, "错误应可见");
  checkEq(ctx.els["favorite-btn"].getAttribute("aria-pressed"), "false", "失败时按钮态不应改变");
});

// ---------------------------------------------------------------------------
// 用例：删除（二次确认）
// ---------------------------------------------------------------------------

testCase("删除先二次确认，确认后 DELETE 并跳回列表", async () => {
  const ctx = loadNoteDetail({
    responder: (url, opts) =>
      opts.method === "DELETE"
        ? jsonResponse(200, { code: "OK", message: "操作成功", data: null })
        : jsonResponse(200, notePayload(NOTE)),
  });
  await flush();

  await ctx.els["delete-btn"].fire("click");
  await flush();

  checkEq(ctx.confirmCalls.length, 1, "应弹二次确认");
  checkEq(ctx.confirmCalls[0], "删除后无法恢复，确定要删除这篇笔记吗？", "确认文案逐字一致");
  const deletes = ctx.requests.filter((r) => r.opts.method === "DELETE");
  checkEq(deletes.length, 1, "确认后应发起删除请求");
  checkEq(deletes[0].url, "/api/notes/7", "删除路径");
  checkEq(ctx.sandbox.location.href, "/notes", "删除成功应跳回列表");
});

testCase("删除时取消确认：不发起任何删除请求", async () => {
  const ctx = loadNoteDetail({
    confirmAnswer: false,
    responder: (url, opts) =>
      opts.method === "DELETE"
        ? jsonResponse(200, { code: "OK", message: "操作成功", data: null })
        : jsonResponse(200, notePayload(NOTE)),
  });
  await flush();

  await ctx.els["delete-btn"].fire("click");
  await flush();

  checkEq(ctx.confirmCalls.length, 1, "应弹二次确认");
  checkEq(ctx.requests.filter((r) => r.opts.method === "DELETE").length, 0, "取消时不得删除");
  checkEq(ctx.sandbox.location.href, "/notes/7", "取消时应留在详情页");
});

testCase("删除失败：就地展示后端 message 且不跳转", async () => {
  const ctx = loadNoteDetail({
    responder: (url, opts) =>
      opts.method === "DELETE"
        ? jsonResponse(500, { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试", data: null })
        : jsonResponse(200, notePayload(NOTE)),
  });
  await flush();

  await ctx.els["delete-btn"].fire("click");
  await flush();

  checkEq(ctx.els["note-error"].textContent, "服务器内部错误，请稍后重试", "应展示后端 message");
  checkEq(ctx.sandbox.location.href, "/notes/7", "失败时不应跳转");
});

// ---------------------------------------------------------------------------
// 用例：分享面板（Phase 4 任务 1）
// ---------------------------------------------------------------------------

const SHARE_OK = { code: "OK", message: "操作成功", data: { token: "tok-1", url: "/share/tok-1", has_password: false } };

function shareResponder(url, opts) {
  if (url === "/api/notes/7/share" && opts.method === "POST") return jsonResponse(200, SHARE_OK);
  if (url === "/api/notes/7/share" && opts.method === "DELETE") {
    return jsonResponse(200, { code: "OK", message: "操作成功", data: null });
  }
  return jsonResponse(200, notePayload(NOTE));
}

testCase("点击「分享」展开分享面板", async () => {
  const ctx = loadNoteDetail({ responder: shareResponder });
  await flush();

  checkEq(ctx.els["share-panel"].hidden, true, "面板默认隐藏");
  await ctx.els["share-btn"].fire("click");
  checkEq(ctx.els["share-panel"].hidden, false, "点击后应展开面板");
});

testCase("生成分享链接：POST 后写入完整 URL 并显示结果区", async () => {
  const ctx = loadNoteDetail({ responder: shareResponder });
  await flush();

  ctx.els["share-password"].value = "pass1234";
  await ctx.els["share-generate"].fire("click");
  await flush();

  const posts = ctx.requests.filter((r) => r.url === "/api/notes/7/share" && r.opts.method === "POST");
  checkEq(posts.length, 1, "应调用一次生成分享接口");
  checkEq(JSON.parse(posts[0].opts.body).password, "pass1234", "请求体应含输入的密码");
  checkEq(ctx.els["share-url"].value, "https://notes.test/share/tok-1", "应写入 origin + 相对 url");
  checkEq(ctx.els["share-result"].hidden, false, "结果区应显示");
  checkEq(ctx.els["share-error"].hidden, true, "成功时不应显示错误");
});

testCase("生成失败（密码过短）：就地展示后端 message", async () => {
  const ctx = loadNoteDetail({
    responder: (url, opts) =>
      url === "/api/notes/7/share" && opts.method === "POST"
        ? jsonResponse(400, { code: "INVALID_PARAMS", message: "请求参数不完整或格式不正确", data: null })
        : shareResponder(url, opts),
  });
  await flush();

  ctx.els["share-password"].value = "123";
  await ctx.els["share-generate"].fire("click");
  await flush();

  checkEq(ctx.els["share-error"].textContent, "请求参数不完整或格式不正确", "应展示后端 message");
  checkEq(ctx.els["share-error"].hidden, false, "错误应可见");
  checkEq(ctx.els["share-result"].hidden, true, "失败时结果区不应显示");
});

testCase("复制链接：写入剪贴板并把按钮文案改为「链接已复制」，2 秒后还原", async () => {
  const ctx = loadNoteDetail({ responder: shareResponder });
  await flush();

  await ctx.els["share-generate"].fire("click");
  await flush();

  await ctx.els["share-copy"].fire("click");
  await flush();

  checkEq(ctx.clipboard.written.length, 1, "应写入剪贴板一次");
  checkEq(ctx.clipboard.written[0], "https://notes.test/share/tok-1", "写入的应为完整链接");
  checkEq(ctx.els["share-copy"].textContent, "链接已复制", "按钮文案应变为「链接已复制」");
  checkEq(ctx.timers.length, 1, "应调度一次还原定时器");
  checkEq(ctx.timers[0].ms, 2000, "2 秒后还原");

  ctx.timers[0].fn();
  checkEq(ctx.els["share-copy"].textContent, "复制链接", "定时器触发后应还原按钮文案");
});

testCase("取消分享：二次确认后 DELETE 并隐藏结果区", async () => {
  const ctx = loadNoteDetail({ responder: shareResponder });
  await flush();

  await ctx.els["share-generate"].fire("click");
  await flush();
  checkEq(ctx.els["share-result"].hidden, false, "前置：结果区已显示");

  await ctx.els["share-cancel"].fire("click");
  await flush();

  checkEq(ctx.confirmCalls.length, 1, "应弹二次确认");
  checkEq(ctx.confirmCalls[0], "取消后原链接将失效，确定吗？", "确认文案逐字一致");
  const deletes = ctx.requests.filter((r) => r.url === "/api/notes/7/share" && r.opts.method === "DELETE");
  checkEq(deletes.length, 1, "确认后应发起取消分享请求");
  checkEq(ctx.els["share-result"].hidden, true, "成功后结果区应隐藏");
});

testCase("取消分享时放弃确认：不发起请求", async () => {
  const ctx = loadNoteDetail({ confirmAnswer: false, responder: shareResponder });
  await flush();

  await ctx.els["share-cancel"].fire("click");
  await flush();

  checkEq(ctx.confirmCalls.length, 1, "应弹二次确认");
  checkEq(
    ctx.requests.filter((r) => r.url === "/api/notes/7/share" && r.opts.method === "DELETE").length,
    0,
    "放弃确认时不得发起请求"
  );
});

// ---------------------------------------------------------------------------
// 用例：错误态
// ---------------------------------------------------------------------------

testCase("笔记不存在：整页显示 message、隐藏操作条与正文、给出返回链接", async () => {
  const ctx = loadNoteDetail({
    responder: () => jsonResponse(404, { code: "NOTE_NOT_FOUND", message: "笔记不存在", data: null }),
  });
  await flush();

  checkEq(ctx.els["note-title"].textContent, "笔记不存在", "标题位置应显示 message");
  checkEq(ctx.els["note-back"].hidden, false, "应显示「返回我的笔记」链接");
  checkEq(ctx.els["note-actions"].hidden, true, "操作条应隐藏");
  checkEq(ctx.els["note-body"].hidden, true, "正文应隐藏");
  checkEq(ctx.els["note-meta"].hidden, true, "更新时间应隐藏");
});

testCase("未登录（AUTH_REQUIRED）时跳转 /login", async () => {
  const ctx = loadNoteDetail({
    responder: () => jsonResponse(401, { code: "AUTH_REQUIRED", message: "请先登录", data: null }),
  });
  await flush();

  checkEq(ctx.sandbox.location.href, "/login", "应跳转登录页");
});

// ---------------------------------------------------------------------------
// 用例：容错
// ---------------------------------------------------------------------------

testCase("页面上没有详情容器时 note_detail.js 不抛异常", () => {
  const sandbox = {
    console,
    location: { href: "/", pathname: "/" },
    confirm: () => true,
    document: { getElementById: () => null },
    fetch: () => Promise.reject(new Error("不应发起请求")),
    md: { render: () => "" },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(NOTE_DETAIL_JS, "utf-8"), sandbox, {
    filename: "note_detail.js",
  });
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
