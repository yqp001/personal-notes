// 个人笔记 —— Markdown 渲染出口 static/js/markdown.js 的行为契约测试（纯 assert，Node 内置模块）。
//
// 用法：node tests/js_markdown_test.js
// 退出码：全部通过为 0，任一检查失败为 1。
//
// 环境限制（显式记录）：
//   - marked 是纯解析库，可在 Node 沙箱中**真实执行**，因此本脚本会加载真实的
//     static/vendor/marked.min.js 并断言其渲染结果。
//   - DOMPurify 依赖真实 DOM（无 jsdom 可用），无法在 Node 中执行，因此本脚本只对
//     「markdown.js 是否把全部输出都送进 DOMPurify.sanitize」做**结构化**验证：
//     sanitize 被打桩并用记录器捕获入参，返回哨兵值，从而证明不存在绕过净化的路径。
//     真实的 XSS 执行结果属于浏览器人工走查项（见 Phase 3 报告）。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MARKDOWN_JS = path.join(__dirname, "..", "static", "js", "markdown.js");
const VENDOR_MARKED = path.join(__dirname, "..", "static", "vendor", "marked.min.js");

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

function jsonEqual(actual, expected, label) {
  checkEq(JSON.stringify(actual), JSON.stringify(expected), label);
}

/**
 * 载入真实 markdown.js，并在沙箱里提供 marked / DOMPurify 替身。
 *
 * @param {object} options
 * @param {string} [options.realMarkedSource] 传入则加载真实 vendored marked（用于真实解析断言）
 * @param {string} [options.raw]              marked.parse 的固定返回值
 * @param {string} [options.clean]            DOMPurify.sanitize 的固定返回值
 * @param {boolean} [options.identitySanitize] 让 sanitize 原样返回入参（用于观察 marked 输出）
 */
function loadMarkdown(options) {
  const opts = options || {};
  const parseCalls = [];
  const sanitizeCalls = [];

  // window / self 都指向沙箱全局，模拟浏览器中 `window.marked` 与全局 `marked` 等价
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = undefined; // 显式声明「无 DOM」

  if (opts.realMarkedSource) {
    vm.createContext(sandbox);
    vm.runInContext(opts.realMarkedSource, sandbox, { filename: "marked.min.js" });
    const realParse = sandbox.marked.parse.bind(sandbox.marked);
    sandbox.marked = {
      parse: (src, config) => {
        parseCalls.push({ src, config });
        return realParse(src, config);
      },
    };
  } else {
    sandbox.marked = {
      parse: (src, config) => {
        parseCalls.push({ src, config });
        return opts.raw === undefined ? "<p>" + src + "</p>" : opts.raw;
      },
    };
  }

  sandbox.DOMPurify = {
    sanitize: (html, config) => {
      sanitizeCalls.push({ html, config });
      if (opts.identitySanitize) return html;
      return opts.clean === undefined ? "__SANITIZED__" : opts.clean;
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MARKDOWN_JS, "utf-8"), sandbox, { filename: "markdown.js" });
  return { md: sandbox.md, sandbox, parseCalls, sanitizeCalls };
}

// ---------------------------------------------------------------------------
// 用例：空输入
// ---------------------------------------------------------------------------

testCase("空串与非字符串输入返回空串且不调用解析/净化", () => {
  const ctx = loadMarkdown({});

  checkEq(ctx.md.render(""), "", "空字符串");
  checkEq(ctx.md.render(undefined), "", "undefined");
  checkEq(ctx.md.render(null), "", "null");
  checkEq(ctx.md.render(42), "", "数字");
  checkEq(ctx.md.render({}), "", "对象");
  checkEq(ctx.parseCalls.length, 0, "空输入不得调用 marked.parse");
  checkEq(ctx.sanitizeCalls.length, 0, "空输入不得调用 DOMPurify.sanitize");
});

// ---------------------------------------------------------------------------
// 用例：全部输出必须经过 DOMPurify（不存在绕过路径）
// ---------------------------------------------------------------------------

testCase("渲染结果一律来自 DOMPurify.sanitize，不得回退到 marked 原始输出", () => {
  const poison = '<img src=x onerror="alert(1)">';
  const ctx = loadMarkdown({ raw: poison, clean: "__SANITIZED__" });
  const out = ctx.md.render("![x](javascript:alert(1))");

  checkEq(ctx.parseCalls.length, 1, "应调用一次 marked.parse");
  checkEq(ctx.sanitizeCalls.length, 1, "应调用一次 DOMPurify.sanitize");
  checkEq(ctx.sanitizeCalls[0].html, poison, "sanitize 的入参应是 marked 的原始输出");
  checkEq(out, "__SANITIZED__", "返回值必须是 sanitize 的结果");
  check(out.indexOf("onerror") === -1, "输出不得含 marked 原始输出中的危险属性");
  check(out.indexOf("javascript:") === -1, "输出不得含 marked 原始输出中的危险协议");
});

testCase("净化配置禁掉脚本类标签与 style 属性，并放行 target/rel", () => {
  const ctx = loadMarkdown({});
  ctx.md.render("## 标题");

  const config = ctx.sanitizeCalls[0].config;
  jsonEqual(config.ADD_ATTR, ["target", "rel"], "ADD_ATTR");
  for (const tag of ["script", "iframe", "form", "style"]) {
    check(config.FORBID_TAGS.indexOf(tag) !== -1, `FORBID_TAGS 应包含 ${tag}`);
  }
  check(config.FORBID_ATTR.indexOf("style") !== -1, "FORBID_ATTR 应包含 style");
});

testCase("marked 以 gfm 开启、breaks 关闭解析", () => {
  const ctx = loadMarkdown({});
  ctx.md.render("# 标题");

  checkEq(ctx.parseCalls[0].src, "# 标题", "传给 marked 的源文本");
  jsonEqual(ctx.parseCalls[0].config, { gfm: true, breaks: false }, "marked 配置");
});

testCase("净化后的外链补 target=_blank 与 rel=noopener nofollow", () => {
  const ctx = loadMarkdown({ clean: '<a href="https://example.com">看这里</a>' });
  const out = ctx.md.render("[看这里](https://example.com)");

  check(
    out.indexOf('<a target="_blank" rel="noopener nofollow" href="https://example.com">') !== -1,
    "外链应补 target/rel，实际：" + out
  );
  checkEq(out.indexOf("<a "), 0, "只有一个链接时输出应以补全后的 <a 开头");
});

// ---------------------------------------------------------------------------
// 用例：window.md 的对外形状（唯一渲染出口，不暴露旁路）
// ---------------------------------------------------------------------------

testCase("window.md 只暴露 render，且是函数", () => {
  const ctx = loadMarkdown({});

  checkEq(typeof ctx.md.render, "function", "render 应为函数");
  jsonEqual(Object.keys(ctx.md).sort(), ["render"], "window.md 的键集合");
});

// ---------------------------------------------------------------------------
// 用例：真实 vendored marked（可在 Node 中真实执行）
// ---------------------------------------------------------------------------

testCase("真实 vendored marked 能把 Markdown 渲染为 HTML", () => {
  const markedSource = fs.readFileSync(VENDOR_MARKED, "utf-8");
  const ctx = loadMarkdown({ realMarkedSource: markedSource, identitySanitize: true });
  const out = ctx.md.render("## 标题\n\n**加粗**文字");

  check(out.indexOf("<h2") !== -1, "应渲染 <h2>，实际：" + out);
  check(out.indexOf("标题") !== -1, "应保留标题文字");
  check(out.indexOf("<strong>") !== -1, "应渲染加粗");
});

testCase("真实 marked 的输出同样先经过 DOMPurify 再返回", () => {
  const markedSource = fs.readFileSync(VENDOR_MARKED, "utf-8");
  const ctx = loadMarkdown({ realMarkedSource: markedSource, clean: "__SANITIZED__" });
  const out = ctx.md.render("## 标题");

  checkEq(ctx.sanitizeCalls.length, 1, "真实 marked 路径也必须进净化");
  check(ctx.sanitizeCalls[0].html.indexOf("<h2") !== -1, "净化入参应为 marked 输出");
  checkEq(out, "__SANITIZED__", "返回值必须是净化结果");
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
