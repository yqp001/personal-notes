// 个人笔记 —— Markdown 渲染出口：marked 解析 + DOMPurify 净化。
//
// 边界（spec Security / Components）：
//   - 这是全站**唯一**允许产出 HTML 的模块；
//   - 任何页面都不得绕过它直接 `innerHTML = marked.parse(...)`；
//   - 净化后统一为外链补 `target` / `rel`，避免 tabnabbing。

(function () {
  // 白名单策略：默认白名单之上禁掉可执行/可嵌入的标签与内联样式，放行链接的 target/rel
  const SAFE_LINK = {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "iframe", "form", "script"],
    FORBID_ATTR: ["style"],
  };

  function render(src) {
    if (typeof src !== "string" || !src) return "";
    const raw = window.marked.parse(src, { gfm: true, breaks: false });
    const clean = window.DOMPurify.sanitize(raw, SAFE_LINK);
    // 外链补 rel，避免 tabnabbing
    return clean.replace(/<a /g, '<a target="_blank" rel="noopener nofollow" ');
  }

  window.md = { render };
})();
