/**
 * 分组与折叠
 *
 * - 打包分组：选中多个节点 -> 右键 -> 打包分组
 *   创建一个 group 节点包裹它们（计算包围盒）
 * - 折叠/展开：选中 group -> 右键 -> 折叠/展开
 *   折叠时隐藏子节点，展开时恢复
 *
 * group 节点用 JSON Canvas 原生的 type:"group"。
 * 折叠状态存进 cpCollapsed 标记。
 */
import { Notice } from "obsidian";
import type { Canvas, CanvasNode, CanvasNodeData } from "../types/canvas-internal";
import { addNodeData, genId } from "./canvas-access";
import { applyAllStyles } from "./node-styles";

const FLAG_COLLAPSED = "cpCollapsed";

/** 打包分组：选中多个节点，创建一个 group 包裹它们 */
export function groupSelection(canvas: Canvas): void {
  const sel = Array.from(canvas.selection.values()).filter(
    (n: any) => n?.getData?.()?.type !== "group"
  ) as CanvasNode[];
  if (sel.length < 2) {
    new Notice("请至少选中 2 个节点");
    return;
  }

  // 计算包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of sel) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const pad = 30;
  const groupId = addNodeData(canvas, {
    type: "group",
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    label: `分组 (${sel.length})`,
    color: "5",
  });

  // 把 group 节点的 zIndex 设为最低（在子节点下面）
  const groupNode = canvas.nodes.get(groupId);
  if (groupNode) {
    (groupNode as any).setZIndex?.(-1);
  }
  canvas.requestSave();
  new Notice(`已创建分组（${sel.length} 个节点）`);
}

/** 折叠/展开分组 */
export function toggleCollapseGroup(canvas: Canvas, groupNode: CanvasNode): void {
  const data = groupNode.getData() as any;
  if (data.type !== "group") return;
  const isCollapsed = !!data[FLAG_COLLAPSED];

  // 找到 group 范围内的所有节点
  const gx = data.x, gy = data.y, gw = data.width, gh = data.height;
  const children: CanvasNode[] = [];
  for (const node of canvas.nodes.values()) {
    const nd = node.getData();
    if (nd.id === data.id) continue;
    if (nd.type === "group") continue;
    // 节点中心在 group 范围内
    const cx = nd.x + nd.width / 2;
    const cy = nd.y + nd.height / 2;
    if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
      children.push(node);
    }
  }

  if (!isCollapsed) {
    // 折叠：隐藏子节点
    for (const child of children) {
      const cd = child.getData();
      (child as any).setData?.({ ...cd, [FLAG_COLLAPSED]: true });
      const nodeEl = (child as any).nodeEl as HTMLElement | undefined;
      nodeEl?.classList.add("cp-hidden");
    }
    (groupNode as any).setData?.({ ...data, [FLAG_COLLAPSED]: true });
    new Notice(`已折叠分组（${children.length} 个节点隐藏）`);
  } else {
    // 展开：显示子节点
    for (const child of children) {
      const cd = child.getData();
      const newData = { ...cd };
      delete newData[FLAG_COLLAPSED];
      (child as any).setData?.(newData);
      const nodeEl = (child as any).nodeEl as HTMLElement | undefined;
      nodeEl?.classList.remove("cp-hidden");
    }
    const newData = { ...data };
    delete newData[FLAG_COLLAPSED];
    (groupNode as any).setData?.(newData);
    new Notice(`已展开分组`);
  }
  canvas.requestSave();
}
