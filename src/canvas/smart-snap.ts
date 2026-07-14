/**
 * 智能吸附辅助线（Smart Guides）
 *
 * 拖动节点时，检测与其他节点的对齐关系：
 *  - 边对齐（左/右/上/下）→ 显示绿色线
 *  - 中心对齐（水平/垂直）→ 显示红色线
 *  - 在阈值内（6px）自动吸附
 *
 * 实现：给每个节点的 nodeEl 挂 pointerdown 监听，拖动期间用 pointermove
 * 实时计算。辅助线是一个覆盖在画布上的 SVG 层。
 */
import type { Plugin } from "obsidian";

let snapEnabled = false;

/** 外部调用更新开关状态 */
export function setSnapEnabled(enabled: boolean): void {
  snapEnabled = enabled;
}

const SNAP_THRESHOLD = 6; // 像素，画布坐标系下
const injectedNodes = new WeakSet<HTMLElement>();
let guideLayer: SVGElement | null = null;

export function setupSmartSnap(plugin: Plugin): () => void {
  const timer = setInterval(() => attach(plugin), 500);
  const layoutRef = plugin.app.workspace.on("layout-change", () => attach(plugin));
  plugin.app.workspace.onLayoutReady(() => attach(plugin));
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    hideGuides();
  };
}

function attach(plugin: Plugin) {
  const leaves = plugin.app.workspace.getLeavesOfType("canvas");
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas?.nodes) return;

  for (const node of canvas.nodes.values()) {
    const nodeEl = node?.nodeEl as HTMLElement | undefined;
    if (!nodeEl || injectedNodes.has(nodeEl)) continue;
    injectedNodes.add(nodeEl);
    attachDragHandlers(nodeEl, node, canvas);
  }
}

function ensureGuideLayer(canvas: any): SVGElement | null {
  const wrapper = canvas.wrapperEl as HTMLElement | undefined;
  if (!wrapper) return null;
  if (guideLayer && wrapper.contains(guideLayer)) return guideLayer;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("cp-guide-layer");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "999";
  svg.style.overflow = "visible";
  wrapper.appendChild(svg);
  guideLayer = svg;
  return svg;
}

function attachDragHandlers(nodeEl: HTMLElement, node: any, canvas: any) {
  let dragging = false;
  let startX = 0, startY = 0;

  const onDown = (e: PointerEvent) => {
    if (!snapEnabled) return; // 开关关闭时不吸附
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".cm-editor, textarea, input")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const snap = computeSnap(node, canvas);
    drawGuides(canvas, snap.guides, node);
  };

  const onUp = () => {
    dragging = false;
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    hideGuides();
    canvas.requestSave?.();
  };

  nodeEl.addEventListener("pointerdown", onDown, true);
}

interface Guide { x1: number; y1: number; x2: number; y2: number; color: string; }
interface SnapResult { guides: Guide[]; adjustX: number; adjustY: number; }

function computeSnap(activeNode: any, canvas: any): SnapResult {
  const guides: Guide[] = [];
  let adjustX = 0, adjustY = 0;
  const node = activeNode.getData();
  const ax1 = node.x, ay1 = node.y;
  const ax2 = node.x + node.width, ay2 = node.y + node.height;
  const acx = node.x + node.width / 2, acy = node.y + node.height / 2;

  // 候选目标：所有其他节点
  const candidates: any[] = [];
  for (const n of canvas.nodes.values()) {
    if (n.id === activeNode.id) continue;
    candidates.push(n.getData());
  }

  // 找最近的水平对齐（左/右/中心）
  let bestDX = SNAP_THRESHOLD + 1;
  let dxGuide: Guide | null = null;
  let dxType: "left" | "right" | "center" | null = null;
  for (const c of candidates) {
    const cx1 = c.x, cx2 = c.x + c.width, ccx = c.x + c.width / 2;
    // 活动节点左边 vs 目标左边/右边/中心
    const checks: Array<[number, "left" | "right" | "center", number]> = [
      [Math.abs(ax1 - cx1), "left", cx1],
      [Math.abs(ax1 - cx2), "right", cx2],
      [Math.abs(acx - ccx), "center", ccx],
    ];
    for (const [d, type, lineX] of checks) {
      if (d < bestDX) {
        bestDX = d;
        dxType = type;
        // 辅助线纵向贯穿，取两个节点的 y 范围
        const y1 = Math.min(ay1, c.y);
        const y2 = Math.max(ay2, c.y + c.height);
        dxGuide = { x1: lineX, y1, x2: lineX, y2, color: type === "center" ? "#e74c3c" : "#2ecc71" };
      }
    }
  }
  if (bestDX <= SNAP_THRESHOLD && dxType) {
    if (dxType === "left" || dxType === "right") {
      // 把活动节点左缘吸到目标线
      adjustX = (dxType === "left" ? (dxGuide!.x1 - ax1) : (dxGuide!.x1 - ax1));
    } else {
      adjustX = dxGuide!.x1 - acx;
    }
    if (dxGuide) guides.push(dxGuide);
  }

  // 垂直对齐（上/下/中心）——同理
  let bestDY = SNAP_THRESHOLD + 1;
  let dyGuide: Guide | null = null;
  let dyType: "top" | "bottom" | "center" | null = null;
  for (const c of candidates) {
    const cy1 = c.y, cy2 = c.y + c.height, ccy = c.y + c.height / 2;
    const checks: Array<[number, "top" | "bottom" | "center", number]> = [
      [Math.abs(ay1 - cy1), "top", cy1],
      [Math.abs(ay1 - cy2), "bottom", cy2],
      [Math.abs(acy - ccy), "center", ccy],
    ];
    for (const [d, type, lineY] of checks) {
      if (d < bestDY) {
        bestDY = d;
        dyType = type;
        const x1 = Math.min(ax1, c.x);
        const x2 = Math.max(ax2, c.x + c.width);
        dyGuide = { x1, y1: lineY, x2, y2: lineY, color: type === "center" ? "#e74c3c" : "#2ecc71" };
      }
    }
  }
  if (bestDY <= SNAP_THRESHOLD && dyType) {
    if (dyType === "top" || dyType === "bottom") {
      adjustY = dyGuide!.y1 - ay1;
    } else {
      adjustY = dyGuide!.y1 - acy;
    }
    if (dyGuide) guides.push(dyGuide);
  }

  return { guides, adjustX, adjustY };
}

/** 把画布坐标的辅助线画到 SVG 层（转换屏幕坐标） */
function drawGuides(canvas: any, guides: Guide[], activeNode?: any) {
  const svg = ensureGuideLayer(canvas);
  if (!svg) return;
  svg.innerHTML = "";
  if (guides.length === 0) return;
  const zoom = canvas.tZoom ?? 1;
  const tx = canvas.tx ?? 0;
  const ty = canvas.ty ?? 0;
  for (const g of guides) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(g.x1 * zoom + tx));
    line.setAttribute("y1", String(g.y1 * zoom + ty));
    line.setAttribute("x2", String(g.x2 * zoom + tx));
    line.setAttribute("y2", String(g.y2 * zoom + ty));
    line.setAttribute("stroke", g.color);
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-dasharray", "4 3");
    svg.appendChild(line);

    // 间距数值标签
    if (activeNode) {
      const node = activeNode.getData();
      const isVertical = g.x1 === g.x2; // 垂直线
      // 计算间距：活动节点边到辅助线的距离
      let dist = 0;
      if (isVertical) {
        dist = Math.abs(node.x - g.x1);
        if (dist < 1) dist = Math.abs(node.x + node.width - g.x1);
      } else {
        dist = Math.abs(node.y - g.y1);
        if (dist < 1) dist = Math.abs(node.y + node.height - g.y1);
      }
      if (dist > 0 && dist < 500) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const midX = (g.x1 + g.x2) / 2 * zoom + tx;
        const midY = (g.y1 + g.y2) / 2 * zoom + ty;
        label.setAttribute("x", String(midX + 4));
        label.setAttribute("y", String(midY - 4));
        label.setAttribute("fill", g.color);
        label.setAttribute("font-size", "11");
        label.setAttribute("font-family", "sans-serif");
        label.textContent = `${Math.round(dist)}`;
        svg.appendChild(label);
      }
    }
  }
}

function hideGuides() {
  if (guideLayer) guideLayer.innerHTML = "";
}
