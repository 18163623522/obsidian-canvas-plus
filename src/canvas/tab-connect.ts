/**
 * Tab 键补全连线
 *
 * 选中一个节点时按 Tab：
 *  - 在该节点右侧创建一个新的空文本节点
 *  - 自动连线（from -> to，带箭头）
 *  - 新节点进入编辑态
 *
 * 选中节点按 Enter：
 *  - 在下方创建新节点并连线（同列延伸）
 *
 * 实现：监听 canvas.wrapperEl 的 keydown，拦截 Tab/Enter。
 * 非编辑态才触发（编辑态 Tab/Enter 交给编辑器处理）。
 */
import type { Plugin } from "obsidian";
import { createTextViaData } from "./canvas-access";

export function setupTabConnect(plugin: Plugin): () => void {
  const handlers = new Map<HTMLElement, (e: KeyboardEvent) => void>();

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    const wrapper = canvas?.wrapperEl as HTMLElement | undefined;
    if (!wrapper || handlers.has(wrapper)) return;

    const onKey = (e: KeyboardEvent) => {
      // 只在非编辑态触发
      const target = e.target as HTMLElement;
      if (target?.closest?.(".cm-editor, textarea, input")) return;

      if (e.key === "Tab") {
        const sel = Array.from(canvas.selection?.values?.() ?? []);
        if (sel.length !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        createConnectedNode(canvas, sel[0], "right");
      } else if (e.key === "Enter") {
        const sel = Array.from(canvas.selection?.values?.() ?? []);
        if (sel.length !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        createConnectedNode(canvas, sel[0], "bottom");
      }
    };
    wrapper.addEventListener("keydown", onKey, true);
    handlers.set(wrapper, onKey);
  };

  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    plugin.app.workspace.offref(layoutRef);
    for (const [el, fn] of handlers) el.removeEventListener("keydown", fn, true);
    handlers.clear();
  };
}

/** 记录每个节点的子节点数（用于 Tab 偏移） */
const childCount = new Map<string, number>();

/** 创建一个新节点并连线到源节点 */
function createConnectedNode(canvas: any, sourceNode: any, direction: "right" | "bottom") {
  const data = sourceNode.getData();
  const count = childCount.get(data.id) ?? 0;
  childCount.set(data.id, count + 1);

  const offsetY = count * 90; // 每个子节点下移 90px
  let nx: number, ny: number;
  let fromSide: string, toSide: string;

  if (direction === "right") {
    nx = data.x + data.width + 80;
    ny = data.y + offsetY;
    fromSide = "right";
    toSide = "left";
  } else {
    nx = data.x + offsetY;
    ny = data.y + data.height + 80;
    fromSide = "bottom";
    toSide = "top";
  }

  // 创建新节点
  const newId = createTextViaData(canvas, {
    x: nx,
    y: ny,
    text: "",
    width: data.width || 250,
    height: 60,
  });

  // 创建边
  const edgeId = Math.random().toString(36).slice(2, 18);
  const canvasData = canvas.getData();
  canvasData.edges.push({
    id: edgeId,
    fromNode: data.id,
    fromSide,
    toNode: newId,
    toSide,
    toEnd: "arrow",
  });
  canvas.setData(canvasData);
  canvas.requestSave();

  // 选中新节点并进入编辑态
  const newNode = canvas.nodes.get(newId);
  if (newNode) {
    canvas.selectOnly?.(newNode);
    setTimeout(() => {
      try {
        newNode.setIsEditing?.(true);
      } catch (e) {
        console.warn("[cp-tab] enter edit mode failed", e);
      }
    }, 200);
  }
}
