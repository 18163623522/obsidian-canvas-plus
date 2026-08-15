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
  // 遍历全部画布叶子：多画布并存时每个画布的节点都要应用样式
  for (const leaf of app.workspace.getLeavesOfType("canvas")) {
    const canvas = (leaf as any).view?.canvas;
    if (!canvas?.nodes) continue;
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
  // 注意：bar 在 container 内部（不是 nodeEl 直接子元素），必须用后代查询
  // （之前用 :scope > 查不到，导致每 200ms 轮询重复注入一个标题栏）
  const bars = nodeEl.querySelectorAll(".cp-title-bar");
  let bar = (bars[0] as HTMLElement) ?? null;
  // 清理历史堆积的多余标题栏（保留第一个）
  for (let i = 1; i < bars.length; i++) bars[i].remove();
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

  // 更新标题文字（如果没在编辑 + 内容有变化才写入，避免 200ms 轮询抖动）
  if (document.activeElement !== bar) {
    const isPlaceholder = !title;
    const targetText = isPlaceholder ? "点击输入标题…" : title;
    // 只有文字真正变了才写 textContent（避免无谓的 DOM 抖动）
    if (bar.textContent !== targetText) {
      bar.textContent = targetText;
    }
    const targetOpacity = isPlaceholder ? "0.5" : "1";
    if (bar.style.opacity !== targetOpacity) bar.style.opacity = targetOpacity;
    // 占位样式用 CSS 类管理
    const hasPlaceholder = bar.classList.contains("cp-title-placeholder");
    if (hasPlaceholder !== isPlaceholder) bar.classList.toggle("cp-title-placeholder", isPlaceholder);
  }
}

/** 给单个节点应用所有 cp* 样式标记 */
export function applyNodeStyle(node: CanvasNode): void {
  const data = node.getData?.() ?? (node as any).nodeData;
  if (!data) return;
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (!nodeEl || !document.contains(nodeEl)) return; // 节点 DOM 不存在（懒渲染），跳过

  // ── 无变化快速通道（关键！）──
  // 计算目标 class 集合，和当前一致就完全跳过本轮 DOM 操作。
  // 之前每 200ms 无条件重写 nodeEl.className，即使内容相同也触发
  // attribute 写入，干扰 Obsidian 的响应式渲染（连接把手被反复重置，
  // 导致"无法从节点拖出箭头"）。
  const targetClasses = new Set<string>();
  if (data[FLAG_STYLE] === "plain") targetClasses.add("cp-plain");
  if (data[FLAG_STYLE] === "title-card") targetClasses.add("cp-title-card");
  if (data[FLAG_SHAPE]) targetClasses.add(`cp-shape-${data[FLAG_SHAPE]}`);
  if (data[FLAG_STICKY]) { targetClasses.add("cp-sticky"); targetClasses.add(`cp-sticky-${data[FLAG_STICKY]}`); }
  const scale = data[FLAG_TEXT_SCALE];
  if (scale) targetClasses.add(`cp-scale-${String(scale).replace(".", "-")}`);

  // Mindo 卡片判定：只认显式标记（右键"Mindo 卡片样式"/新建卡片命令/子节点）。
  // 不按内容自动套用——保持普通 "# 标题" 节点为 Obsidian 原生外观。
  const mindo = (data as any).styleAttributes?.mindo;
  const targetMindo = mindo ? String(mindo) : null;

  const currentCp = Array.from(nodeEl.classList).filter((c) => c.startsWith("cp-"));
  const same =
    currentCp.length === targetClasses.size &&
    currentCp.every((c) => targetClasses.has(c)) &&
    (nodeEl.getAttribute("data-mindo") ?? null) === targetMindo;
  if (same) {
    // class 一致：只做幂等注入（标题栏内部也有变化检测），不写 className
    if (data[FLAG_STYLE] === "title-card") injectTitleBar(node as any, nodeEl, data);
    // 字号缩放的 DOM 层需要重设（Obsidian 重建内容 DOM 后丢失），保持轻量重设；
    // 无标记时主动清除内联——否则放大后复位，!important 内联残留，字号回不去
    if (scale) applyTextScaleDom(node, scale);
    else clearTextScaleDom(node);
    // 图层和图标也要保持（可能被 Obsidian 重建覆盖）
    applyLayerStyle(node);
    applyIcon(node);
    return;
  }

  // ── 有变化：清旧 cp-* class，写入新集合 ──
  const classes = Array.from(nodeEl.classList).filter((c) => !c.startsWith("cp-"));
  for (const c of targetClasses) classes.push(c);
  const newClassName = classes.join(" ");
  if (nodeEl.className !== newClassName) nodeEl.className = newClassName;

  // Mindo 卡片：写 data-mindo + 解析色带颜色。
  // --canvas-color 在部分预设色下解析为空字符串，导致色带背景整体失效
  // （不可见）。这里把节点颜色解析成确定有效的色值写进 --cp-band-color，
  // 皮肤 CSS 只依赖这个变量。
  if (targetMindo) {
    (nodeEl.dataset as any).mindo = targetMindo;
    let band: string | null = null;
    const rawColor: string | undefined = (data as any).color;
    if (rawColor && /^#[0-9a-fA-F]{3,8}$/.test(rawColor)) {
      band = rawColor;
    } else if (rawColor !== undefined && rawColor >= "1" && rawColor <= "6") {
      try {
        const v = getComputedStyle(nodeEl).getPropertyValue("--canvas-color").trim();
        if (v) band = v;
      } catch {}
    }
    if (band) nodeEl.style.setProperty("--cp-band-color", band);
    else nodeEl.style.removeProperty("--cp-band-color");
  } else if (nodeEl.dataset.mindo !== undefined) {
    delete (nodeEl.dataset as any).mindo;
    nodeEl.style.removeProperty("--cp-band-color");
  }

  // 标题卡片：DOM 注入标题栏 / 非标题卡片：清理残留
  if (data[FLAG_STYLE] === "title-card") {
    injectTitleBar(node as any, nodeEl, data);
  } else {
    const staleBar = nodeEl.querySelector(".cp-title-bar");
    if (staleBar) staleBar.remove();
  }
  if (scale) applyTextScaleDom(node, scale);
  else clearTextScaleDom(node);

  // 图层样式（锁定/隐藏）
  applyLayerStyle(node);

  // 图标标记
  applyIcon(node);
}

/** 字号缩放的 DOM 应用（内容层 font-size） */
function applyTextScaleDom(node: any, scale: number): void {
  const setFontSize = () => {
    const ce = node.contentEl as HTMLElement | undefined;
    if (!ce) return;
    const targets = ce.querySelectorAll(".markdown-preview-view, .markdown-preview-sizer, .markdown-embed-content");
    targets.forEach((t: any) => {
      if (t.style.getPropertyValue("font-size") !== `${scale}em`) {
        t.style.setProperty("font-size", `${scale}em`, "important");
      }
    });
    // Mindo 组件渲染层：正文/标题在自有 widget 里，原生预览的目标选择器够不到。
    // widget 容器写 em（标题头继承父级，随之缩放）；正文有固定 0.875rem，按基准换算。
    const widget = ce.querySelector(".cp-mindo-widget") as HTMLElement | null;
    if (widget && widget.style.getPropertyValue("font-size") !== `${scale}em`) {
      widget.style.setProperty("font-size", `${scale}em`, "important");
    }
    const mindoBodySize = `calc(0.875rem * ${scale})`;
    ce.querySelectorAll(".cp-mindo-body").forEach((t: any) => {
      if (t.style.getPropertyValue("font-size") !== mindoBodySize) {
        t.style.setProperty("font-size", mindoBodySize, "important");
      }
    });
    const cmContent = node.child?.editMode?.cm?.dom?.querySelector?.(".cm-content") as HTMLElement | undefined;
    if (cmContent) cmContent.style.setProperty("font-size", `${scale}em`, "important");
  };
  setFontSize();
}

/** 清除字号缩放的内联残留（复位 1.00× 后调用，幂等） */
function clearTextScaleDom(node: any): void {
  const ce = node.contentEl as HTMLElement | undefined;
  if (!ce) return;
  const targets = ce.querySelectorAll(".markdown-preview-view, .markdown-preview-sizer, .markdown-embed-content, .cp-mindo-widget, .cp-mindo-body");
  targets.forEach((t: any) => {
    if (t.style.getPropertyValue("font-size")) t.style.removeProperty("font-size");
  });
  const cmContent = node.child?.editMode?.cm?.dom?.querySelector?.(".cm-content") as HTMLElement | undefined;
  if (cmContent?.style.getPropertyValue("font-size")) cmContent.style.removeProperty("font-size");
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
