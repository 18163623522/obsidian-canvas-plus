/**
 * 节点图标标记（emoji 角标）
 *
 * 给节点加一个 emoji 标记，显示在节点右上角。
 * 用于视觉分类：📌 重要 / 🔥 热门 / ✅ 完成 / ❓ 待定 等。
 * 存进 nodeData.cpIcon 字段。
 */
import type { CanvasNode } from "../types/canvas-internal";

const FLAG_ICON = "cpIcon";

const ICONS = ["📌","🔥","✅","❓","⭐","💡","🚀","❗","📚","🎯","⚠️","🔒","💡","🏁"];

/** 设置节点图标 */
export function setNodeIcon(node: CanvasNode, icon: string | undefined): void {
  const data = node.getData() as any;
  const newData: any = { ...data };
  if (!icon) delete newData[FLAG_ICON];
  else newData[FLAG_ICON] = icon;
  (node as any).setData?.(newData);
  node.canvas?.requestSave?.();
  applyIcon(node);
}

/** 应用图标到节点 DOM */
export function applyIcon(node: CanvasNode): void {
  const data = node.getData() as any;
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (!nodeEl || !document.contains(nodeEl)) return;

  // 移除旧图标
  const oldIcon = nodeEl.querySelector(".cp-node-icon");
  oldIcon?.remove();

  const icon = data[FLAG_ICON];
  if (!icon) return;

  const iconEl = document.createElement("div");
  iconEl.className = "cp-node-icon";
  iconEl.textContent = icon;
  iconEl.style.cssText = "position:absolute;top:2px;right:2px;font-size:16px;z-index:10;pointer-events:none;line-height:1";
  nodeEl.style.position = nodeEl.style.position || "relative";
  nodeEl.appendChild(iconEl);
}

/** 获取可选图标列表 */
export function getIconList(): string[] {
  return ICONS;
}
