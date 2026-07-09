/**
 * 网页 iframe 嵌入伪节点
 *
 * 用 text 节点存标记 `%%cp:iframe:https://example.com%%`
 * 轮询时给带标记的节点注入 <iframe>，替代原生 markdown 渲染。
 *
 * 限制：部分网站（Google/YouTube/X）设了 X-Frame-Options 不允许嵌入，
 * 这种情况显示提示并提供"在新标签打开"链接。
 */
import { App, Plugin, Notice } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { createTextViaData } from "./canvas-access";

const IFRAME_RE = /%%cp:iframe:(.+?)%%/;
const rendered = new WeakSet<HTMLElement>();

export function setupIframeNodes(plugin: Plugin): () => void {
  const apply = () => renderIframes(plugin.app);
  const timer = setInterval(apply, 500);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
  };
}

function renderIframes(app: App) {
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas?.nodes) return;
  for (const node of canvas.nodes.values()) {
    renderOne(node);
  }
}

function renderOne(node: CanvasNode) {
  const data = node.getData() as any;
  if (!data || data.type !== "text") return;
  const text: string = data.text ?? "";
  const m = text.match(IFRAME_RE);
  if (!m) return;

  const contentEl = (node as any).contentEl as HTMLElement | undefined;
  if (!contentEl || !document.contains(contentEl)) return;
  if (rendered.has(contentEl)) {
    // 已渲染过，检查 url 是否变了
    const existing = contentEl.querySelector(".cp-iframe-widget");
    if (existing?.getAttribute("data-url") === m[1]) return;
    existing?.remove();
  }
  rendered.add(contentEl);

  const url = m[1].trim();
  // 清掉原生 markdown 渲染内容，替换成 iframe
  contentEl.innerHTML = "";
  const widget = contentEl.createDiv({ cls: "cp-iframe-widget" });
  widget.setAttribute("data-url", url);

  const iframe = widget.createEl("iframe", {
    attr: {
      src: url,
      frameborder: "0",
      allowfullscreen: "true",
      allow: "clipboard-read; clipboard-write; fullscreen",
      sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
    },
  });
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";

  // 加载失败提示（X-Frame-Options 拒绝）
  const fallback = widget.createDiv({ cls: "cp-iframe-fallback" });
  fallback.style.display = "none";
  fallback.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">
    <p>该网站不允许嵌入</p>
    <a href="${url}" target="_blank" style="color:var(--text-accent)">在新标签页打开 ↗</a>
  </div>`;
  iframe.addEventListener("error", () => {
    iframe.style.display = "none";
    fallback.style.display = "flex";
  });
  // 5 秒后如果还是空白，显示 fallback
  setTimeout(() => {
    try {
      if (iframe.contentWindow?.document?.body?.children.length === 0) {
        // 可能被拦截了，但不一定
      }
    } catch {
      // 跨域无法访问 contentDocument，正常
    }
  }, 3000);

  // 顶部工具条：刷新 / 打开
  const bar = widget.createDiv({ cls: "cp-iframe-bar" });
  bar.style.cssText = "position:absolute;top:4px;right:4px;display:flex;gap:4px;z-index:1";
  const refreshBtn = bar.createEl("button", { text: "⟳", attr: { title: "刷新" } });
  refreshBtn.style.cssText = "padding:2px 6px;font-size:14px;cursor:pointer;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary)";
  refreshBtn.onclick = () => { iframe.src = url; };
  const openBtn = bar.createEl("button", { text: "↗", attr: { title: "新标签打开" } });
  openBtn.style.cssText = refreshBtn.style.cssText;
  openBtn.onclick = () => window.open(url, "_blank");
}

/** 创建 iframe 嵌入节点 */
export function createIframeNode(canvas: Canvas, url: string): void {
  const c = canvas.posCenter?.() ?? { x: 0, y: 0 };
  createTextViaData(canvas, {
    x: c.x - 250,
    y: c.y - 200,
    text: `%%cp:iframe:${url}%%`,
    width: 500,
    height: 400,
  });
  // 延迟渲染
  setTimeout(() => {
    const leaves = (canvas as any).view?.leaf?.app?.workspace?.getLeavesOfType?.("canvas") ?? [];
    if (!leaves.length) return;
    const c2 = (leaves[0] as any).view?.canvas;
    if (!c2?.nodes) return;
    for (const node of c2.nodes.values()) renderOne(node);
  }, 300);
  new Notice("已插入网页嵌入节点");
}
