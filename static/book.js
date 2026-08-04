const elements = {
  content: document.querySelector("#book-content"),
  navigation: document.querySelector("#book-navigation"),
  outline: document.querySelector("#page-outline"),
  pagination: document.querySelector("#chapter-pagination"),
  toolbarTitle: document.querySelector("#toolbar-title"),
  chapterEyebrow: document.querySelector("#chapter-eyebrow"),
  progressCount: document.querySelector("#book-progress-count"),
  progressFill: document.querySelector("#book-progress-fill"),
  copyLinkButton: document.querySelector("#copy-link-button"),
  readingState: document.querySelector("#reading-state"),
  commandDialog: document.querySelector("#command-dialog"),
  chapterSearch: document.querySelector("#chapter-search"),
  commandResults: document.querySelector("#command-results"),
};

const state = {
  catalog: null,
  currentPath: null,
  requestId: 0,
};

const deployment = {
  static: document.documentElement.dataset.bookMode === "static",
  baseUrl: new URL("./", document.baseURI),
};

document.addEventListener("DOMContentLoaded", initialize);
window.addEventListener("popstate", () => loadRequestedChapter({ updateHistory: false }));
document.addEventListener("keydown", handleKeyboardShortcut);
elements.copyLinkButton.addEventListener("click", copyCurrentLink);
elements.chapterSearch.addEventListener("input", renderCommandResults);
elements.commandDialog.addEventListener("close", () => {
  elements.chapterSearch.value = "";
  renderCommandResults();
});

async function initialize() {
  try {
    const response = await fetch(
      deployment.static ? siteUrl("catalog.json") : siteUrl("api/book"),
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`目录请求失败（${response.status}）`);
    state.catalog = await response.json();
    renderCatalog();
    renderCommandResults();
    await loadRequestedChapter({ updateHistory: false });
  } catch (error) {
    renderFatalError(error);
  }
}

function renderCatalog() {
  const { available_chapters: available, total_chapters: total } = state.catalog;
  elements.progressCount.textContent = `${available} / ${total} 章`;
  elements.progressFill.style.width = `${total ? (available / total) * 100 : 0}%`;
  elements.navigation.replaceChildren();

  const introduction = document.createElement("button");
  introduction.className = "chapter-link introduction-link";
  introduction.type = "button";
  introduction.dataset.path = state.catalog.introduction_path;
  introduction.innerHTML = '<span class="chapter-number">导言</span><span>这本书写什么</span>';
  introduction.addEventListener("click", () => navigateTo(state.catalog.introduction_path));
  elements.navigation.append(introduction);

  for (const section of state.catalog.sections) {
    const group = document.createElement("section");
    group.className = "navigation-section";
    const heading = document.createElement("h2");
    heading.textContent = section.title;
    group.append(heading);
    for (const chapter of section.chapters) {
      if (chapter.available && chapter.path) {
        const button = document.createElement("button");
        button.className = "chapter-link";
        button.type = "button";
        button.dataset.path = chapter.path;
        button.innerHTML = `<span class="chapter-number">${chapter.number}</span><span>${escapeHtml(chapter.title)}</span>`;
        button.addEventListener("click", () => navigateTo(chapter.path));
        group.append(button);
      } else {
        const item = document.createElement("div");
        item.className = "chapter-link unavailable";
        item.innerHTML = `<span class="chapter-number">${chapter.number}</span><span>${escapeHtml(chapter.title)}</span><small>章节待写</small>`;
        group.append(item);
      }
    }
    elements.navigation.append(group);
  }
}

async function loadRequestedChapter({ updateHistory }) {
  if (!state.catalog) return;
  const requested = new URL(location.href).searchParams.get("chapter");
  const readablePaths = getReadablePaths();
  const path = requested && readablePaths.has(requested)
    ? requested
    : state.catalog.introduction_path;
  await loadChapter(path, { updateHistory });
}

async function navigateTo(path) {
  await loadChapter(path, { updateHistory: true });
}

async function loadChapter(path, { updateHistory }) {
  const requestId = ++state.requestId;
  setLoading(true);
  try {
    const response = await fetch(chapterUrl(path), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`章节请求失败（${response.status}）`);
    const chapter = await response.json();
    if (requestId !== state.requestId) return;
    state.currentPath = chapter.path;
    if (updateHistory) {
      const url = new URL(location.href);
      if (chapter.path === state.catalog.introduction_path) url.searchParams.delete("chapter");
      else url.searchParams.set("chapter", chapter.path);
      url.hash = "";
      history.pushState({}, "", url);
    }
    await renderChapter(chapter);
  } catch (error) {
    if (requestId === state.requestId) renderContentError(error);
  } finally {
    if (requestId === state.requestId) setLoading(false);
  }
}

async function renderChapter(chapter) {
  const unsafeHtml = globalThis.marked?.parse
    ? globalThis.marked.parse(String(chapter.markdown ?? ""), {
        async: false,
        breaks: false,
        gfm: true,
        pedantic: false,
        silent: true,
      })
    : `<pre>${escapeHtml(chapter.markdown)}</pre>`;
  const safeHtml = globalThis.DOMPurify?.sanitize
    ? globalThis.DOMPurify.sanitize(unsafeHtml, {
        FORBID_TAGS: ["base", "form", "iframe", "object", "script", "style"],
        FORBID_ATTR: ["style"],
        ALLOW_DATA_ATTR: false,
        SANITIZE_NAMED_PROPS: true,
      })
    : escapeHtml(chapter.markdown);
  elements.content.innerHTML = safeHtml;
  configureContentLinks(elements.content, chapter.path);
  configureContentImages(elements.content, chapter.path);
  assignHeadingIds(elements.content);
  await renderDiagrams(elements.content);
  enhanceCodeBlocks(elements.content);
  wrapTables(elements.content);
  renderPageOutline();
  renderPagination();
  updateActiveNavigation();

  const chapterLocation = findChapter(chapter.path);
  elements.toolbarTitle.textContent = chapter.title;
  elements.chapterEyebrow.textContent = chapterLocation
    ? `第 ${chapterLocation.chapter.number} 章 · ${chapterLocation.section.title}`
    : "书籍说明";
  elements.readingState.textContent = readyLabel();
  document.title = `${chapter.title} · OpenAgent 配套书`;
  window.scrollTo({ top: 0, behavior: "auto" });
  elements.content.focus({ preventScroll: true });
  scrollToLocationHash();
}

function scrollToLocationHash() {
  const encodedId = window.location.hash.slice(1);
  if (!encodedId) return;
  try {
    document.getElementById(decodeURIComponent(encodedId))?.scrollIntoView();
  } catch {
    // A malformed URL fragment should not replace otherwise valid chapter content.
  }
}

function configureContentLinks(container, currentPath) {
  for (const anchor of container.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#")) continue;
    if (/^https?:\/\//i.test(href)) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      continue;
    }
    const resolved = resolveRelativeBookPath(currentPath, href);
    if (resolved && getReadablePaths().has(resolved)) {
      const url = new URL(deployment.baseUrl);
      url.searchParams.set("chapter", resolved);
      anchor.href = url.toString();
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        navigateTo(resolved);
      });
    } else {
      anchor.classList.add("unavailable-link");
      anchor.title = "该书稿页面不在公开阅读目录中";
      anchor.removeAttribute("href");
    }
  }
}

function configureContentImages(container, currentPath) {
  for (const image of container.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src") || "";
    if (/^(data:|https?:\/\/)/i.test(source)) continue;
    const resolved = resolveRelativeBookPath(currentPath, source);
    if (!resolved) {
      image.remove();
      continue;
    }
    image.src = assetUrl(resolved);
    image.loading = "lazy";
    image.decoding = "async";
  }
}

function assignHeadingIds(container) {
  const used = new Map();
  for (const heading of container.querySelectorAll("h1, h2, h3")) {
    const base = slugify(heading.textContent || "section");
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    heading.id = count ? `${base}-${count + 1}` : base;
  }
}

async function renderDiagrams(container) {
  const blocks = [...container.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return;
  if (!globalThis.mermaid?.render) {
    for (const block of blocks) block.parentElement?.classList.add("diagram-unavailable");
    return;
  }
  globalThis.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
  });
  let index = 0;
  for (const block of blocks) {
    const source = block.textContent || "";
    const diagram = document.createElement("figure");
    diagram.className = "mermaid-diagram";
    block.parentElement?.replaceWith(diagram);
    try {
      const rendered = await globalThis.mermaid.render(`book-diagram-${Date.now()}-${index++}`, source);
      diagram.innerHTML = rendered.svg;
      rendered.bindFunctions?.(diagram);
    } catch (error) {
      diagram.classList.add("diagram-error");
      diagram.innerHTML = `<strong>流程图暂时无法渲染</strong><pre><code>${escapeHtml(source)}</code></pre>`;
      console.warn("Mermaid diagram failed to render", error);
    }
  }
}

function enhanceCodeBlocks(container) {
  for (const code of [...container.querySelectorAll("pre > code")]) {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains("code-shell")) continue;
    const originalCode = code.textContent || "";
    const language = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length) || "text";
    try { globalThis.hljs?.highlightElement?.(code); } catch { /* plain text is fine */ }
    const shell = document.createElement("div");
    shell.className = "code-shell";
    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";
    const label = document.createElement("span");
    label.textContent = language;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "复制";
    copy.addEventListener("click", async () => {
      const copied = await copyText(originalCode);
      copy.textContent = copied ? "已复制" : "复制失败";
      setTimeout(() => { copy.textContent = "复制"; }, 1400);
    });
    toolbar.append(label, copy);
    pre.replaceWith(shell);
    shell.append(toolbar, pre);
  }
}

function wrapTables(container) {
  for (const table of [...container.querySelectorAll("table")]) {
    const wrapper = document.createElement("div");
    wrapper.className = "table-scroll";
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
}

function renderPageOutline() {
  elements.outline.replaceChildren();
  const headings = [...elements.content.querySelectorAll("h2, h3")];
  if (!headings.length) {
    const empty = document.createElement("span");
    empty.className = "outline-empty";
    empty.textContent = "本页没有小节";
    elements.outline.append(empty);
    return;
  }
  for (const heading of headings) {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.className = heading.tagName === "H3" ? "outline-level-3" : "";
    link.textContent = heading.textContent;
    elements.outline.append(link);
  }
}

function renderPagination() {
  elements.pagination.replaceChildren();
  const chapters = getReadableChapters();
  const currentIndex = chapters.findIndex((chapter) => chapter.path === state.currentPath);
  const previous = chapters[currentIndex - 1];
  const next = chapters[currentIndex + 1];
  elements.pagination.append(
    createPaginationButton(previous, "上一页", "previous"),
    createPaginationButton(next, "下一页", "next"),
  );
}

function createPaginationButton(chapter, direction, className) {
  if (!chapter) {
    const spacer = document.createElement("span");
    spacer.className = `pagination-spacer ${className}`;
    return spacer;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pagination-button ${className}`;
  button.innerHTML = `<small>${direction}</small><strong>${escapeHtml(chapter.label)}</strong>`;
  button.addEventListener("click", () => navigateTo(chapter.path));
  return button;
}

function updateActiveNavigation() {
  for (const item of elements.navigation.querySelectorAll("[data-path]")) {
    item.classList.toggle("is-active", item.dataset.path === state.currentPath);
  }
  elements.navigation.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

function getReadableChapters() {
  const chapters = [{
    path: state.catalog.introduction_path,
    label: "这本书写什么",
  }];
  for (const section of state.catalog.sections) {
    for (const chapter of section.chapters) {
      if (chapter.available && chapter.path) {
        chapters.push({ path: chapter.path, label: `${chapter.number}. ${chapter.title}` });
      }
    }
  }
  return chapters;
}

function getReadablePaths() {
  return new Set(getReadableChapters().map((chapter) => chapter.path));
}

function findChapter(path) {
  if (!state.catalog) return null;
  for (const section of state.catalog.sections) {
    const chapter = section.chapters.find((item) => item.path === path);
    if (chapter) return { section, chapter };
  }
  return null;
}

function resolveRelativeBookPath(currentPath, relativePath) {
  try {
    const url = new URL(relativePath, `https://book.local/${currentPath}`);
    if (url.origin !== "https://book.local") return null;
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

function encodePath(path) {
  return String(path).split("/").map((part) => encodeURIComponent(part)).join("/");
}

function siteUrl(path) {
  return new URL(String(path).replace(/^\/+/, ""), deployment.baseUrl).toString();
}

function chapterUrl(path) {
  if (deployment.static) return siteUrl(`content/${encodePath(path)}.json`);
  const url = new URL("api/content", deployment.baseUrl);
  url.searchParams.set("path", path);
  return url.toString();
}

function assetUrl(path) {
  if (deployment.static) return siteUrl(`book-assets/${encodePath(path)}`);
  const url = new URL("api/asset", deployment.baseUrl);
  url.searchParams.set("path", path);
  return url.toString();
}

function readyLabel() {
  return deployment.static ? "GitHub Pages · 已同步" : "本地内容 · 已同步";
}

function renderCommandResults() {
  if (!state.catalog) return;
  const query = elements.chapterSearch.value.trim().toLocaleLowerCase("zh-CN");
  elements.commandResults.replaceChildren();
  const chapters = getReadableChapters().filter((chapter) =>
    !query || chapter.label.toLocaleLowerCase("zh-CN").includes(query));
  for (const chapter of chapters) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${escapeHtml(chapter.label)}</span><small>打开</small>`;
    button.addEventListener("click", () => {
      elements.commandDialog.close();
      navigateTo(chapter.path);
    });
    elements.commandResults.append(button);
  }
  if (!chapters.length) {
    const empty = document.createElement("p");
    empty.textContent = "没有匹配的已发布章节";
    elements.commandResults.append(empty);
  }
}

function handleKeyboardShortcut(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    if (!elements.commandDialog.open) {
      elements.commandDialog.showModal();
      elements.chapterSearch.focus();
    }
  }
}

async function copyCurrentLink() {
  const copied = await copyText(location.href);
  elements.copyLinkButton.textContent = copied ? "链接已复制" : "复制失败";
  setTimeout(() => { elements.copyLinkButton.textContent = "复制本页链接"; }, 1400);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function setLoading(loading) {
  elements.readingState.textContent = loading ? "正在读取…" : readyLabel();
  document.body.classList.toggle("is-loading", loading);
}

function renderContentError(error) {
  elements.content.innerHTML = `
    <div class="reader-error">
      <span>CHAPTER ERROR</span>
      <h1>这一章暂时打不开</h1>
      <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      <button type="button" id="retry-chapter">重新读取</button>
    </div>`;
  document.querySelector("#retry-chapter")?.addEventListener("click", () =>
    loadRequestedChapter({ updateHistory: false }));
}

function renderFatalError(error) {
  elements.navigation.innerHTML = '<p class="navigation-error">目录读取失败</p>';
  renderContentError(error);
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
