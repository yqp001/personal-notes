// 个人笔记 —— 分享页交互 static/js/share.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_share_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：加载真实 api.js + share.js，用最小 DOM 替身驱动；
// 正文渲染经 window.md.render（打桩记录），因此无需浏览器即可断言
// 「密码锁、无效态、内容渲染、评论列表与提交」等行为。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const SHARE_JS = path.join(__dirname, "..", "static", "js", "share.js");

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

function flush(times) {
  const rounds = times || 8;
  let chain = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) {
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

const OK = (data) => ({ code: "OK", message: "操作成功", data });
const FAIL = (code, message) => ({ code, message, data: null });

/** 最小 DOM 节点替身：支持 textContent 写入时清空子节点、lastElementChild。 */
function makeEl(init) {
  const options = init || {};
  const attrs = {};
  const classes = new Set();
  const handlers = {};
  const children = [];
  const el = {
    _text: options.textContent || "",
    innerHTML: "",
    value: options.value || "",
    hidden: options.hidden === undefined ? true : options.hidden,
    disabled: false,
    className: options.className || "",
    classes,
    handlers,
    children,
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
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: () => {},
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    select() {
      el.selected = true;
    },
    scrollIntoView() {
      el.scrolled = true;
    },
  };
  Object.defineProperty(el, "textContent", {
    get() {
      return el._text;
    },
    set(value) {
      el._text = value;
      if (value === "") children.length = 0;
    },
  });
  Object.defineProperty(el, "lastElementChild", {
    get() {
      return children.length ? children[children.length - 1] : null;
    },
  });
  return el;
}

function notePayload(note) {
  return OK({ note, unlocked: true });
}

function commentPayload(comments) {
  return OK({ comments });
}

const SHARED_NOTE = {
  title: "分享用笔记",
  content_md: "# 分享正文",
  author_username: "分享用户",
  updated_at: "2026-10-07T10:00:00Z",
  has_password: false,
};

/**
 * 载入真实 api.js + share.js。
 * @param {object} options
 * @param {string} options.token
 * @param {(url: string, opts: object) => object} options.responder
 */
function loadShare(options) {
  const opts = options || {};
  const token = opts.token || "tok-1";
  const requests = [];

  const els = {
    "share-lock": makeEl({ hidden: true }),
    "share-content": makeEl({ hidden: true }),
    "share-comments": makeEl({ hidden: true }),
    "share-invalid": makeEl({ hidden: true }),
    "share-title": makeEl({}),
    "share-author": makeEl({}),
    "share-time": makeEl({}),
    "share-body": makeEl({}),
    "unlock-password": makeEl({ value: "" }),
    "unlock-btn": makeEl({}),
    "unlock-error": makeEl({ hidden: true }),
    "comment-list": makeEl({}),
    "comment-empty": makeEl({ hidden: true }),
    "nickname-field": makeEl({ hidden: false }),
    nickname: makeEl({ value: "" }),
    "comment-content": makeEl({ value: "" }),
    "comment-error": makeEl({ hidden: true }),
  };
  const submitBtn = makeEl({ textContent: "发表评论" });
  const commentForm = makeEl({});
  commentForm.querySelector = (selector) =>
    selector === 'button[type="submit"]' ? submitBtn : null;
  els["comment-form"] = commentForm;

  const sandbox = {
    console,
    location: { href: "/share/" + token, pathname: "/share/" + token },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (tag) => makeEl({ className: tag }),
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
  vm.runInContext(fs.readFileSync(SHARE_JS, "utf-8"), sandbox, { filename: "share.js" });

  return { sandbox, els, requests, submitBtn };
}

// ---------------------------------------------------------------------------
// 用例：初始态
// ---------------------------------------------------------------------------

testCase("加锁分享未解锁：只显示密码锁卡片", async () => {
  const ctx = loadShare({
    responder: (url) =>
      url === "/api/share/tok-1"
        ? jsonResponse(401, FAIL("SHARE_PASSWORD_REQUIRED", "该分享需要密码"))
        : jsonResponse(200, OK({ user: null })),
  });
  await flush();

  checkEq(ctx.els["share-lock"].hidden, false, "密码锁应显示");
  checkEq(ctx.els["share-content"].hidden, true, "内容区应隐藏");
  checkEq(ctx.els["share-comments"].hidden, true, "评论区应隐藏");
  checkEq(ctx.els["share-invalid"].hidden, true, "无效态应隐藏");
  checkEq(ctx.requests[0].url, "/api/auth/me", "先读取当前登录态");
  checkEq(ctx.requests[1].url, "/api/share/tok-1", "再读取分享内容");
});

testCase("无效 token：只显示「分享链接无效或已取消」", async () => {
  const ctx = loadShare({
    responder: (url) =>
      url === "/api/share/tok-1"
        ? jsonResponse(404, FAIL("SHARE_NOT_FOUND", "分享链接无效或已取消"))
        : jsonResponse(200, OK({ user: null })),
  });
  await flush();

  checkEq(ctx.els["share-invalid"].hidden, false, "无效态应显示");
  checkEq(ctx.els["share-lock"].hidden, true, "密码锁应隐藏");
  checkEq(ctx.els["share-content"].hidden, true, "内容区应隐藏");
});

testCase("免密分享：渲染标题、作者、时间与正文，并显示评论区", async () => {
  const ctx = loadShare({
    responder: (url) => {
      if (url === "/api/share/tok-1") return jsonResponse(200, notePayload(SHARED_NOTE));
      if (url === "/api/share/tok-1/comments") return jsonResponse(200, commentPayload([]));
      return jsonResponse(200, OK({ user: null }));
    },
  });
  await flush();

  checkEq(ctx.els["share-content"].hidden, false, "内容区应显示");
  checkEq(ctx.els["share-comments"].hidden, false, "评论区应显示");
  checkEq(ctx.els["share-title"].textContent, "分享用笔记", "标题");
  checkEq(ctx.els["share-author"].textContent, "分享用户", "作者用户名");
  checkEq(
    ctx.els["share-time"].textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "更新时间应为本地时间字符串"
  );
  checkEq(ctx.els["share-body"].innerHTML, "[MD]# 分享正文", "正文应经 window.md.render 渲染");
});

testCase("空标题回退为「无标题」", async () => {
  const ctx = loadShare({
    responder: (url) => {
      if (url === "/api/share/tok-1") {
        return jsonResponse(200, notePayload(Object.assign({}, SHARED_NOTE, { title: "" })));
      }
      if (url === "/api/share/tok-1/comments") return jsonResponse(200, commentPayload([]));
      return jsonResponse(200, OK({ user: null }));
    },
  });
  await flush();

  checkEq(ctx.els["share-title"].textContent, "无标题", "空标题回退文案");
});

// ---------------------------------------------------------------------------
// 用例：解锁
// ---------------------------------------------------------------------------

testCase("解锁成功：POST 密码后重新拉取并渲染内容", async () => {
  let unlocked = false;
  const ctx = loadShare({
    responder: (url, opts) => {
      if (url === "/api/share/tok-1/unlock") {
        unlocked = true;
        return jsonResponse(200, OK(null));
      }
      if (url === "/api/share/tok-1") {
        return unlocked
          ? jsonResponse(200, notePayload(SHARED_NOTE))
          : jsonResponse(401, FAIL("SHARE_PASSWORD_REQUIRED", "该分享需要密码"));
      }
      if (url === "/api/share/tok-1/comments") return jsonResponse(200, commentPayload([]));
      return jsonResponse(200, OK({ user: null }));
    },
  });
  await flush();

  checkEq(ctx.els["share-lock"].hidden, false, "前置：显示密码锁");
  ctx.els["unlock-password"].value = "pass1234";
  await ctx.els["unlock-btn"].fire("click");
  await flush();

  const unlocks = ctx.requests.filter((r) => r.url === "/api/share/tok-1/unlock");
  checkEq(unlocks.length, 1, "应调用一次解锁接口");
  checkEq(unlocks[0].opts.method, "POST", "解锁应使用 POST");
  checkEq(JSON.parse(unlocks[0].opts.body).password, "pass1234", "请求体应含输入的密码");
  checkEq(ctx.els["share-content"].hidden, false, "解锁后应显示内容");
  checkEq(ctx.els["share-body"].innerHTML, "[MD]# 分享正文", "解锁后正文应渲染");
});

testCase("解锁失败：就地提示、保留输入框内容、按钮恢复可点", async () => {
  const ctx = loadShare({
    responder: (url) =>
      url === "/api/share/tok-1/unlock"
        ? jsonResponse(401, FAIL("SHARE_PASSWORD_WRONG", "分享密码错误"))
        : url === "/api/share/tok-1"
        ? jsonResponse(401, FAIL("SHARE_PASSWORD_REQUIRED", "该分享需要密码"))
        : jsonResponse(200, OK({ user: null })),
  });
  await flush();

  ctx.els["unlock-password"].value = "wrong";
  await ctx.els["unlock-btn"].fire("click");
  await flush();

  checkEq(ctx.els["unlock-error"].textContent, "分享密码错误", "应展示后端 message");
  checkEq(ctx.els["unlock-error"].hidden, false, "错误应可见");
  checkEq(ctx.els["unlock-password"].value, "wrong", "不得清空输入框内容");
  checkEq(ctx.els["unlock-btn"].disabled, false, "按钮应恢复可点");
  checkEq(ctx.els["share-lock"].hidden, false, "仍停留在密码锁");
});

// ---------------------------------------------------------------------------
// 用例：评论
// ---------------------------------------------------------------------------

function commentsContext(options) {
  const opts = options || {};
  const comments = opts.comments || [];
  const viewer = opts.viewer || null;
  const posted = [];
  const ctx = loadShare({
    token: opts.token || "tok-1",
    responder: (url, requestOptions) => {
      if (url === "/api/share/tok-1") return jsonResponse(200, notePayload(SHARED_NOTE));
      if (url === "/api/share/tok-1/comments" && requestOptions.method === "POST") {
        posted.push(JSON.parse(requestOptions.body));
        if (opts.postResult) return opts.postResult;
        return jsonResponse(201, OK({ id: 1 }));
      }
      if (url === "/api/share/tok-1/comments") return jsonResponse(200, commentPayload(comments));
      if (url === "/api/auth/me") return jsonResponse(200, OK({ user: viewer }));
      return jsonResponse(200, OK(null));
    },
  });
  return { ctx, posted };
}

testCase("评论列表：昵称与内容用 textContent 渲染，空态显示提示", async () => {
  const { ctx } = commentsContext({ comments: [] });
  await flush();

  checkEq(ctx.els["comment-empty"].hidden, false, "空列表应显示空态");
  checkEq(ctx.els["comment-list"].children.length, 0, "空列表不应渲染条目");
});

testCase("评论列表：渲染昵称、本地时间与内容", async () => {
  const { ctx } = commentsContext({
    comments: [
      { nickname: "路过的猫", content: "写得真好", created_at: "2026-10-07T10:00:00Z" },
    ],
  });
  await flush();

  checkEq(ctx.els["comment-empty"].hidden, true, "有评论时应隐藏空态");
  checkEq(ctx.els["comment-list"].children.length, 1, "应渲染一条评论");
  const item = ctx.els["comment-list"].children[0];
  checkEq(item.children[0].textContent, "路过的猫", "昵称");
  checkEq(
    item.children[1].textContent,
    new Date("2026-10-07T10:00:00Z").toLocaleString("zh-CN"),
    "本地时间"
  );
  checkEq(item.children[2].textContent, "写得真好", "内容");
});

testCase("已登录：隐藏昵称字段，提交时昵称传空串", async () => {
  const { ctx, posted } = commentsContext({ viewer: { id: 1, username: "阿黎改名" } });
  await flush();

  checkEq(ctx.els["nickname-field"].hidden, true, "已登录应隐藏昵称字段");

  ctx.els["comment-content"].value = "登录用户评论";
  await ctx.els["comment-form"].fire("submit", { preventDefault: () => {} });
  await flush();

  checkEq(posted.length, 1, "应提交一次评论");
  checkEq(posted[0].nickname, "", "已登录时昵称应传空串（由后端取用户名）");
  checkEq(posted[0].content, "登录用户评论", "评论内容");
});

testCase("游客：昵称字段可见，提交时带上填写的昵称", async () => {
  const { ctx, posted } = commentsContext({ viewer: null });
  await flush();

  checkEq(ctx.els["nickname-field"].hidden, false, "游客应显示昵称字段");

  ctx.els["nickname"].value = "路过的猫";
  ctx.els["comment-content"].value = "游客评论";
  await ctx.els["comment-form"].fire("submit", { preventDefault: () => {} });
  await flush();

  checkEq(posted.length, 1, "应提交一次评论");
  checkEq(posted[0].nickname, "路过的猫", "游客昵称");
  checkEq(posted[0].content, "游客评论", "游客评论内容");
});

testCase("提交成功：清空内容框、重新拉取列表并滚动到新评论", async () => {
  let comments = [];
  const ctx = loadShare({
    responder: (url, requestOptions) => {
      if (url === "/api/share/tok-1") return jsonResponse(200, notePayload(SHARED_NOTE));
      if (url === "/api/share/tok-1/comments" && requestOptions.method === "POST") {
        comments = [
          { nickname: "路过的猫", content: "新评论", created_at: "2026-10-07T10:00:00Z" },
        ];
        return jsonResponse(201, OK({ id: 1 }));
      }
      if (url === "/api/share/tok-1/comments") return jsonResponse(200, commentPayload(comments));
      return jsonResponse(200, OK({ user: null }));
    },
  });
  await flush();

  ctx.els["nickname"].value = "路过的猫";
  ctx.els["comment-content"].value = "新评论";
  await ctx.els["comment-form"].fire("submit", { preventDefault: () => {} });
  await flush();

  checkEq(ctx.els["comment-content"].value, "", "提交成功后应清空内容框");
  checkEq(ctx.els["comment-list"].children.length, 1, "应重新拉取并渲染列表");
  checkEq(
    ctx.els["comment-list"].children[0].scrolled,
    true,
    "应滚动到新评论处"
  );
});

testCase("提交失败：就地展示后端 message，不清空内容框", async () => {
  const { ctx } = commentsContext({
    postResult: jsonResponse(400, FAIL("NICKNAME_REQUIRED", "请填写昵称后再评论")),
  });
  await flush();

  ctx.els["comment-content"].value = "游客评论";
  await ctx.els["comment-form"].fire("submit", { preventDefault: () => {} });
  await flush();

  checkEq(ctx.els["comment-error"].textContent, "请填写昵称后再评论", "应展示后端 message");
  checkEq(ctx.els["comment-error"].hidden, false, "错误应可见");
  checkEq(ctx.els["comment-content"].value, "游客评论", "失败时不应清空内容");
  checkEq(ctx.submitBtn.disabled, false, "按钮应恢复可点");
});

testCase("提交过程中按钮显示「发表中…」并禁用", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = loadShare({
    responder: (url, requestOptions) => {
      if (url === "/api/share/tok-1") return jsonResponse(200, notePayload(SHARED_NOTE));
      if (url === "/api/share/tok-1/comments" && requestOptions.method === "POST") {
        return { status: 201, ok: true, json: () => pending };
      }
      if (url === "/api/share/tok-1/comments") return jsonResponse(200, commentPayload([]));
      return jsonResponse(200, OK({ user: null }));
    },
  });
  await flush();

  const done = ctx.els["comment-form"].fire("submit", { preventDefault: () => {} });
  checkEq(ctx.submitBtn.disabled, true, "提交中按钮应禁用");
  check(ctx.submitBtn.textContent.indexOf("发表中") !== -1, "提交中按钮文字应为「发表中…」");

  release(OK({ id: 1 }));
  await done;
  await flush();

  checkEq(ctx.submitBtn.disabled, false, "提交结束后按钮应恢复");
  checkEq(ctx.submitBtn.textContent, "发表评论", "提交结束后按钮文字应复原");
});

// ---------------------------------------------------------------------------
// 用例：容错
// ---------------------------------------------------------------------------

testCase("页面上没有分享锁容器时 share.js 不抛异常", () => {
  const sandbox = {
    console,
    location: { href: "/", pathname: "/" },
    document: { getElementById: () => null, createElement: () => makeEl({}) },
    fetch: () => Promise.reject(new Error("不应发起请求")),
    md: { render: () => "" },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(SHARE_JS, "utf-8"), sandbox, { filename: "share.js" });
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
