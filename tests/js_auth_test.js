// 个人笔记 —— 表单交互 static/js/auth.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_auth_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：auth.js 是给浏览器用的普通脚本（操作 document / fetch / location / window.api）。
// 这里用 node:vm 提供最小 DOM 沙箱，并同时加载真实的 api.js，从而把「提交走 api.js、
// 失败只展示 message、成功才跳转」这些行为变成可重复执行的断言，而不是只靠手工点浏览器。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");
const AUTH_JS = path.join(__dirname, "..", "static", "js", "auth.js");

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

// ---------------------------------------------------------------------------
// 最小 DOM 沙箱
// ---------------------------------------------------------------------------

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

function makeForm(mode, values) {
  const elements = {};
  for (const [name, value] of Object.entries(values || {})) {
    elements[name] = makeField(value);
  }
  const errorEl = { textContent: "", className: "", hidden: true };
  const button = { textContent: mode === "register" ? "注册" : "登录", disabled: false };
  const handlers = {};
  const form = {
    elements,
    getAttribute: (name) => (name === "data-auth-mode" ? mode : null),
    querySelector: (selector) => {
      if (selector === "[data-error]") return errorEl;
      if (selector === 'button[type="submit"]') return button;
      return null;
    },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
  };
  return { form, errorEl, button, handlers, elements };
}

/**
 * 载入真实 api.js + auth.js。
 * @param {"login"|"register"} mode
 * @param {object} values 表单字段初值
 * @param {(url: string, opts: object) => object} responder
 * @param {string} initialHref
 */
function loadAuth(mode, values, responder, initialHref) {
  const requests = [];
  const parts = makeForm(mode, values);
  const sandbox = {
    console,
    location: { href: initialHref },
    document: {
      querySelector: (selector) => (selector === "form[data-auth-mode]" ? parts.form : null),
      getElementById: () => null,
    },
    fetch: (url, opts) => {
      requests.push({ url, opts });
      return Promise.resolve(responder(url, opts));
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(AUTH_JS, "utf-8"), sandbox, { filename: "auth.js" });
  return { sandbox, requests, ...parts };
}

function submit(handlers) {
  let prevented = false;
  const result = handlers.submit({ preventDefault: () => { prevented = true; } });
  return { result, wasPrevented: () => prevented };
}

const OK_BODY = { code: "OK", message: "操作成功", data: { user: { email: "a@b.com" } } };

const REGISTER_VALUES = {
  email: "a@b.com",
  username: "阿黎",
  password: "abc123",
  confirm_password: "abc123",
};

// ---------------------------------------------------------------------------
// 用例：成功路径
// ---------------------------------------------------------------------------

testCase("注册成功：POST /api/auth/register 并跳转 /notes/new", async () => {
  const ctx = loadAuth("register", REGISTER_VALUES, () => jsonResponse(201, OK_BODY), "/register");
  check(typeof ctx.handlers.submit === "function", "auth.js 应监听表单 submit 事件");

  const { result, wasPrevented } = submit(ctx.handlers);
  await result;

  check(wasPrevented(), "应阻止表单的默认提交");
  checkEq(ctx.requests.length, 1, "请求次数");
  checkEq(ctx.requests[0].url, "/api/auth/register", "注册接口路径");
  checkEq(ctx.requests[0].opts.method, "POST", "方法");
  const body = JSON.parse(ctx.requests[0].opts.body);
  checkEq(body.email, "a@b.com", "请求体 email");
  checkEq(body.username, "阿黎", "请求体 username");
  checkEq(body.password, "abc123", "请求体 password");
  checkEq(body.confirm_password, "abc123", "请求体 confirm_password");
  checkEq(ctx.sandbox.location.href, "/notes/new", "注册成功应跳 /notes/new");
});

testCase("登录成功：POST /api/auth/login 并跳转 /notes", async () => {
  const ctx = loadAuth(
    "login",
    { email: "a@b.com", password: "abc123" },
    () => jsonResponse(200, OK_BODY),
    "/login"
  );
  await submit(ctx.handlers).result;

  checkEq(ctx.requests[0].url, "/api/auth/login", "登录接口路径");
  const body = JSON.parse(ctx.requests[0].opts.body);
  checkEq(body.email, "a@b.com", "请求体 email");
  checkEq(body.password, "abc123", "请求体 password");
  checkEq(body.username, undefined, "登录请求不应包含 username");
  checkEq(ctx.sandbox.location.href, "/notes", "登录成功应跳 /notes");
});

// ---------------------------------------------------------------------------
// 用例：失败路径只展示后端 message
// ---------------------------------------------------------------------------

testCase("注册失败：就地展示 message、恢复按钮、不跳转", async () => {
  const ctx = loadAuth(
    "register",
    REGISTER_VALUES,
    () => jsonResponse(409, { code: "EMAIL_EXISTS", message: "该邮箱已被注册", data: null }),
    "/register"
  );
  await submit(ctx.handlers).result;

  checkEq(ctx.errorEl.textContent, "该邮箱已被注册", "应展示后端 message");
  checkEq(ctx.errorEl.hidden, false, "错误提示应可见");
  checkEq(ctx.button.disabled, false, "失败后按钮应恢复可点");
  checkEq(ctx.sandbox.location.href, "/register", "失败时不得跳转");
});

testCase("登录失败：展示「邮箱或密码错误」并保留在登录页", async () => {
  const ctx = loadAuth(
    "login",
    { email: "a@b.com", password: "wrong" },
    () => jsonResponse(401, { code: "LOGIN_FAILED", message: "邮箱或密码错误", data: null }),
    "/login"
  );
  await submit(ctx.handlers).result;

  checkEq(ctx.requests.length, 1, "空密码以外的登录应交给服务端判定");
  checkEq(ctx.errorEl.textContent, "邮箱或密码错误", "message 必须来自后端");
  checkEq(ctx.sandbox.location.href, "/login", "失败时不得跳转");
});

testCase("服务端 EMAIL_INVALID：对应字段标记 aria-invalid", async () => {
  const ctx = loadAuth(
    "register",
    REGISTER_VALUES,
    () => jsonResponse(400, { code: "EMAIL_INVALID", message: "请输入有效的邮箱地址", data: null }),
    "/register"
  );
  await submit(ctx.handlers).result;

  checkEq(ctx.errorEl.textContent, "请输入有效的邮箱地址", "应展示后端 message");
});

// ---------------------------------------------------------------------------
// 用例：提交中的按钮状态
// ---------------------------------------------------------------------------

testCase("提交过程中按钮禁用并显示「注册中…」", async () => {
  let release;
  const pendingBody = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = loadAuth(
    "register",
    REGISTER_VALUES,
    () => ({ status: 201, ok: true, json: () => pendingBody }),
    "/register"
  );

  const { result } = submit(ctx.handlers);
  checkEq(ctx.button.disabled, true, "提交中按钮应禁用");
  check(ctx.button.textContent.indexOf("注册中") !== -1, "提交中按钮文字应为「注册中…」");

  release(OK_BODY);
  await result;
  checkEq(ctx.sandbox.location.href, "/notes/new", "成功后应跳转");
});

// ---------------------------------------------------------------------------
// 用例：前端预校验（与服务端规则一致，且不代替服务端校验）
// ---------------------------------------------------------------------------

testCase("非法邮箱被前端预校验拦下，不发请求", async () => {
  const ctx = loadAuth(
    "register",
    { ...REGISTER_VALUES, email: "bad-email" },
    () => jsonResponse(201, OK_BODY),
    "/register"
  );
  const { wasPrevented } = submit(ctx.handlers);
  await new Promise((resolve) => setTimeout(resolve, 0));

  check(wasPrevented(), "应阻止提交");
  checkEq(ctx.requests.length, 0, "预校验不通过时不得发请求");
  checkEq(ctx.errorEl.textContent, "请输入有效的邮箱地址", "就地提示");
  checkEq(ctx.button.disabled, false, "预校验失败不应卡住按钮");
});

testCase("注册密码过短被前端拦下", async () => {
  const ctx = loadAuth(
    "register",
    { ...REGISTER_VALUES, password: "abc", confirm_password: "abc" },
    () => jsonResponse(201, OK_BODY),
    "/register"
  );
  submit(ctx.handlers);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.requests.length, 0, "不得发请求");
  checkEq(ctx.errorEl.textContent, "密码长度至少 6 位", "就地提示");
});

testCase("注册两次密码不一致被前端拦下", async () => {
  const ctx = loadAuth(
    "register",
    { ...REGISTER_VALUES, confirm_password: "abc124" },
    () => jsonResponse(201, OK_BODY),
    "/register"
  );
  submit(ctx.handlers);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.requests.length, 0, "不得发请求");
  checkEq(ctx.errorEl.textContent, "两次输入的密码不一致", "就地提示");
});

testCase("注册用户名为空被前端拦下", async () => {
  const ctx = loadAuth(
    "register",
    { ...REGISTER_VALUES, username: "   " },
    () => jsonResponse(201, OK_BODY),
    "/register"
  );
  submit(ctx.handlers);
  await new Promise((resolve) => setTimeout(resolve, 0));

  checkEq(ctx.requests.length, 0, "不得发请求");
  checkEq(ctx.errorEl.textContent, "请输入用户名", "就地提示");
});

// ---------------------------------------------------------------------------
// 用例：无表单页面
// ---------------------------------------------------------------------------

testCase("页面上没有认证表单时 auth.js 不抛异常", () => {
  const sandbox = {
    console,
    location: { href: "/" },
    document: { querySelector: () => null, getElementById: () => null },
    fetch: () => Promise.reject(new Error("不应发起请求")),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  vm.runInContext(fs.readFileSync(AUTH_JS, "utf-8"), sandbox, { filename: "auth.js" });
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
