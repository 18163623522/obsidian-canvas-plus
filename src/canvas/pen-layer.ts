/**
 * 自由画笔标注（简化版）
 *
 * 画笔模式下监听 canvasEl 的 pointer 事件，在 SVG overlay 上画线。
 * 非画笔模式下不拦截事件，不影响白板正常操作。
 * 笔画存进隐藏 text 节点（%%cp:pen%%JSON）。
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
let activeCanvas: any = null;
let wrapperEl: HTMLElement | null = null;

export function setPenMode(mode: PenMode): void {
  currentMode = mode;
  // 画笔层永远 pointer-events:none，用 capture 拦截 mousedown
  // 鼠标移出画笔模式时恢复
  if (mode !== "none") {
    wrapperEl?.style.setProperty("cursor", "crosshair");
  } else {
    wrapperEl?.style.removeProperty("cursor");
  }
}

export function getPenMode(): PenMode {
  return currentMode;
}

export function setupPenLayer(plugin: Plugin): () => void {
  const uninstallers: Array<() => void> = [];

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    const wEl = canvas?.wrapperEl as HTMLElement | undefined;
    if (!wEl) return;
    if (svgLayer && wEl.contains(svgLayer)) return; // 已挂载
    wrapperEl = wEl; // 赋值给模块级变量

    // 创建或复用 SVG
    if (!svgLayer) {
      svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgLayer.classList.add("cp-pen-layer");
      svgLayer.setAttribute("width", "100%");
      svgLayer.setAttribute("height", "100%");
      svgLayer.style.position = "absolute";
      svgLayer.style.top = "0";
      svgLayer.style.left = "0";
      svgLayer.style.right = "0";
      svgLayer.style.bottom = "0";
      svgLayer.style.width = "100%";
      svgLayer.style.height = "100%";
      svgLayer.style.pointerEvents = "none";  // 始终 none，不挡白板交互
      svgLayer.style.zIndex = "999";
      svgLayer.style.overflow = "visible";
    }
    wrapperEl.appendChild(svgLayer);
    activeCanvas = canvas;
    // 显式设置 SVG 尺寸为 wrapper 的像素大小
    const setSvgSize = () => {
      if (!svgLayer || !wrapperEl) return;
      const w = wrapperEl.clientWidth || wrapperEl.offsetWidth;
      const h = wrapperEl.clientHeight || wrapperEl.offsetHeight;
      svgLayer.setAttribute("width", String(w));
      svgLayer.setAttribute("height", String(h));
      svgLayer.style.width = w + "px";
      svgLayer.style.height = h + "px";
    };
    setSvgSize();
    const resizeObs = new ResizeObserver(setSvgSize);
    resizeObs.observe(wrapperEl);

    // 加载已存笔画
    loadStrokes(canvas);

    // 画笔事件：画笔模式下在 wrapperEl 上 capture 拦截 mousedown
    // SVG 层 pointer-events 始终 none，不挡框选
    const onCaptureDown = (e: MouseEvent) => {
      if (currentMode === "none") return;
      if (e.button !== 0) return;
      // 拦截这一事件，不让 Obsidian 框选
      e.preventDefault();
      e.stopPropagation();
      const pos = canvas.posFromEvt?.(e) ?? { x: e.offsetX, y: e.offsetY };
      currentStroke = {
        color: currentMode === "arrow" ? "#e74c3c" : "#2ecc71",
        width: 3 / (canvas.tZoom ?? 1),
        points: [pos],
        arrow: currentMode === "arrow",
      };
      // 切到 document 级 mousemove/mouseup
      document.addEventListener("mousemove", onDocMove, true);
      document.addEventListener("mouseup", onDocUp, true);
    };
    const onDocMove = (e: MouseEvent) => {
      if (!currentStroke) return;
      e.preventDefault();
      const pos = canvas.posFromEvt?.(e) ?? { x: e.offsetX, y: e.offsetY };
      currentStroke.points.push(pos);
      redrawStrokes();
    };
    const onDocUp = (e: MouseEvent) => {
      if (!currentStroke) return;
      e.preventDefault();
      document.removeEventListener("mousemove", onDocMove, true);
      document.removeEventListener("mouseup", onDocUp, true);
      if (currentStroke.arrow && currentStroke.points.length > 2) {
        currentStroke.points = [currentStroke.points[0], currentStroke.points[currentStroke.points.length - 1]];
      }
      strokes.push(currentStroke);
      currentStroke = null;
      redrawStrokes();
      saveStrokes(canvas);
    };
    wrapperEl.addEventListener("mousedown", onCaptureDown, true);

    // viewport 同步
    const syncTransform = () => {
      if (!svgLayer) return;
      const zoom = canvas.tZoom ?? 1;
      const tx = canvas.tx ?? 0;
      const ty = canvas.ty ?? 0;
      svgLayer.setAttribute("transform", `translate(${tx} ${ty}) scale(${zoom})`);
    };
    syncTransform();
    const observer = new MutationObserver(syncTransform);
    observer.observe(wrapperEl, { attributes: true, attributeFilter: ["style", "transform"] });

    uninstallers.push(() => {
      observer.disconnect();
      resizeObs.disconnect();
      wrapperEl?.removeEventListener("mousedown", onCaptureDown, true);
      document.removeEventListener("mousemove", onDocMove, true);
      document.removeEventListener("mouseup", onDocUp, true);
      svgLayer?.remove();
    });
  };

  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    plugin.app.workspace.offref(layoutRef);
    uninstallers.forEach((u) => u());
  };
}

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
    if (s.arrow) {
      const last = s.points[s.points.length - 1];
      const prev = s.points[s.points.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const len = 12;
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

function loadStrokes(canvas: any) {
  strokes = [];
  penNodeId = null;
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

function saveStrokes(canvas: any) {
  const json = JSON.stringify(strokes);
  if (!penNodeId) {
    const id = "cp-pen-" + Date.now().toString(36);
    const data = canvas.getData();
    data.nodes.push({ id, type: "text", x: -99999, y: -99999, width: 1, height: 1, text: `%%cp:pen%%${json}` });
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
