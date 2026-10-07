// 个人笔记 —— 登录 / 注册表单交互（两页共用，由表单的 data-auth-mode 区分）。
//
// 约定：所有网络请求走 window.api（统一提取 message）；
// 用户可见的错误文案只来自后端 message，前端预校验复用同一套中文文案（与 core/codes.py 的
// MESSAGES 逐字一致），仅用于阻止明显无效的提交，绝不代替服务端校验。
// 不使用 innerHTML 回填任何内容。

"use strict";

(function () {
  const form = document.querySelector("form[data-auth-mode]");
  if (!form) return;

  const mode = form.getAttribute("data-auth-mode");
  const ENDPOINTS = { login: "/api/auth/login", register: "/api/auth/register" };
  const url = ENDPOINTS[mode];
  if (!url) return;

  const errorEl = form.querySelector("[data-error]");
  const submitBtn = form.querySelector('button[type="submit"]');
  const idleLabel = submitBtn ? submitBtn.textContent : "";
  const busyLabel = mode === "register" ? "注册中…" : "登录中…";
  // 注册成功进入写笔记页（主要旅程 1），登录成功进入笔记列表
  const nextUrl = mode === "register" ? "/notes/new" : "/notes";

  // 与服务端一致的邮箱规则（core/routes/auth.py 的 EMAIL_RE）
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function readValues() {
    const read = (name) => (form.elements[name] ? form.elements[name].value : "");
    return {
      email: read("email"),
      username: read("username"),
      password: read("password"),
      confirm_password: read("confirm_password"),
    };
  }

  // 与服务端校验顺序一致；返回 {name, message} 或 null
  function preValidate(values) {
    if (!EMAIL_RE.test(values.email.trim())) {
      return { name: "email", message: "请输入有效的邮箱地址" };
    }
    if (mode === "register") {
      if (!values.username.trim()) {
        return { name: "username", message: "请输入用户名" };
      }
      if (values.password.length < 6) {
        return { name: "password", message: "密码长度至少 6 位" };
      }
      if (values.password !== values.confirm_password) {
        return { name: "confirm_password", message: "两次输入的密码不一致" };
      }
    }
    return null;
  }

  function markInvalid(name, invalid) {
    const field = form.elements[name];
    if (!field) return;
    if (invalid) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
  }

  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? busyLabel : idleLabel;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (errorEl) window.api.clearError(errorEl);

    const values = readValues();
    const invalid = preValidate(values);
    if (invalid) {
      markInvalid(invalid.name, true);
      if (errorEl) window.api.showError(errorEl, invalid.message);
      return;
    }

    // 只提交服务端需要的字段
    const payload = { email: values.email.trim(), password: values.password };
    if (mode === "register") {
      payload.username = values.username.trim();
      payload.confirm_password = values.confirm_password;
    }

    setBusy(true);
    const result = await window.api.post(url, payload);
    if (result.ok) {
      location.href = nextUrl;
      return;
    }

    setBusy(false);
    if (result.code === "EMAIL_INVALID") markInvalid("email", true);
    else if (result.code === "USERNAME_REQUIRED") markInvalid("username", true);
    else if (result.code === "PASSWORD_TOO_SHORT" || result.code === "PASSWORD_MISMATCH") {
      markInvalid("password", true);
    }
    if (errorEl) window.api.showError(errorEl, result.message);
  });
})();
