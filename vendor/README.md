# 前端第三方依赖

这些浏览器资源固定版本并随 OpenAgent 一起分发，运行时不访问 CDN，也不要求用户安装
Node.js。升级时请从对应的 npm 官方包重新提取发行文件，并同步更新本表和许可证文件。

| 文件 | 包与版本 | 用途 |
| --- | --- | --- |
| `marked.umd.js` | `marked@18.0.7` | CommonMark 与 GitHub Flavored Markdown 解析 |
| `purify.min.js` | `dompurify@3.4.12` | 对解析后的 HTML 做安全净化 |
| `highlight.min.js` | `@highlightjs/cdn-assets@11.11.1` | 围栏代码语法高亮 |
| `highlight-github.min.css` | `@highlightjs/cdn-assets@11.11.1` | 代码高亮基础配色 |
| `mermaid.min.js` | `mermaid@11.16.0` | 配套书中的 Mermaid 流程图 |

相应许可证保存在同一目录的 `LICENSE.*` 文件中。

`mermaid.min.js` 从 npm 官方包 `mermaid-11.16.0.tgz` 的 `dist/mermaid.min.js` 提取；文件
SHA-256 为 `74d7c46dabca328c2294733910a8aa1ed0c37451776e8d5295da38a2b758fb9b`。
