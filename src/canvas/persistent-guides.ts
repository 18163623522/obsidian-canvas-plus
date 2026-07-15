/**
 * 持久参考线
 *
 * 在白板上放置常驻的水平/垂直参考线（松手不消失）。
 * 数据存进隐藏 text 节点的 `%%cp:guides%%JSON`。
 *
 * 命令：
 *  - 放置水平参考线（在选中节点上方）
 *  - 放置垂直参考线（在选中节点左侧）
 *  - 清除所有参考线
 *
 * 参考线跟随画布平移/缩放。
 */
import { App, Plugin, Notice } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { addNodeData } from "./canvas-access";

const GUIDE_MARKER = "%%cp:guides%%";
let guides: Array<{ type: "h" | "v"; pos: number; color: string }> = [];
let guideNodeId: string | null = null;
let svgLayer: SVGElement | null = null;

export function setupGuides(plugin: Plugin): () => void {
  const apply = () => {
    loadGuides(plugin.app);
    redrawGuides();
  };
  const timer = setInterval(apply, 1000);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);

  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    svgLayer?.remove();
    svgLayer = null;
  };
}

/** 放置水平参考线（在选中节点上方） */
export function placeHorizontalGuide(app: App, canvas: Canvas): void {
  const sel = getSelectedNode(canvas);
  if (!sel) {
    new Notice("请先选中一个节点");
    return;
  }
  const data = sel.getData() as any;
  guides.push({ type: "h", pos: data.y, color: "#e74c3c" });
  saveGuides(canvas);
  redrawGuides();
  new Notice("已放置水平参考线");
}

/** 放置垂直参考线（在选中节点左侧） */
export function placeVerticalGuide(app: App, canvas: Canvas): void {
  const sel = getSelectedNode(canvas);
  if (!sel) {
    new Notice("请先选中一个节点");
    return;
  }
  const data = sel.getData() as any;
  guides.push({ type: "v", pos: data.x, color: "#3498db" });
  saveGuides(canvas);
  redrawGuides();
  new Notice("已放置垂直参考线");
}

/** 清除所有参考线 */
export function clearGuides(canvas: Canvas): void {
  guides = [];
  saveGuides(canvas);
  redrawGuides();
  new Notice("已清除所有参考线");
}

function getSelectedNode(canvas: Canvas): CanvasNode | null {
  const sel = Array.from(canvas.selection?.values?.() ?? []);
  return (sel[0] as CanvasNode) ?? null;
}

function loadGuides(app: App) {
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas?.nodes) return;
  for (const node of canvas.nodes.values()) {
    const data = node.getData() as any;
    if (data?.text?.includes(GUIDE_MARKER)) {
      guideNodeId = data.id;
      try {
        const json = data.text.replace(GUIDE_MARKER, "").trim();
        guides = json ? JSON.parse(json) : [];
      } catch {
        guides = [];
      }
      return;
    }
  }
  guides = [];
  guideNodeId = null;
}

function saveGuides(canvas: Canvas) {
  const json = JSON.stringify(guides);
  const text = `${GUIDE_MARKER}${json}`;
  if (!guideNodeId) {
    guideNodeId = addNodeData(canvas, {
      type: "text",
      x: -99999, y: -99999, width: 1, height: 1, text,
    });
  } else {
    const node = canvas.nodes.get(guideNodeId);
    if (node) {
      const d = node.getData();
      node.setData({ ...d, text });
    }
  }
  canvas.requestSave();
}

function redrawGuides() {
  if (!svgLayer) return;
  svgLayer.innerHTML = "";
  const leaves = (window as any).app?.workspace?.getLeavesOfType?.("canvas") ?? [];
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas) return;

  const zoom = canvas.tZoom ?? 1;
  const tx = canvas.tx ?? 0;
  const ty = canvas.ty ?? 0;
  const viewport = canvas.getViewportBBox?.() ?? { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

  for (const g of guides) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    if (g.type === "h") {
      const y = g.pos * zoom + ty;
      line.setAttribute("x1", "0");
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(svgLayer.clientWidth || 1000));
      line.setAttribute("y2", String(y));
    } else {
      const x = g.pos * zoom + tx;
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", "0");
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(svgLayer.clientHeight || 1000));
    }
    line.setAttribute("stroke", g.color);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "6 4");
    line.setAttribute("opacity", "0.6");
    svgLayer.appendChild(line);
  }
}

// 确保 svgLayer 存在
export function ensureGuideLayer(canvas: any): SVGElement {
  if (svgLayer && canvas.wrapperEl?.contains(svgLayer)) return svgLayer;
  const wrapper = canvas.wrapperEl as HTMLElement;
  if (!wrapper) return svgLayer || document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgLayer.classList.add("cp-guide-persistent");
  svgLayer.style.position = "absolute";
  svgLayer.style.top = "0";
  svgLayer.style.left = "0";
  svgLayer.style.width = "100%";
  svgLayer.style.height = "100%";
  svgLayer.style.pointerEvents = "none";
  svgLayer.style.zIndex = "5";
  svgLayer.setAttribute("width", String(wrapper.clientWidth));
  svgLayer.setAttribute("height", String(wrapper.clientHeight));
  wrapper.appendChild(svgLayer);
  // 同步 viewport
  const sync = () => {
    if (!svgLayer) return;
    const zoom = canvas.tZoom ?? 1;
    const tx = canvas.tx ?? 0;
    const ty = canvas.ty ?? 0;
    svgLayer.setAttribute("transform", `translate(${tx} ${ty}) scale(${zoom})`);
    redrawGuides();
  };
  const obs = new MutationObserver(sync);
  obs.observe(wrapper, { attributes: true, attributeFilter: ["style", "transform"] });
  sync();
  return svgLayer;
}
