// 个人笔记 —— 前端请求封装 static/js/api.js 的接口契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_api_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 说明：api.js 是给浏览器用的普通脚本（操作 window / document / fetch / location），
// 这里用 node:vm 提供一个最小沙箱来驱动它，从而把「前端只展示 message」这条契约
// 变成可重复执行的断言，而不是只靠手工点浏览器。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const API_JS = path.join(__dirname, "..", "static", "js", "api.js");

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

// ---------------------------------------------------------------------------
// 沙箱
// ---------------------------------------------------------------------------

function jsonResponse(status, body) {
  return {
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
  };
}

function brokenJsonResponse(status) {
  return {
    status,
    ok: status < 400,
    json: () => Promise.reject(new SyntaxError("Unexpected token")),
  };
}

/** #logout-btn 的替身 */
function fakeButton() {
  const handlers = {};
  return {
    handlers,
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
  };
}

/**
 * 通用元素替身：支持 addEventListener / setAttribute / getAttribute / classList。
 * 用于驱动 api.js 的顶栏汉堡菜单（#nav-toggle 与 #site-nav）。
 */
function fakeElement() {
  const handlers = {};
  const attrs = {};
  const classes = new Set();
  return {
    handlers,
    attrs,
    classes,
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
    setAttribute(key, value) {
      attrs[key] = String(value);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null;
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
}

/**
 * 在最小沙箱里加载 api.js。
 * @param {(url: string, opts: object) => object} responder 返回响应对象（或 Promise）
 * @param {object|null} button  #logout-btn 的替身；null 表示页面上没有该按钮
 * @param {string} initialHref  进入页面时的 location.href
 * @param {object} elements     其它 id -> 元素替身的映射（如 #nav-toggle / #site-nav）
 */
function loadApi(responder, button, initialHref, elements) {
  const requests = [];
  const documentListeners = {};
  const sandbox = {
    console,
    location: { href: initialHref === undefined ? "/" : initialHref },
    document: {
      getElementById: (id) => {
        if (elements && Object.prototype.hasOwnProperty.call(elements, id)) {
          return elements[id];
        }
        return id === "logout-btn" ? button : null;
      },
      addEventListener: (type, fn) => {
        documentListeners[type] = fn;
      },
    },
    fetch: (url, opts) => {
      requests.push({ url, opts });
      return Promise.resolve(responder(url, opts));
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_JS, "utf-8"), sandbox, { filename: "api.js" });
  return { sandbox, api: sandbox.api, requests, button, documentListeners };
}

const NOT_FOUND_BODY = { code: "NOT_FOUND", message: "页面不存在", data: null };

// ---------------------------------------------------------------------------
// 用例：统一请求
// ---------------------------------------------------------------------------

testCase("失败响应只暴露 code 与中文 message", async () => {
  const { api, requests } = loadApi(() => jsonResponse(404, NOT_FOUND_BODY), null);
  const result = await api.get("/api/unknown");

  checkEq(result.ok, false, "ok");
  checkEq(result.code, "NOT_FOUND", "code");
  checkEq(result.message, "页面不存在", "message");
  checkEq(requests.length, 1, "fetch 调用次数");
  checkEq(requests[0].url, "/api/unknown", "请求 URL 必须是同源相对路径");
});

testCase("成功响应返回 data", async () => {
  const { api } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: { a: 1 } }),
    null
  );
  const result = await api.get("/api/notes");

  checkEq(result.ok, true, "ok");
  checkEq(JSON.stringify(result.data), JSON.stringify({ a: 1 }), "data");
  checkEq(result.code, undefined, "成功结果不应带 code 字段");
});

testCase("响应体无法解析时给出中文兜底提示", async () => {
  const { api } = loadApi(() => brokenJsonResponse(500), null);
  const result = await api.get("/api/boom");

  checkEq(result.ok, false, "ok");
  checkEq(result.code, "INTERNAL_ERROR", "code");
  checkEq(result.message, "服务器返回了无法解析的内容", "message");
});

testCase("响应缺 message 时回落到「请求失败」", async () => {
  const { api } = loadApi(() => jsonResponse(400, { code: "INVALID_PARAMS" }), null);
  const result = await api.get("/api/x");

  checkEq(result.ok, false, "ok");
  checkEq(result.code, "INVALID_PARAMS", "code");
  checkEq(result.message, "请求失败", "message");
});

// ---------------------------------------------------------------------------
// 用例：方法、请求头与 credentials
// ---------------------------------------------------------------------------

testCase("post 发送 JSON 请求体并带同源凭证", async () => {
  const { api, requests } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
  await api.post("/api/auth/login", { email: "a@b.com", password: "secret123" });

  const req = requests[0];
  checkEq(req.opts.method, "POST", "method");
  checkEq(req.opts.headers["Content-Type"], "application/json", "Content-Type");
  checkEq(req.opts.body, JSON.stringify({ email: "a@b.com", password: "secret123" }), "请求体");
  checkEq(req.opts.credentials, "same-origin", "credentials");
});

testCase("get 不带请求体也不带 Content-Type", async () => {
  const { api, requests } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
  await api.get("/api/notes");

  const req = requests[0];
  checkEq(req.opts.method, "GET", "method");
  checkEq(req.opts.body, undefined, "body");
  checkEq(JSON.stringify(req.opts.headers), "{}", "headers");
});

testCase("put 与 del 使用正确的 HTTP 方法", async () => {
  const { api, requests } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
  await api.put("/api/notes/1", { title: "标题" });
  await api.del("/api/notes/1");

  checkEq(requests[0].opts.method, "PUT", "put 的 method");
  checkEq(requests[1].opts.method, "DELETE", "del 的 method");
});

// ---------------------------------------------------------------------------
// 用例：错误展示助手
// ---------------------------------------------------------------------------

testCase("showError / clearError 就地展示与清除提示", () => {
  const { api } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
  const el = { textContent: "", className: "", hidden: true };

  api.showError(el, "该邮箱已被注册");
  checkEq(el.textContent, "该邮箱已被注册", "showError 写入 message");
  checkEq(el.className, "form-error", "showError 应用 .form-error 样式");
  checkEq(el.hidden, false, "showError 应显示元素");

  api.clearError(el);
  checkEq(el.textContent, "", "clearError 清空文本");
  checkEq(el.hidden, true, "clearError 应隐藏元素");
});

testCase("元素为 null 时展示助手不抛异常", () => {
  const { api } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
  api.showError(null, "提示");
  api.clearError(null);
  passed += 1;
});

// ---------------------------------------------------------------------------
// 用例：顶栏退出
// ---------------------------------------------------------------------------

testCase("页面上没有退出按钮时不绑定也不发请求", async () => {
  const { requests } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  checkEq(requests.length, 0, "不应发起任何请求");
});

testCase("点击退出按钮调用登出接口并跳转主页", async () => {
  const button = fakeButton();
  const { sandbox, requests } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    button,
    "/notes"
  );
  check(typeof button.handlers.click === "function", "应给 #logout-btn 绑定 click");

  await button.handlers.click();

  checkEq(requests.length, 1, "登出请求次数");
  checkEq(requests[0].url, "/api/auth/logout", "登出接口路径");
  checkEq(requests[0].opts.method, "POST", "登出应使用 POST");
  checkEq(sandbox.location.href, "/", "登出成功后应跳转主页");
});

testCase("登出失败时不跳转", async () => {
  const button = fakeButton();
  const { sandbox } = loadApi(
    () => jsonResponse(401, { code: "AUTH_REQUIRED", message: "请先登录", data: null }),
    button,
    "/notes"
  );
  await button.handlers.click();
  checkEq(sandbox.location.href, "/notes", "登出失败时应留在原页面");
});

// ---------------------------------------------------------------------------
// 用例：顶栏汉堡菜单（<768px 收成汉堡，点击切换展开态）
// ---------------------------------------------------------------------------

testCase("汉堡菜单：点击切换 aria-expanded 与 is-open", () => {
  const toggle = fakeElement();
  const nav = fakeElement();
  toggle.setAttribute("aria-expanded", "false");
  loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null,
    "/",
    { "nav-toggle": toggle, "site-nav": nav }
  );

  check(typeof toggle.handlers.click === "function", "应给 #nav-toggle 绑定 click");
  check(typeof nav.handlers.click === "function", "应给 #site-nav 绑定 click");

  const stop = { stopPropagation() {} };
  toggle.handlers.click(stop);
  checkEq(toggle.getAttribute("aria-expanded"), "true", "展开后 aria-expanded");
  check(nav.classList.contains("is-open"), "展开后导航应加 .is-open");

  toggle.handlers.click(stop);
  checkEq(toggle.getAttribute("aria-expanded"), "false", "再次点击应收起");
  check(!nav.classList.contains("is-open"), "收起后应移除 .is-open");
});

testCase("汉堡菜单：点击导航链接或页面空白处收起", () => {
  const toggle = fakeElement();
  const nav = fakeElement();
  toggle.setAttribute("aria-expanded", "false");
  const { documentListeners } = loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null,
    "/",
    { "nav-toggle": toggle, "site-nav": nav }
  );
  const stop = { stopPropagation() {} };

  // 点击导航链接
  toggle.handlers.click(stop);
  nav.handlers.click({ target: { tagName: "A" } });
  check(!nav.classList.contains("is-open"), "点击导航链接应收起");

  // 点击页面空白处
  toggle.handlers.click(stop);
  check(nav.classList.contains("is-open"), "前置：应已展开");
  check(typeof documentListeners.click === "function", "应在 document 上监听 click 以收起");
  documentListeners.click({ target: { tagName: "DIV" } });
  check(!nav.classList.contains("is-open"), "点击空白处应收起");
});

testCase("页面上没有汉堡按钮时不绑定也不抛异常", () => {
  loadApi(
    () => jsonResponse(200, { code: "OK", message: "操作成功", data: null }),
    null
  );
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
