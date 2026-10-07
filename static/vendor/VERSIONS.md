# vendored 前端库版本与来源

本目录下的第三方库全部**本地 vendored**，通过普通 `<script>` 标签引入，**不依赖 CDN / npm 运行时**，保证断网可运行。

## marked

- 版本：`18.1.0`（由 `https://registry.npmmirror.com/marked/latest` 解析）
- 下载：`https://registry.npmmirror.com/marked/-/marked-18.1.0.tgz`
- 包内路径：`package/lib/marked.umd.js`（该版本 `package.json` 的 `browser` 字段指向此文件；包内**未提供**预压缩的 `.min.js`）
- 落地文件名：`static/vendor/marked.min.js`（保留 `*.min.js` 命名以便模板与工具统一引用；内容为 UMD 构建）
- 构建形态：UMD（IIFE），无顶层 `export` / `import`，浏览器 `<script>` 直接引入后暴露全局 `marked`
- 许可证：MIT（文件头保留版权声明）

## DOMPurify

- 版本：`3.4.16`（由 `https://registry.npmmirror.com/dompurify/latest` 解析）
- 下载：`https://registry.npmmirror.com/dompurify/-/dompurify-3.4.16.tgz`
- 包内路径：`package/dist/purify.min.js`
- 落地文件名：`static/vendor/purify.min.js`
- 构建形态：UMD（IIFE），无顶层 `export` / `import`，浏览器 `<script>` 直接引入后暴露全局 `DOMPurify`
- 许可证：Apache-2.0 / MPL-2.0（文件头保留许可声明）

## 引入顺序

页面中必须按 `vendor/marked.min.js` → `vendor/purify.min.js` → `js/markdown.js` 的顺序引入；
`js/markdown.js` 是唯一的 HTML 渲染出口，全部输出都经 `DOMPurify.sanitize` 净化。
