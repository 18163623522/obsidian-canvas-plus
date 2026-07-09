/**
 * 自由画笔标注（SVG overlay）
 *
 * 在白板上叠加一个 SVG 层，支持画线/箭头。
 * 工具条切模式：选择（默认）/ 画笔 / 箭头。
 * 笔画存进画布的 edges 之外的隐藏数据（用一个隐藏 text 节点存 JSON）。
 *
 * 实现：
 *  - 在 canvas.canvasEl 上叠加 SVG overlay，跟随 viewport 平移/缩放
 *  - 监听 pointer 事件画线
 *  - 笔画序列 JSON.stringify 后存进一个特殊 text 节点（%%cp:pen%%）
 */
import type { Plugin } from "obsidian";

export type PenMode = "none" | "pen" | "arrow";

interface Stroke {
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  arrow: boolean;
}

let currentMode: PenMode = "none";
let strokes: Stroke[] = [];
let currentStroke: Stroke | null = null;
let svgLayer: SVGElement | null = null;
let penNodeId: string | null = null;

export function setPenMode(mode: PenMode): void {
  currentMode = mode;
  if (svgLayer) {
    svgLayer.style.pointerEvents = mode === "none" ? "none" : "auto";
    svgLayer.style.cursor = mode === "none" ? "" : "crosshair";
  }
}

export function getPenMode(): PenMode {
  return currentMode;
}

export function setupPenLayer(plugin: Plugin): () => void {
  const uninstallers: Array<() => void> = [];
  let attached = false;

  const attach = () => {
    if (attached) return;
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    const canvasEl = canvas?.canvasEl as HTMLElement | undefined;
    if (!canvasEl) return;
    attached = true;

    // 创建 SVG overlay
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("cp-pen-layer");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "50";
    svg.style.overflow = "visible";
    canvasEl.appendChild(svg);
    svgLayer = svg;

    // 加载已存的笔画
    loadStrokes(canvas);

    // 同步 viewport 变换
    const syncTransform = () => {
      if (!svgLayer) return;
      const zoom = canvas.tZoom ?? 1;
      const tx = canvas.tx ?? 0;
      const ty = canvas.ty ?? 0;
      svgLayer.setAttribute("transform", `translate(${tx} ${ty}) scale(${zoom})`);
    };
    syncTransform();
    // 用 MutationObserver 监听 canvasEl 的 transform 变化
    const observer = new MutationObserver(syncTransform);
    observer.observe(canvasEl, { attributes: true, attributeFilter: ["style", "transform"] });
    // 也监听 canvas 的 viewport 变化（通过 monkey-patch）
    const origMarkViewportChanged = canvas.markViewportChanged;
    if (origMarkViewportChanged) {
      canvas.markViewportChanged = function (...args: any[]) {
        const r = origMarkViewportChanged.apply(this, args);
        syncTransform();
        return r;
      };
    }

    // 画笔事件
    const onDown = (e: PointerEvent) => {
      if (currentMode === "none") return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = canvas.posFromEvt?.(e) ?? { x: e.offsetX, y: e.offsetY };
      currentStroke = {
        color: currentMode === "arrow" ? "#e74c3c" : "#2ecc71",
        width: 2 / (canvas.tZoom ?? 1),
        points: [pos],
        arrow: currentMode === "arrow",
      };
      svg.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!currentStroke) return;
      e.preventDefault();
      const pos = canvas.posFromEvt?.(e) ?? { x: e.offsetX, y: e.offsetY };
      currentStroke.points.push(pos);
      redrawStrokes();
    };
    const onUp = (e: PointerEvent) => {
      if (!currentStroke) return;
      e.preventDefault();
      // 箭头模式：只保留首尾两点
      if (currentStroke.arrow && currentStroke.points.length > 2) {
        currentStroke.points = [currentStroke.points[0], currentStroke.points[currentStroke.points.length - 1]];
      }
      strokes.push(currentStroke);
      currentStroke = null;
      redrawStrokes();
      saveStrokes(canvas);
    };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    uninstallers.push(() => {
      observer.disconnect();
      svg.remove();
      svgLayer = null;
      if (origMarkViewportChanged) canvas.markViewportChanged = origMarkViewportChanged;
    });
  };

  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    uninstallers.forEach((u) => u());
    plugin.app.workspace.offref(layoutRef);
  };
}

/** 重画所有笔画 */
function redrawStrokes() {
  if (!svgLayer) return;
  svgLayer.innerHTML = "";
  const all = currentStroke ? [...strokes, currentStroke] : strokes;
  for (const s of all) {
    if (s.points.length < 2) continue;
    const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", s.color);
    path.setAttribute("stroke-width", String(s.width));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svgLayer.appendChild(path);

    // 箭头头
    if (s.arrow) {
      const last = s.points[s.points.length - 1];
      const prev = s.points[s.points.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const len = 12 / (svgLayer.getAttribute("transform")?.includes("scale") ? 1 : 1);
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arrow.setAttribute("d", `M ${last.x} ${last.y} L ${last.x - len * Math.cos(angle - 0.4)} ${last.y - len * Math.sin(angle - 0.4)} M ${last.x} ${last.y} L ${last.x - len * Math.cos(angle + 0.4)} ${last.y - len * Math.sin(angle + 0.4)}`);
      arrow.setAttribute("stroke", s.color);
      arrow.setAttribute("stroke-width", String(s.width));
      arrow.setAttribute("fill", "none");
      arrow.setAttribute("stroke-linecap", "round");
      svgLayer.appendChild(arrow);
    }
  }
}

/** 加载已存的笔画（从隐藏 text 节点读） */
function loadStrokes(canvas: any) {
  strokes = [];
  for (const node of canvas.nodes?.values?.() ?? []) {
    const data = node.getData?.();
    if (data?.text?.includes("%%cp:pen%%")) {
      penNodeId = data.id;
      try {
        const json = data.text.replace("%%cp:pen%%", "").trim();
        if (json) strokes = JSON.parse(json);
      } catch {}
      break;
    }
  }
  redrawStrokes();
}

/** 保存笔画到隐藏 text 节点 */
function saveStrokes(canvas: any) {
  const json = JSON.stringify(strokes);
  if (!penNodeId) {
    // 创建隐藏节点存笔画
    const id = "cp-pen-" + Date.now().toString(36);
    const data = canvas.getData();
    data.nodes.push({
      id,
      type: "text",
      x: -99999,
      y: -99999,
      width: 1,
      height: 1,
      text: `%%cp:pen%%${json}`,
    });
    canvas.setData(data);
    canvas.requestSave();
    penNodeId = id;
  } else {
    const node = canvas.nodes.get(penNodeId);
    if (node) {
      const d = node.getData();
      node.setData({ ...d, text: `%%cp:pen%%${json}` });
      canvas.requestSave();
    }
  }
}

/** 清除所有笔画 */
export function clearStrokes(canvas: any): void {
  strokes = [];
  redrawStrokes();
  if (penNodeId) {
    const node = canvas.nodes.get(penNodeId);
    if (node) {
      const d = node.getData();
      node.setData({ ...d, text: "%%cp:pen%%[]" });
      canvas.requestSave();
    }
  }
}
