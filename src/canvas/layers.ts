/**
 * 图层管理（置顶/置底/锁定/隐藏）
 *
 * 基于 CanvasNode 的 setData 写自定义标记：
 *  - cpLocked: true -> 锁定（禁止拖动，通过 CSS pointer-events:none）
 *  - cpHidden: true -> 隐藏（display:none）
 *  - cpZIndex: number -> 强制 z-index
 *
 * 在节点右键菜单和工具条提供操作。
 */
import type { CanvasNode } from "../types/canvas-internal";

const FLAG_LOCKED = "cpLocked";
const FLAG_HIDDEN = "cpHidden";

/** 切换锁定 */
export function toggleLock(node: CanvasNode): boolean {
  const data = node.getData() as any;
  const isLocked = !!data[FLAG_LOCKED];
  (node as any).setData?.({ ...data, [FLAG_LOCKED]: !isLocked });
  node.canvas?.requestSave?.();
  applyLayerStyle(node);
  return !isLocked;
}

/** 切换隐藏 */
export function toggleHide(node: CanvasNode): boolean {
  const data = node.getData() as any;
  const isHidden = !!data[FLAG_HIDDEN];
  (node as any).setData?.({ ...data, [FLAG_HIDDEN]: !isHidden });
  node.canvas?.requestSave?.();
  applyLayerStyle(node);
  return !isHidden;
}

/** 置顶 */
export function bringToFront(node: CanvasNode): void {
  const canvas = (node as any).canvas;
  if (!canvas) return;
  // 取所有节点的最大 zIndex
  let maxZ = 0;
  for (const n of canvas.nodes.values()) {
    const z = (n as any).zIndex ?? 0;
    if (z > maxZ) maxZ = z;
  }
  (node as any).setZIndex?.(maxZ + 1);
  canvas.requestSave?.();
}

/** 置底 */
export function sendToBack(node: CanvasNode): void {
  const canvas = (node as any).canvas;
  if (!canvas) return;
  let minZ = Infinity;
  for (const n of canvas.nodes.values()) {
    const z = (n as any).zIndex ?? 0;
    if (z < minZ) minZ = z;
  }
  (node as any).setZIndex?.((minZ === Infinity ? 0 : minZ) - 1);
  canvas.requestSave?.();
}

/** 应用图层样式（锁定/隐藏） */
export function applyLayerStyle(node: CanvasNode): void {
  const data = node.getData() as any;
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (!nodeEl) return;

  // 锁定
  const isLocked = !!data[FLAG_LOCKED];
  nodeEl.classList.toggle("cp-locked", isLocked);
  // 隐藏
  const isHidden = !!data[FLAG_HIDDEN];
  nodeEl.classList.toggle("cp-hidden", isHidden);
}
