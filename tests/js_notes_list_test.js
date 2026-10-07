// 个人笔记 —— 笔记列表页交互 static/js/notes_list.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_notes_list_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：加载真实 api.js + notes_list.js，用最小 DOM 替身驱动；
// 断言「三态筛选、卡片渲染、三态空状态、登录态失效跳转、错误就地提示」等行为。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const NOTES_LIST_JS = path.join(__dirname, "..", "static", "js", "notes_list.js");

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

function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    attrs: {},
    classes: new Set(),
    hidden: false,
    href: "",
    className: "",
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    getAttribute(name) {
      return el.attrs[name] === undefined ? null : el.attrs[name];
    },
    addEventListener(type, fn) {
      (el.handlers[type] = el.handlers[type] || []).push(fn);
    },
    handlers: {},
    fire(type, event) {
      const calls = (el.handlers[type] || []).map((fn) => fn(event || { type }));
      return Promise.all(calls);
    },
  };
  Object.defineProperty(el, "textContent", {
    get() {
      return el._text === undefined ? "" : el._text;
    },
    set(value) {
      el._text = value;
      if (value === "") el.children.length = 0;
    },
  });
  el.classList = {
    add: (c) => el.classes.add(c),
    remove: (c) => el.classes.delete(c),
    contains: (c) => el.classes.has(c),
    toggle: () => {},
  };
  return el;
}

function findByClass(el, cls) {
  return (
    el.children.find(
      (child) => (child.className || "").split(" ").indexOf(cls) !== -1
    ) || null
  );
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
 * 载入真实 api.js + notes_list.js。
 * @param {(url: string, opts: object) => object} responder
 */
function loadNotesList(responder) {
  const requests = [];
  const listEl = makeEl("ul");
  const emptyEl = makeEl("div");
  emptyEl.hidden = true;
  const emptyText = makeEl("p");
  const emptyAction = makeEl("a");
  const errorEl = makeEl("p");
  errorEl.hidden = true;

  const filterButtons = ["all", "published", "draft"].map((value) => {
    const button = makeEl("button");
    button.setAttribute("data-status", value);
    button.textContent = value;
    if (value === "all") button.classList.add("is-active");
    return button;
  });

  const sandbox = {
    console,
    location: { href: "/notes", pathname: "/notes" },
    document: {
      createElement: (tag) => makeEl(tag),
      getElementById: (id) => {
        if (id === "notes-list") return listEl;
        if (id === "notes-error") return errorEl;
        if (id === "notes-empty") return emptyEl;
        if (id === "notes-empty-text") return emptyText;
        if (id === "notes-empty-action") return emptyAction;
        return null;
      },
      querySelectorAll: (selector) =>
        selector === ".filter-bar button" ? filterButtons : [],
      getElementByIdOrNull: () => null,
    },
    fetch: (url, opts) => {
      requests.push({ url, opts });
      return Promise.resolve(responder(url, opts));
    },
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(NOTES_LIST_JS, "utf-8"), sandbox, {
    filename: "notes_list.js",
  });

  return {
    sandbox,
    requests,
    listEl,
    emptyEl,
    emptyText,
    emptyAction,
    errorEl,
    filterButtons,
  };
}

function notePayload(notes) {
  return { code: "OK", message: "操作成功", data: { notes } };
}

const NOTES = [
  {
    id: 2,
    title: "已发布的笔记",
    status: "published",
    updated_at: "2026-10-07T10:00:00Z",
    created_at: "2026-10-07T09:00:00Z",
    excerpt: "正文摘要",
  },
  {
    id: 1,
    title: "",
    status: "draft",
    updated_at: "2026-10-06T10:00:00Z",
    created_at: "2026-10-06T09:00:00Z",
    excerpt: "",
  },
];

// ---------------------------------------------------------------------------
// 用例：加载与渲染
// ---------------------------------------------------------------------------

testCase("加载时按默认 all 拉取列表并渲染卡片", async () => {
  const ctx = loadNotesList(() => jsonResponse(200, notePayload(NOTES)));
  await flush();

  checkEq(ctx.requests.length, 1, "应有一次请求");
  checkEq(ctx.requests[0].url, "/api/notes?status=all", "默认筛选应为 all");
  checkEq(ctx.requests[0].opts.method, "GET", "列表使用 GET");
  checkEq(ctx.listEl.children.length, 2, "应渲染两条卡片");

  const first = ctx.listEl.children[0];
  const title = findByClass(first, "note-card-title");
  checkEq(title.href, "/notes/2", "标题应链接到详情页");
  checkEq(title.textContent, "已发布的笔记", "标题文字");
  checkEq(findByClass(first, "note-badge").textContent, "已发布", "已发布徽标文案");
  checkEq(findByClass(first, "note-card-excerpt").textContent, "正文摘要", "摘要文字");
  checkEq(
    findByClass(first, "note-card-time").textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "更新时间应为本地时间字符串"
  );

  const actions = findByClass(first, "note-card-actions");
  checkEq(actions.children[0].href, "/notes/2/edit", "「编辑」链接");
  checkEq(actions.children[0].textContent, "编辑", "「编辑」文案");
  checkEq(actions.children[1].href, "/notes/2", "「查看」链接");
  checkEq(actions.children[1].textContent, "查看", "「查看」文案");
});

testCase("草稿无标题时显示「无标题」，徽标为「草稿」", async () => {
  const ctx = loadNotesList(() => jsonResponse(200, notePayload(NOTES)));
  await flush();

  const draft = ctx.listEl.children[1];
  checkEq(findByClass(draft, "note-card-title").textContent, "无标题", "草稿无标题回退文案");
  checkEq(findByClass(draft, "note-badge").textContent, "草稿", "草稿徽标文案");
});

// ---------------------------------------------------------------------------
// 用例：三态筛选
// ---------------------------------------------------------------------------

testCase("点击筛选按钮按 status 重新拉取，且不整页刷新", async () => {
  const ctx = loadNotesList((url) =>
    jsonResponse(200, notePayload(url.indexOf("draft") !== -1 ? [NOTES[1]] : NOTES))
  );
  await flush();

  const draftButton = ctx.filterButtons.find(
    (button) => button.getAttribute("data-status") === "draft"
  );
  await draftButton.fire("click");
  await flush();

  checkEq(ctx.requests.length, 2, "筛选应触发第二次请求");
  checkEq(ctx.requests[1].url, "/api/notes?status=draft", "应按 draft 拉取");
  checkEq(ctx.listEl.children.length, 1, "应只渲染草稿");
  checkEq(ctx.sandbox.location.href, "/notes", "筛选不得整页跳转");
  checkEq(draftButton.classList.contains("is-active"), true, "当前筛选应加 .is-active");
  checkEq(
    ctx.filterButtons.find((b) => b.getAttribute("data-status") === "all").classList.contains("is-active"),
    false,
    "其余筛选应移除 .is-active"
  );
});

// ---------------------------------------------------------------------------
// 用例：三态空状态
// ---------------------------------------------------------------------------

testCase("三态空状态文案与「写笔记」按钮可见性正确", async () => {
  const cases_ = [
    ["all", "还没有笔记，写下第一条吧", false],
    ["draft", "草稿箱是空的", true],
    ["published", "还没有发布的笔记", true],
  ];

  for (const [status, copy, actionHidden] of cases_) {
    const ctx = loadNotesList(() => jsonResponse(200, notePayload([])));
    await flush();

    if (status !== "all") {
      const button = ctx.filterButtons.find(
        (b) => b.getAttribute("data-status") === status
      );
      await button.fire("click");
      await flush();
    }

    checkEq(ctx.emptyEl.hidden, false, `${status} 空列表应显示空状态`);
    checkEq(ctx.emptyText.textContent, copy, `${status} 空状态文案`);
    checkEq(
      ctx.emptyAction.hidden,
      actionHidden,
      `${status} 空状态的「写笔记」按钮可见性`
    );
    checkEq(ctx.listEl.hidden, true, `${status} 空列表应隐藏列表容器`);
  }
});

// ---------------------------------------------------------------------------
// 用例：失败处理
// ---------------------------------------------------------------------------

testCase("未登录（AUTH_REQUIRED）时跳转 /login", async () => {
  const ctx = loadNotesList(() =>
    jsonResponse(401, { code: "AUTH_REQUIRED", message: "请先登录", data: null })
  );
  await flush();

  checkEq(ctx.sandbox.location.href, "/login", "应跳转登录页");
});

testCase("其它失败就地展示后端 message", async () => {
  const ctx = loadNotesList(() =>
    jsonResponse(500, { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试", data: null })
  );
  await flush();

  checkEq(ctx.errorEl.textContent, "服务器内部错误，请稍后重试", "应展示后端 message");
  checkEq(ctx.errorEl.hidden, false, "错误应可见");
  checkEq(ctx.sandbox.location.href, "/notes", "非登录态失败不应跳转");
});

// ---------------------------------------------------------------------------
// 用例：容错
// ---------------------------------------------------------------------------

testCase("页面上没有列表容器时 notes_list.js 不抛异常", () => {
  const sandbox = {
    console,
    location: { href: "/", pathname: "/" },
    document: {
      createElement: (tag) => makeEl(tag),
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    fetch: () => Promise.reject(new Error("不应发起请求")),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(NOTES_LIST_JS, "utf-8"), sandbox, {
    filename: "notes_list.js",
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
