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

// ============== 标记字段定义 ==============
export const FLAG_STYLE = "cpStyle"; // "plain" 纯文字
export const FLAG_SHAPE = "cpShape"; // "rounded" | "ellipse" | "diamond"
export const FLAG_STICKY = "cpSticky"; // "yellow" | "pink" | "blue" | "green"（便签颜色）
export const FLAG_TEXT_SCALE = "cpTextScale"; // number 文字字号缩放（持久化）

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
  const timer = setInterval(apply, 400);
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

/** 给单个节点应用所有 cp* 样式标记 */
export function applyNodeStyle(node: CanvasNode): void {
  const data = node.getData?.() ?? (node as any).nodeData;
  if (!data) return;
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (!nodeEl) return;

  // 清除旧的 cp-* class（保留非 cp 的）
  const classes = Array.from(nodeEl.classList).filter((c) => !c.startsWith("cp-"));
  nodeEl.className = classes.join(" ");

  // 纯文字
  if (data[FLAG_STYLE] === "plain") nodeEl.classList.add("cp-plain");
  // 形状
  if (data[FLAG_SHAPE]) nodeEl.classList.add(`cp-shape-${data[FLAG_SHAPE]}`);
  // 便签
  if (data[FLAG_STICKY]) nodeEl.classList.add(`cp-sticky`, `cp-sticky-${data[FLAG_STICKY]}`);
  // 字号缩放（持久化版）
  if (data[FLAG_TEXT_SCALE]) {
    const contentEl = (node as any).contentEl as HTMLElement | undefined;
    if (contentEl) contentEl.style.fontSize = `${data[FLAG_TEXT_SCALE]}em`;
  }
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
  applyNodeStyle(node);
}

// —— 纯文字 ——
export function togglePlain(node: CanvasNode): boolean {
  const data = node.getData();
  const isPlain = data[FLAG_STYLE] === "plain";
  setFlag(node, FLAG_STYLE, isPlain ? undefined : "plain");
  return !isPlain;
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
