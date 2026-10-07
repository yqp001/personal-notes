// 个人笔记 —— 个人主页交互 static/js/profile.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_profile_test.js
// 退出码：全部通过为 0，任一检查失败为 1。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const PROFILE_JS = path.join(__dirname, "..", "static", "js", "profile.js");

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

function makeField(value) {
  const attrs = {};
  return {
    value,
    setAttribute(name, val) {
      attrs[name] = val;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    getAttribute(name) {
      return attrs[name];
    },
  };
}

function makeForm(values) {
  const elements = {};
  for (const [name, value] of Object.entries(values || {})) {
    elements[name] = makeField(value);
  }
  const errorEl = { textContent: "", className: "", hidden: true };
  const noticeEl = { textContent: "", hidden: true };
  const button = { textContent: "保存修改", disabled: false };
  const handlers = {};
  const form = {
    elements,
    querySelector: (selector) => {
      if (selector === "[data-error]") return errorEl;
      if (selector === "[data-notice]") return noticeEl;
      if (selector === 'button[type="submit"]') return button;
      return null;
    },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
  };
  return { form, errorEl, noticeEl, button, handlers, elements };
}

/** 最小 DOM 节点替身（用于「我的收藏 / 我的笔记 / 分享管理」列表渲染断言）。 */
function makeNode(tag) {
  const attrs = {};
  const handlers = {};
  const node = {
    tagName: tag,
    children: [],
    className: "",
    href: "",
    hidden: false,
    disabled: false,
    type: "",
    target: "",
    rel: "",
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
      return Promise.all((handlers[type] || []).map((fn) => fn(event || { type })));
    },
    appendChild(child) {
      node.children.push(child);
      return child;
    },
  };
  Object.defineProperty(node, "textContent", {
    get() {
      return node._text === undefined ? "" : node._text;
    },
    set(value) {
      node._text = value;
      if (value === "") node.children.length = 0;
    },
  });
  return node;
}

/**
 * 载入真实 api.js + profile.js。
 * @param {(url: string, opts: object) => object} responder
 * @param {object} [extraElements] getElementById 的补充映射（如收藏区节点）
 */
function loadProfile(values, responder, extraElements) {
  const requests = [];
  const timers = [];
  const cleared = [];
  const extras = extraElements || {};
  const parts = makeForm(values);
  const sandbox = {
    console,
    location: { href: "/profile", origin: "https://notes.test" },
    navigator: {
      clipboard: {
        writeText() {
          return Promise.resolve();
        },
      },
    },
    document: {
      querySelector: (selector) => (selector === "form[data-profile-form]" ? parts.form : null),
      getElementById: (id) => (extras[id] === undefined ? null : extras[id]),
      createElement: (tag) => makeNode(tag),
    },
    fetch: (url, opts) => {
      requests.push({ url, opts });
      return Promise.resolve(responder(url, opts));
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      cleared.push(id);
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(PROFILE_JS, "utf-8"), sandbox, { filename: "profile.js" });
  return { sandbox, requests, timers, cleared, ...parts };
}

function submit(handlers) {
  let prevented = false;
  const result = handlers.submit({ preventDefault: () => { prevented = true; } });
  return { result, wasPrevented: () => prevented };
}

// 加载时会用 /api/auth/me 回填表单，因此需要断言「用户改写后的值」时在加载完成后手动设值。
function setValues(ctx, values) {
  for (const [name, value] of Object.entries(values)) {
    ctx.elements[name].value = value;
  }
}

const ME_OK = {
  code: "OK",
  message: "操作成功",
  data: { user: { id: 1, email: "a@b.com", username: "阿黎", bio: "记录生活" } },
};

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

testCase("加载时用 /api/auth/me 回填用户名与简介", async () => {
  const ctx = loadProfile({ username: "", bio: "" }, () => jsonResponse(200, ME_OK));
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.requests.length, 1, "加载请求次数");
  checkEq(ctx.requests[0].url, "/api/auth/me", "应读取当前用户");
  checkEq(ctx.requests[0].opts.method, "GET", "方法");
  checkEq(ctx.elements.username.value, "阿黎", "用户名应被回填");
  checkEq(ctx.elements.bio.value, "记录生活", "简介应被回填");
});

testCase("保存成功：PUT /api/profile 并提示「已保存」，2 秒后消失", async () => {
  const ctx = loadProfile(
    { username: "阿黎改名", bio: "记录生活" },
    (url) =>
      url === "/api/profile"
        ? jsonResponse(200, { code: "OK", message: "操作成功", data: { user: { username: "阿黎改名" } } })
        : jsonResponse(200, ME_OK)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  setValues(ctx, { username: "阿黎改名", bio: "记录生活" });

  const saveReq = ctx.requests.filter((r) => r.url === "/api/profile");
  const { result, wasPrevented } = submit(ctx.handlers);
  await result;

  check(wasPrevented(), "应阻止表单默认提交");
  checkEq(saveReq.length, 0, "提交前不应已有保存请求");
  const put = ctx.requests.filter((r) => r.url === "/api/profile");
  checkEq(put.length, 1, "保存请求次数");
  checkEq(put[0].opts.method, "PUT", "保存应使用 PUT");
  const body = JSON.parse(put[0].opts.body);
  checkEq(body.username, "阿黎改名", "请求体 username");
  checkEq(body.bio, "记录生活", "请求体 bio");

  checkEq(ctx.noticeEl.textContent, "已保存", "成功提示文案");
  checkEq(ctx.noticeEl.hidden, false, "成功提示应可见");
  checkEq(ctx.errorEl.hidden, true, "成功时不应显示错误提示");
  checkEq(ctx.timers.length, 1, "应调度一次消失定时器");
  checkEq(ctx.timers[0].ms, 2000, "提示应在 2 秒后消失");

  ctx.timers[0].fn();
  checkEq(ctx.noticeEl.textContent, "", "定时器触发后应清空提示");
  checkEq(ctx.noticeEl.hidden, true, "定时器触发后应隐藏提示");
});

testCase("保存失败：就地展示后端 message，且不提示已保存", async () => {
  const ctx = loadProfile(
    { username: "x", bio: "" },
    (url) =>
      url === "/api/profile"
        ? jsonResponse(400, { code: "INVALID_PARAMS", message: "请求参数不完整或格式不正确", data: null })
        : jsonResponse(200, ME_OK)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  setValues(ctx, { username: "x", bio: "" });

  await submit(ctx.handlers).result;

  checkEq(ctx.errorEl.textContent, "请求参数不完整或格式不正确", "应展示后端 message");
  checkEq(ctx.errorEl.hidden, false, "错误提示应可见");
  checkEq(ctx.noticeEl.hidden, true, "失败时不得显示「已保存」");
  checkEq(ctx.button.disabled, false, "失败后按钮应恢复可点");
});

testCase("空用户名被前端拦下，不发保存请求", async () => {
  const ctx = loadProfile({ username: "   ", bio: "" }, () => jsonResponse(200, ME_OK));
  await new Promise((resolve) => setTimeout(resolve, 0));
  setValues(ctx, { username: "   " });

  const { wasPrevented } = submit(ctx.handlers);
  await new Promise((resolve) => setTimeout(resolve, 0));

  check(wasPrevented(), "应阻止提交");
  checkEq(ctx.requests.filter((r) => r.url === "/api/profile").length, 0, "不得发保存请求");
  checkEq(ctx.errorEl.textContent, "请输入用户名", "就地提示");
});

testCase("保存过程中按钮禁用并显示「保存中…」", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = loadProfile(
    { username: "阿黎", bio: "" },
    (url) =>
      url === "/api/profile"
        ? { status: 200, ok: true, json: () => pending }
        : jsonResponse(200, ME_OK)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { result } = submit(ctx.handlers);
  checkEq(ctx.button.disabled, true, "保存中按钮应禁用");
  check(ctx.button.textContent.indexOf("保存中") !== -1, "保存中按钮文字应为「保存中…」");

  release({ code: "OK", message: "操作成功", data: { user: { username: "阿黎" } } });
  await result;
  checkEq(ctx.button.disabled, false, "保存结束后按钮应恢复");
  checkEq(ctx.button.textContent, "保存修改", "保存结束后按钮文字应复原");
});

// ---------------------------------------------------------------------------
// 用例：我的收藏
// ---------------------------------------------------------------------------

const FAVORITES_URL = "/api/favorites";

function favoritesContext(notes) {
  const listEl = makeNode("ul");
  listEl.hidden = true;
  const emptyEl = makeNode("div");
  emptyEl.hidden = true;
  const ctx = loadProfile(
    { username: "", bio: "" },
    (url) =>
      url === FAVORITES_URL
        ? jsonResponse(200, { code: "OK", message: "操作成功", data: { notes } })
        : jsonResponse(200, ME_OK),
    { "favorites-list": listEl, "favorites-empty": emptyEl }
  );
  return { ctx, listEl, emptyEl };
}

testCase("加载时按 /api/favorites 渲染收藏列表（标题 + 更新时间）", async () => {
  const { ctx, listEl, emptyEl } = favoritesContext([
    {
      id: 3,
      title: "收藏的笔记",
      status: "published",
      created_at: "2026-10-07T09:00:00Z",
      updated_at: "2026-10-07T10:00:00Z",
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const favRequests = ctx.requests.filter((r) => r.url === FAVORITES_URL);
  checkEq(favRequests.length, 1, "应请求一次收藏列表");
  checkEq(favRequests[0].opts.method, "GET", "收藏列表使用 GET");
  checkEq(listEl.hidden, false, "有收藏时应显示列表");
  checkEq(emptyEl.hidden, true, "有收藏时应隐藏空态");
  checkEq(listEl.children.length, 1, "应渲染一条收藏");

  const item = listEl.children[0];
  checkEq(item.children[0].href, "/notes/3", "标题应链接到详情页");
  checkEq(item.children[0].textContent, "收藏的笔记", "标题文字");
  checkEq(
    item.children[1].textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "更新时间应为本地时间字符串"
  );
});

testCase("收藏为空时显示空态、隐藏列表", async () => {
  const { ctx, listEl, emptyEl } = favoritesContext([]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.requests.filter((r) => r.url === FAVORITES_URL).length, 1, "仍应请求收藏列表");
  checkEq(listEl.hidden, true, "空收藏时应隐藏列表");
  checkEq(emptyEl.hidden, false, "空收藏时应显示空态");
  checkEq(listEl.children.length, 0, "空收藏不应渲染条目");
});

testCase("收藏的笔记无标题时显示「无标题」", async () => {
  const { listEl } = favoritesContext([
    { id: 5, title: "", status: "draft", created_at: "", updated_at: "2026-10-07T10:00:00Z" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(listEl.children[0].children[0].textContent, "无标题", "空标题回退文案");
});

testCase("收藏列表未登录时跳转 /login", async () => {
  const listEl = makeNode("ul");
  const emptyEl = makeNode("div");
  const ctx = loadProfile(
    { username: "", bio: "" },
    (url) =>
      url === FAVORITES_URL
        ? jsonResponse(401, { code: "AUTH_REQUIRED", message: "请先登录", data: null })
        : jsonResponse(200, ME_OK),
    { "favorites-list": listEl, "favorites-empty": emptyEl }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.sandbox.location.href, "/login", "应跳转登录页");
});

// ---------------------------------------------------------------------------
// 用例：我的笔记（Phase 4 任务 5 补齐 Phase 3 遗留缺口）
// ---------------------------------------------------------------------------

const NOTES_URL = "/api/notes?status=all";

function notesContext(notes) {
  const listEl = makeNode("ul");
  listEl.hidden = true;
  const emptyEl = makeNode("div");
  emptyEl.hidden = true;
  const ctx = loadProfile(
    { username: "", bio: "" },
    (url) =>
      url === NOTES_URL
        ? jsonResponse(200, { code: "OK", message: "操作成功", data: { notes } })
        : jsonResponse(200, ME_OK),
    { "my-notes-list": listEl, "my-notes-empty": emptyEl }
  );
  return { ctx, listEl, emptyEl };
}

testCase("我的笔记：按 /api/notes?status=all 渲染标题、状态徽标、时间与查看/编辑链接", async () => {
  const { ctx, listEl, emptyEl } = notesContext([
    {
      id: 9,
      title: "我的第一篇",
      status: "published",
      created_at: "2026-10-07T09:00:00Z",
      updated_at: "2026-10-07T10:00:00Z",
      excerpt: "摘要",
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const reqs = ctx.requests.filter((r) => r.url === NOTES_URL);
  checkEq(reqs.length, 1, "应请求一次我的笔记");
  checkEq(reqs[0].opts.method, "GET", "我的笔记使用 GET");
  checkEq(listEl.hidden, false, "有笔记时应显示列表");
  checkEq(emptyEl.hidden, true, "有笔记时应隐藏空态");

  const item = listEl.children[0];
  checkEq(item.children[0].href, "/notes/9", "标题应链接到详情页");
  checkEq(item.children[0].textContent, "我的第一篇", "标题文字");
  checkEq(item.children[1].textContent, "已发布", "状态徽标文案");
  checkEq(
    item.children[1].className,
    "note-badge note-badge-published",
    "「已发布」徽标应用 --primary-strong 的类名"
  );
  checkEq(
    item.children[2].textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "更新时间应为本地时间字符串"
  );
  checkEq(item.children[3].children[0].href, "/notes/9", "查看链接");
  checkEq(item.children[3].children[1].href, "/notes/9/edit", "编辑链接");
});

testCase("我的笔记：草稿徽标用 draft 类、空标题显示「无标题」", async () => {
  const { listEl } = notesContext([
    { id: 4, title: "", status: "draft", created_at: "", updated_at: "2026-10-07T10:00:00Z" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const item = listEl.children[0];
  checkEq(item.children[0].textContent, "无标题", "空标题回退文案");
  checkEq(item.children[1].textContent, "草稿", "草稿徽标文案");
  checkEq(
    item.children[1].className,
    "note-badge note-badge-draft",
    "「草稿」徽标应用 --text-muted 的类名"
  );
});

testCase("我的笔记：为空时显示空态、隐藏列表", async () => {
  const { listEl, emptyEl } = notesContext([]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(listEl.hidden, true, "空时应隐藏列表");
  checkEq(emptyEl.hidden, false, "空时应显示空态");
  checkEq(listEl.children.length, 0, "空时不应渲染条目");
});

// ---------------------------------------------------------------------------
// 用例：分享管理
// ---------------------------------------------------------------------------

const MINE_URL = "/api/share/mine";

function mineShare(overrides) {
  return Object.assign(
    {
      note_id: 9,
      note_title: "分享用笔记",
      token: "tok-1",
      url: "/share/tok-1",
      has_password: true,
      created_at: "2026-10-07T10:00:00Z",
    },
    overrides || {}
  );
}

function sharesContext(shares, responder) {
  const listEl = makeNode("ul");
  listEl.hidden = true;
  const emptyEl = makeNode("div");
  emptyEl.hidden = true;
  const ctx = loadProfile(
    { username: "", bio: "" },
    responder ||
      ((url) =>
        url === MINE_URL
          ? jsonResponse(200, { code: "OK", message: "操作成功", data: { shares } })
          : jsonResponse(200, ME_OK)),
    { "shares-list": listEl, "shares-empty": emptyEl }
  );
  return { ctx, listEl, emptyEl };
}

testCase("分享管理：按 /api/share/mine 渲染标题、密码徽标与时间", async () => {
  const { ctx, listEl, emptyEl } = sharesContext([mineShare()]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const reqs = ctx.requests.filter((r) => r.url === MINE_URL);
  checkEq(reqs.length, 1, "应请求一次分享管理");
  checkEq(reqs[0].opts.method, "GET", "分享管理使用 GET");
  checkEq(listEl.hidden, false, "有分享时应显示列表");
  checkEq(emptyEl.hidden, true, "有分享时应隐藏空态");

  const item = listEl.children[0];
  checkEq(item.children[0].textContent, "分享用笔记", "笔记标题");
  checkEq(item.children[1].textContent, "需要密码", "有密码时的徽标文案");
  checkEq(
    item.children[2].textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "创建时间"
  );
  const actions = item.children[3];
  checkEq(actions.children[0].href, "/share/tok-1", "打开链接应指向分享页");
  checkEq(actions.children[0].textContent, "打开", "打开按钮文案");
  checkEq(actions.children[1].textContent, "复制链接", "复制按钮文案");
  checkEq(actions.children[2].textContent, "取消分享", "取消按钮文案");
});

testCase("分享管理：无密码分享的徽标文案为「无需密码」", async () => {
  const { listEl } = sharesContext([mineShare({ has_password: false })]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(listEl.children[0].children[1].textContent, "无需密码", "无密码徽标文案");
});

testCase("分享管理：空态", async () => {
  const { listEl, emptyEl } = sharesContext([]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(listEl.hidden, true, "空时应隐藏列表");
  checkEq(emptyEl.hidden, false, "空时应显示空态");
});

testCase("取消分享：DELETE 成功后从列表移除，并显示空态", async () => {
  const { ctx, listEl, emptyEl } = sharesContext([mineShare()], (url, opts) => {
    if (url === MINE_URL) {
      return jsonResponse(200, { code: "OK", message: "操作成功", data: { shares: [mineShare()] } });
    }
    if (url === "/api/notes/9/share" && opts.method === "DELETE") {
      return jsonResponse(200, { code: "OK", message: "操作成功", data: null });
    }
    return jsonResponse(200, ME_OK);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  checkEq(listEl.children.length, 1, "前置：列表有 1 条分享");

  const actions = listEl.children[0].children[3];
  await actions.children[2].fire("click");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const deletes = ctx.requests.filter((r) => r.url === "/api/notes/9/share" && r.opts.method === "DELETE");
  checkEq(deletes.length, 1, "应调用取消分享接口");
  checkEq(listEl.children.length, 0, "取消后应从列表移除");
  checkEq(emptyEl.hidden, false, "取消最后一条后应显示空态");
});

testCase("取消分享失败：就地展示后端 message，列表不变", async () => {
  const { ctx, listEl } = sharesContext([mineShare()], (url, opts) => {
    if (url === MINE_URL) {
      return jsonResponse(200, { code: "OK", message: "操作成功", data: { shares: [mineShare()] } });
    }
    if (url === "/api/notes/9/share" && opts.method === "DELETE") {
      return jsonResponse(404, { code: "NOTE_NOT_FOUND", message: "笔记不存在", data: null });
    }
    return jsonResponse(200, ME_OK);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const actions = listEl.children[0].children[3];
  await actions.children[2].fire("click");
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.errorEl.textContent, "笔记不存在", "应展示后端 message");
  checkEq(ctx.errorEl.hidden, false, "错误应可见");
  checkEq(listEl.children.length, 1, "失败时列表不应改变");
});

testCase("页面上没有个人信息表单时 profile.js 不抛异常", () => {
  const sandbox = {
    console,
    location: { href: "/" },
    document: {
      querySelector: () => null,
      getElementById: () => null,
      createElement: (tag) => makeNode(tag),
    },
    fetch: () => Promise.reject(new Error("不应发起请求")),
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(PROFILE_JS, "utf-8"), sandbox, { filename: "profile.js" });
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
