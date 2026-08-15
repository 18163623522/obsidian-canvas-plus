/**
 * Mindo 卡片（组件渲染版）
 *
 * 在 contentEl 里渲染 Mindo 原版结构的组件：
 *   <div class="cp-mindo-widget">
 *     <div class="cp-mindo-header">标题（实色/白字/粗体/居中）</div>
 *     <div class="cp-mindo-body">正文（官方 Markdown 渲染器）</div>
 *   </div>
 * 正文对齐按卡可选：styleAttributes.cpAlign="center" 居中，默认左对齐。
 * pointer-events:none，不影响原生连线和拖拽；编辑态隐藏、绝不重建。
 */
import type { Plugin } from "obsidian";
import { MarkdownRenderer, Component } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";

/** Markdown 渲染的生命周期宿主（插件级，卸载时统一释放） */
let cardOwner: Component | null = null;

/** 解析节点颜色为实色（hex 直接用；预设色经 --canvas-color 换算；空则用主题色） */
function resolveCardColor(nodeEl: HTMLElement, rawColor: string | undefined): string {
  if (rawColor && /^#[0-9a-fA-F]{3,8}$/.test(rawColor)) return rawColor;
  if (rawColor !== undefined && rawColor >= "1" && rawColor <= "6") {
    try {
      const v = getComputedStyle(nodeEl).getPropertyValue("--canvas-color").trim();
      if (v) return v;
    } catch {}
  }
  return "var(--color-accent, #6366f1)";
}

/** 把 "# 标题\n\n正文" 拆成 标题/正文 */
function splitTitleBody(text: string): { title: string; body: string } {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const m = t.match(/^#\s*(.+)\n?/);
  if (m) {
    const rest = t.slice(m[0].length).replace(/^\n+/, "");
    return { title: m[1].trim(), body: rest };
  }
  const idx = t.indexOf("\n");
  if (idx < 0) return { title: t.trim(), body: "" };
  return { title: t.slice(0, idx).trim(), body: t.slice(idx + 1).replace(/^\n+/, "") };
}

export function setupMindoCards(plugin: Plugin, enabled?: () => boolean): () => void {
  cardOwner = new Component();
  cardOwner.load();
  const apply = () => {
    if (enabled && !enabled()) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
        const canvas = (leaf as any).view?.canvas;
        if (!canvas?.nodes) continue;
        for (const node of canvas.nodes.values()) {
          const el = (node as any).contentEl as HTMLElement | undefined;
          el?.querySelector(":scope > .cp-mindo-widget")?.remove();
        }
      }
      return;
    }
    for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
      const canvas = (leaf as any).view?.canvas;
      if (!canvas?.nodes) continue;
      for (const node of canvas.nodes.values()) {
        try {
          renderOne(node as CanvasNode);
        } catch {}
      }
    }
  };
  const timer = setInterval(apply, 500);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    cardOwner?.unload();
    cardOwner = null;
  };
}

/** 立即刷新指定节点的卡片组件（切换样式后调用，不等 500ms 轮询） */
export function refreshMindoCards(nodes: CanvasNode[]): void {
  for (const n of nodes) {
    try {
      renderOne(n);
    } catch {}
  }
}

function renderOne(node: CanvasNode): void {
  const data = node.getData?.() as any;
  const contentEl = (node as any).contentEl as HTMLElement | undefined;
  if (!data || !contentEl) return;

  const mode = data.styleAttributes?.mindo; // "card" | "band"
  const existing = contentEl.querySelector(":scope > .cp-mindo-widget") as HTMLElement | null;

  if (!mode || data.type !== "text") {
    existing?.remove();
    return;
  }

  const key = `${mode}|${data.text ?? ""}|${data.color ?? ""}|${data.styleAttributes?.cpAlign ?? ""}|${data.styleAttributes?.textAlign ?? ""}`;
  if (existing) {
    if ((node as any).isEditing) {
      existing.style.display = "none";
      return;
    }
    if ((existing as any).__cpKey === key) {
      existing.style.display = "flex";
      return;
    }
    existing.remove();
  }
  if ((node as any).isEditing) return; // 编辑中不重建

  const color = resolveCardColor((node as any).nodeEl ?? contentEl, data.color);
  const pluginApp = ((node as any).canvas?.view?.app ?? (window as any).app) as any;
  // 正文对齐：原生 textAlign（原生对齐命令/右键菜单）与遗留 cpAlign 都生效，
  // 否则组件渲染会把原生预览盖住、让原生对齐看起来"没反应"
  const sa = data.styleAttributes ?? {};
  const effectiveAlign = sa.cpAlign === "center" ? "center" : sa.textAlign;

  const widget = document.createElement("div");
  widget.className = "cp-mindo-widget";
  (widget as any).__cpKey = key;
  widget.style.display = (node as any).isEditing ? "none" : "flex";

  /** 正文走 Obsidian 官方 Markdown 渲染 */
  const makeBody = (bodyText: string): HTMLElement => {
    const bodyEl = document.createElement("div");
    bodyEl.className = "cp-mindo-body";
    if (effectiveAlign === "center") bodyEl.classList.add("cp-mindo-center");
    else if (effectiveAlign) bodyEl.style.textAlign = effectiveAlign;
    const owner = cardOwner ?? undefined;
    if (pluginApp && MarkdownRenderer && owner) {
      MarkdownRenderer.render(
        pluginApp,
        String(bodyText ?? ""),
        bodyEl,
        (node as any).canvas?.view?.file?.path ?? "",
        owner
      ).catch(() => {
        bodyEl.textContent = String(bodyText ?? "");
      });
    } else {
      bodyEl.textContent = String(bodyText ?? "");
    }
    return bodyEl;
  };

  if (mode === "band") {
    const band = document.createElement("div");
    band.className = "cp-mindo-band";
    band.style.background = color;
    widget.appendChild(band);
    widget.appendChild(makeBody(data.text ?? ""));
  } else {
    const { title, body } = splitTitleBody(data.text ?? "");
    const header = document.createElement("div");
    header.className = "cp-mindo-header";
    header.style.background = color;
    header.textContent = title;
    widget.appendChild(header);
    widget.appendChild(makeBody(body));
  }

  contentEl.appendChild(widget);
}
