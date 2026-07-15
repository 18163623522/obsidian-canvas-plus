/**
 * Alt+拖拽复制节点
 *
 * 按住 Alt 拖拽节点时，不移动原节点，而是复制一份到拖拽位置。
 * 监听 wrapperEl 的 pointerdown（capture），检测 Alt 键。
 *
 * 实现：
 *  - pointerdown 时若 Alt 按下，记录起始位置
 *  - pointermove 时创建副本（偏移 20px），选中副本
 *  - 原节点不动
 */
import type { Plugin } from "obsidian";
import { addNodeData, genId } from "./canvas-access";

export function setupAltDuplicate(plugin: Plugin): () => void {
  const handlers = new Map<HTMLElement, (e: PointerEvent) => void>();

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    const wrapper = canvas?.wrapperEl as HTMLElement | undefined;
    if (!wrapper || handlers.has(wrapper)) return;

    let duplicating = false;
    let sourceNode: any = null;
    let startClientX = 0;
    let startClientY = 0;
    let duplicated = false;

    const onDown = (e: PointerEvent) => {
      if (!e.altKey || e.button !== 0) return;
      // 排除编辑区内
      const target = e.target as HTMLElement;
      if (target?.closest?.(".cm-editor, textarea, input")) return;

      // 找到点击的节点
      const sel = Array.from(canvas.selection?.values?.() ?? []);
      if (sel.length === 0) return;
      sourceNode = sel[0];
      if (!sourceNode?.getData) return;

      duplicating = true;
      duplicated = false;
      startClientX = e.clientX;
      startClientY = e.clientY;

      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
    };

    const onMove = (e: PointerEvent) => {
      if (!duplicating || !sourceNode) return;
      // 拖动超过 5px 才创建副本（避免误触）
      const dx = e.clientX - startClientX;
      const dy = e.clientY - startClientY;
      if (!duplicated && Math.hypot(dx, dy) > 5) {
        duplicated = true;
        e.preventDefault();
        e.stopPropagation();

        // 复制节点数据
        const data = sourceNode.getData();
        const newPos = canvas.posFromEvt?.(e) ?? canvas.posFromClient?.({ x: e.clientX, y: e.clientY }) ?? { x: data.x, y: data.y };
        const newId = addNodeData(canvas, {
          ...data,
          id: undefined, // 让 addNodeData 生成新 id
          x: newPos.x - data.width / 2,
          y: newPos.y - data.height / 2,
        } as any);

        // 复制边（如果选中了多个关联节点）
        canvas.requestSave();

        // 选中新节点
        const newNode = canvas.nodes.get(newId);
        if (newNode) {
          canvas.selectOnly?.(newNode);
        }

        // 停止复制模式，让 Obsidian 正常拖拽新节点
        duplicating = false;
        sourceNode = newNode;
        document.removeEventListener("pointermove", onMove, true);
      }
    };

    const onUp = (e: PointerEvent) => {
      duplicating = false;
      sourceNode = null;
      duplicated = false;
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    };

    wrapper.addEventListener("pointerdown", onDown, true);
    handlers.set(wrapper, onDown);
  };

  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    plugin.app.workspace.offref(layoutRef);
    for (const [el, fn] of handlers) el.removeEventListener("pointerdown", fn, true);
    handlers.clear();
  };
}
