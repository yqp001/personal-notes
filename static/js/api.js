// 个人笔记 —— 全站唯一的请求与错误展示入口。
//
// 约定：后端所有接口统一返回 {"code":"...","message":"中文提示","data":...}。
// 前端只展示 message，绝不把 code 直接给用户看。
// 只走同源相对路径，不拼接外部域名。

// 统一请求：成功返回 {ok:true, data}；失败返回 {ok:false, code, message}
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: "服务器返回了无法解析的内容" };
  }
  if (payload.code === "OK") return { ok: true, data: payload.data };
  return { ok: false, code: payload.code, message: payload.message || "请求失败" };
}

window.api = {
  get: (u) => request("GET", u),
  post: (u, b) => request("POST", u, b),
  put: (u, b) => request("PUT", u, b),
  del: (u, b) => request("DELETE", u, b === undefined ? undefined : b),

  // 就地展示：把 message 写进给定元素并加 .form-error 样式
  showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.className = "form-error";
    el.hidden = false;
  },
  clearError(el) {
    if (el) {
      el.textContent = "";
      el.hidden = true;
    }
  },

  // 顶栏退出（base.html 的 #logout-btn）
  bindLogout() {
    const btn = document.getElementById("logout-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        const r = await window.api.post("/api/auth/logout");
        if (r.ok) location.href = "/";
      });
    }
  },
};

window.api.bindLogout();

// 顶栏汉堡菜单（<768px）：点击切换展开态，点击导航链接或页面空白处收起。
// 元素不存在时（桌面端无按钮 / 精简沙箱）直接跳过，不报错。
(function bindNavToggle() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!toggle || !nav) return;

  function setOpen(open) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) nav.classList.add("is-open");
    else nav.classList.remove("is-open");
  }

  toggle.addEventListener("click", function (event) {
    event.stopPropagation();
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  // 点击导航链接后收起
  nav.addEventListener("click", function (event) {
    const target = event && event.target;
    if (target && target.tagName === "A") setOpen(false);
  });

  // 点击页面空白处收起
  document.addEventListener("click", function () {
    setOpen(false);
  });
})();
