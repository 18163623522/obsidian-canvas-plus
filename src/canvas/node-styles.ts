/**
 * 节点样式系统（统一处理 纯文字 / 形状 / 便签）
 *
 * 模式：给 nodeData 加自定义标记字段（cpStyle / cpShape / cpSticky），
 * 轮询 Canvas DOM 给节点 nodeEl 加对应 CSS class，样式由 styles.css 实现。
 * 这些自定义字段借助 JSON Canvas 的前向兼容（[key:string]:any）持久化。
 *
 * 这个模块取代原 plain-text.ts 的轮询职责，plain-text 的 API 保留为薄封装。
 */
import type { App, Plugin } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { applyLayerStyle } from "./layers";
import { applyIcon } from "./node-icon";

// ============== 标记字段定义 ==============
export const FLAG_STYLE = "cpStyle"; // "plain" 纯文字
export const FLAG_SHAPE = "cpShape"; // "rounded" | "ellipse" | "diamond"
export const FLAG_STICKY = "cpSticky"; // "yellow" | "pink" | "blue" | "green"（便签颜色）
export const FLAG_TEXT_SCALE = "cpTextScale"; // number 文字字号缩放（持久化）
export const FLAG_TITLE = "cpTitle"; // string 标题卡片的标题文字（独立于正文 text）

// 边样式标记
export const FLAG_LINE_STYLE = "cpLineStyle"; // "dashed" | "dotted" | "solid"
export const FLAG_LINE_WEIGHT = "cpLineWeight"; // number（1/2/3）
export type LineStyleType = "solid" | "dashed" | "dotted";

// 向后兼容别名（plain-text.ts 导出）
export const PLAIN_FLAG = FLAG_STYLE;
export const PLAIN_VALUE = "plain";

export type ShapeType = "rounded" | "ellipse" | "diamond";
export type StickyColor = "yellow" | "pink" | "blue" | "green";

/** 所有 cp* 标记字段名，用于清理 */
const ALL_FLAGS = [FLAG_STYLE, FLAG_SHAPE, FLAG_STICKY, FLAG_TEXT_SCALE];

// ============== 轮询器：把 nodeData 标记同步到 DOM class ==============
export function setupNodeStyles(plugin: Plugin): () => void {
  const apply = () => applyAllStyles(plugin.app);
  const timer = setInterval(apply, 200);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  plugin.app.workspace.onLayoutReady(apply);
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
  };
}

export function applyAllStyles(app: App): void {
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas?.nodes) return;
  for (const node of canvas.nodes.values() as IterableIterator<CanvasNode>) {
    applyNodeStyle(node);
  }
  // 边样式
  if (canvas.edges) {
    for (const edge of canvas.edges.values()) {
      applyEdgeStyle(edge);
    }
  }
}

/** 给单个边应用 cp* 样式标记 */
export function applyEdgeStyle(edge: any): void {
  const data = edge.getData?.() ?? edge.edgeData;
  if (!data) return;
  // 边的 DOM：Obsidian 里边是 SVG path，挂在 edge.path 或 edge.line
  const pathEl = (edge.path as SVGPathElement | undefined) ?? (edge.line as any);
  if (pathEl && pathEl.setAttribute) {
    const style: string = data[FLAG_LINE_STYLE] ?? "solid";
    const weight: number = data[FLAG_LINE_WEIGHT] ?? 1;
    // SVG 描边样式
    if (style === "dashed") pathEl.setAttribute("stroke-dasharray", "8 4");
    else if (style === "dotted") pathEl.setAttribute("stroke-dasharray", "2 4");
    else pathEl.removeAttribute("stroke-dasharray");
    pathEl.setAttribute("stroke-width", String(weight));
  }
}

// —— 边样式 setter ——
export function setEdgeStyle(edge: any, style: LineStyleType | undefined): void {
  const data = edge.getData();
  const newData: any = { ...data };
  if (!style || style === "solid") delete newData[FLAG_LINE_STYLE];
  else newData[FLAG_LINE_STYLE] = style;
  edge.setData?.(newData);
  edge.canvas?.requestSave?.();
  applyEdgeStyle(edge);
}

export function setEdgeWeight(edge: any, weight: number | undefined): void {
  const data = edge.getData();
  const newData: any = { ...data };
  if (!weight || weight === 1) delete newData[FLAG_LINE_WEIGHT];
  else newData[FLAG_LINE_WEIGHT] = weight;
  edge.setData?.(newData);
  edge.canvas?.requestSave?.();
  applyEdgeStyle(edge);
}

/**
 * 给标题卡片节点注入一个固定标题栏（DOM 元素 + inline style）。
 *
 * 为什么用 DOM 注入而不是 CSS：白板 text 节点的 markdown 渲染 DOM 结构
 * 在不同 Obsidian 版本里不一致，CSS 选择 h1 经常匹配不到（"看不见"）。
 * 直接注入一个独立 div 用 inline style，绝对可靠。
 *
 * 标题栏是 contenteditable，用户可直接点击编辑；标题存 cpTitle 字段，
 * 和正文 text 真正分离。
 */
function injectTitleBar(node: any, nodeEl: HTMLElement, data: any): void {
  let bar = nodeEl.querySelector(":scope > .cp-title-bar") as HTMLElement | null;
  const title: string = data[FLAG_TITLE] ?? "";

  if (!bar) {
    bar = document.createElement("div");
    bar.className = "cp-title-bar";
    bar.setAttribute("data-cp-title-bar", "1");
    // 全部用 inline style，不依赖外部 CSS
    bar.style.cssText = [
      "background: var(--canvas-color, #6366f1)",
      "color: #fff",
      "padding: 8px 14px",
      "font-weight: 700",
      "font-size: 1.05em",
      "line-height: 1.4",
      "cursor: text",
      "user-select: text",
      "outline: none",
      "border-bottom: 1px solid rgba(0,0,0,0.15)",
      "border-radius: 10px 10px 0 0",
      "min-height: 20px",
      "white-space: nowrap",
      "overflow: hidden",
      "text-overflow: ellipsis",
      "display: block",
      "width: 100%",
      "box-sizing: border-box",
    ].join("; ");
    // 可编辑
    bar.contentEditable = "true";
    // 阻止双击标题栏触发节点编辑（让标题栏自己处理光标）
    bar.addEventListener("dblclick", (e) => e.stopPropagation());
    // 阻止 mousedown 冒泡到白板（避免拖动节点）
    bar.addEventListener("mousedown", (e) => e.stopPropagation());
    // 占位文字清理（绑一次即可，用 class 判断）
    bar.addEventListener("focus", () => {
      if (bar!.classList.contains("cp-title-placeholder")) {
        bar!.textContent = "";
        bar!.style.opacity = "1";
      }
    });
    // 失焦时保存标题
    bar.addEventListener("blur", () => {
      const newText = bar!.textContent || "";
      const d = node.getData?.() ?? {};
      if (d[FLAG_TITLE] !== newText) {
        node.setData?.({ ...d, [FLAG_TITLE]: newText });
        node.canvas?.requestSave?.();
      }
    });
    // 插到内容容器内部最前面（文档流内，正文自然往下排，不重叠）
    // 之前插在 nodeEl 层（与 container 平级）导致和全高的内容区重叠
    const container = nodeEl.querySelector(":scope > .canvas-node-container") as HTMLElement | null;
    const host = container ?? nodeEl;
    host.insertBefore(bar, host.firstChild);
  }

  // 更新标题文字（如果没在编辑）
  if (document.activeElement !== bar) {
    const isPlaceholder = !title;
    bar.textContent = isPlaceholder ? "点击输入标题…" : title;
    bar.style.opacity = isPlaceholder ? "0.5" : "1";
    // 占位样式用 CSS 类管理，不重复绑监听器（轮询每 200ms 跑一次）
    bar.classList.toggle("cp-title-placeholder", isPlaceholder);
  }
}

/** 给单个节点应用所有 cp* 样式标记 */
export function applyNodeStyle(node: CanvasNode): void {
  const data = node.getData?.() ?? (node as any).nodeData;
  if (!data) return;
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (!nodeEl || !document.contains(nodeEl)) return; // 节点 DOM 不存在（懒渲染），跳过

  // 清除旧的 cp-* class（保留非 cp 的）
  const classes = Array.from(nodeEl.classList).filter((c) => !c.startsWith("cp-"));
  nodeEl.className = classes.join(" ");

  // 纯文字
  if (data[FLAG_STYLE] === "plain") nodeEl.classList.add("cp-plain");
  // 标题卡片：直接 DOM 注入标题栏（inline style 确保一定看得见）
  if (data[FLAG_STYLE] === "title-card") {
    nodeEl.classList.add("cp-title-card");
    injectTitleBar(node as any, nodeEl, data);
  } else {
    // 非标题卡片：移除可能残留的标题栏（在 container 内或 nodeEl 直下）
    const staleBar = nodeEl.querySelector(".cp-title-bar");
    if (staleBar) staleBar.remove();
  }
  // 形状
  if (data[FLAG_SHAPE]) nodeEl.classList.add(`cp-shape-${data[FLAG_SHAPE]}`);
  // 便签
  if (data[FLAG_STICKY]) nodeEl.classList.add(`cp-sticky`, `cp-sticky-${data[FLAG_STICKY]}`);

  // 字号缩放：contentEl 设了不够，要设到 markdown-preview-view（阅读视图渲染层）
  const scale = data[FLAG_TEXT_SCALE];
  if (scale) {
    nodeEl.classList.add(`cp-scale-${String(scale).replace(".", "-")}`);
    const setFontSize = () => {
      const ce = (node as any).contentEl as HTMLElement | undefined;
      if (!ce) return;
      // 阅读视图渲染层：markdown-preview-view 不继承父级 font-size
      const targets = ce.querySelectorAll(".markdown-preview-view, .markdown-preview-sizer, .markdown-embed-content");
      targets.forEach((t: any) => {
        t.style.setProperty("font-size", `${scale}em`, "important");
      });
      // 编辑态 CM6
      const cmContent = (node as any).child?.editMode?.cm?.dom?.querySelector?.(".cm-content") as HTMLElement | undefined;
      if (cmContent) cmContent.style.setProperty("font-size", `${scale}em`, "important");
    };
    setFontSize();
    setTimeout(setFontSize, 100);
    setTimeout(setFontSize, 500);
  }

  // 图层样式（锁定/隐藏）
  applyLayerStyle(node);

  // 图标标记
  applyIcon(node);
}

// ============== 便捷 setter ==============
function setFlag(node: CanvasNode, flag: string, value: any): void {
  const data = node.getData();
  const newData: any = { ...data };
  if (value === undefined || value === null || value === "") {
    delete newData[flag];
  } else {
    newData[flag] = value;
  }
  // 清掉本次无关的冲突标记（形状互斥、便签互斥）
  if (flag === FLAG_SHAPE) delete newData[FLAG_STICKY];
  if (flag === FLAG_STICKY) delete newData[FLAG_SHAPE];
  (node as any).setData?.(newData);
  node.canvas?.requestSave?.();
  // 立即应用一次 + 延迟再应用两次（setData 触发 DOM 重建，需等重建完才生效）
  applyNodeStyle(node);
  setTimeout(() => applyNodeStyle(node), 50);
  setTimeout(() => applyNodeStyle(node), 200);
}

// —— 纯文字 ——
export function togglePlain(node: CanvasNode): boolean {
  const data = node.getData();
  const isPlain = data[FLAG_STYLE] === "plain";
  setFlag(node, FLAG_STYLE, isPlain ? undefined : "plain");
  return !isPlain;
}

// —— 标题卡片（固定标题栏 + 正文区）——
export function setTitleCard(node: CanvasNode): void {
  setFlag(node, FLAG_STYLE, "title-card");
}

// —— 形状 ——
export function setShape(node: CanvasNode, shape: ShapeType | undefined): void {
  setFlag(node, FLAG_SHAPE, shape);
}

// —— 便签 ——
export function setSticky(node: CanvasNode, color: StickyColor | undefined): void {
  setFlag(node, FLAG_STICKY, color);
}

// —— 字号缩放（持久化版，写进 nodeData） ——
export function setTextScale(node: CanvasNode, scale: number | undefined): void {
  setFlag(node, FLAG_TEXT_SCALE, scale);
}

// ============== 样式模版 ==============

export interface StyleTemplateData {
  name: string;
  color?: string;
  cpTextScale?: number;
  cpStyle?: string;
  cpShape?: string;
  cpSticky?: string;
}

/** 从节点的当前样式提取模版数据（不含 name） */
export function extractNodeStyle(node: CanvasNode): Omit<StyleTemplateData, "name"> {
  const data = node.getData?.() ?? (node as any).nodeData;
  const tpl: Omit<StyleTemplateData, "name"> = {};
  if (data.color) tpl.color = data.color;
  if (data[FLAG_TEXT_SCALE] != null) tpl.cpTextScale = data[FLAG_TEXT_SCALE];
  if (data[FLAG_STYLE]) tpl.cpStyle = data[FLAG_STYLE];
  if (data[FLAG_SHAPE]) tpl.cpShape = data[FLAG_SHAPE];
  if (data[FLAG_STICKY]) tpl.cpSticky = data[FLAG_STICKY];
  return tpl;
}

/** 把模版应用到节点（覆盖该节点的样式标记） */
export function applyTemplateToNode(node: CanvasNode, tpl: StyleTemplateData): void {
  const data = node.getData();
  const newData: any = { ...data };
  // 清掉所有 cp* 标记，再用模版重设
  delete newData[FLAG_STYLE];
  delete newData[FLAG_SHAPE];
  delete newData[FLAG_STICKY];
  delete newData[FLAG_TEXT_SCALE];
  // 应用模版
  if (tpl.color) newData.color = tpl.color;
  else delete newData.color;
  if (tpl.cpStyle) newData[FLAG_STYLE] = tpl.cpStyle;
  if (tpl.cpShape) newData[FLAG_SHAPE] = tpl.cpShape;
  if (tpl.cpSticky) newData[FLAG_STICKY] = tpl.cpSticky;
  if (tpl.cpTextScale != null) newData[FLAG_TEXT_SCALE] = tpl.cpTextScale;
  (node as any).setData?.(newData);
  node.canvas?.requestSave?.();
  applyNodeStyle(node);
  setTimeout(() => applyNodeStyle(node), 50);
  setTimeout(() => applyNodeStyle(node), 200);
}

// ============== 节点创建便捷函数 ==============
/** 创建纯文字节点 */
export function createPlainTextNode(canvas: Canvas, opts: {
  x: number; y: number; text?: string; width?: number; height?: number;
}): CanvasNode {
  const node = canvas.createTextNode({
    pos: { x: opts.x, y: opts.y },
    text: opts.text ?? "",
    size: { width: opts.width ?? 240, height: opts.height ?? 60 },
  });
  setFlag(node, FLAG_STYLE, "plain");
  return node;
}

/** 创建便签节点 */
export function createStickyNode(canvas: Canvas, opts: {
  x: number; y: number; text?: string; color?: StickyColor;
}): CanvasNode {
  const node = canvas.createTextNode({
    pos: { x: opts.x, y: opts.y },
    text: opts.text ?? "",
    size: { width: 200, height: 200 },
  });
  setFlag(node, FLAG_STICKY, opts.color ?? "yellow");
  return node;
}
