/**
 * 连线标签与样式增强
 *
 * 给边加：标签文字、颜色、箭头方向（双向/无箭头/终点箭头）
 * 持久化到 edgeData 的 label / color / fromEnd / toEnd 字段（JSON Canvas 原生支持）。
 */
import type { Canvas, CanvasEdgeData } from "../types/canvas-internal";

/** 设置边的标签 */
export function setEdgeLabel(edge: any, label: string): void {
  const data = edge.getData();
  edge.setData?.({ ...data, label: label || undefined });
  edge.canvas?.requestSave?.();
}

/** 设置边的颜色 */
export function setEdgeColor(edge: any, color: string): void {
  const data = edge.getData();
  edge.setData?.({ ...data, color: color || undefined });
  edge.canvas?.requestSave?.();
}

/** 设置箭头方向 */
export function setEdgeArrow(edge: any, mode: "none" | "forward" | "backward" | "both"): void {
  const data = edge.getData();
  const newData = { ...data };
  switch (mode) {
    case "none":
      newData.fromEnd = "none"; newData.toEnd = "none"; break;
    case "forward":
      newData.fromEnd = "none"; newData.toEnd = "arrow"; break;
    case "backward":
      newData.fromEnd = "arrow"; newData.toEnd = "none"; break;
    case "both":
      newData.fromEnd = "arrow"; newData.toEnd = "arrow"; break;
  }
  edge.setData?.(newData);
  edge.canvas?.requestSave?.();
}

/** 获取边的当前箭头模式 */
export function getEdgeArrowMode(edge: any): string {
  const data = edge.getData();
  const f = data.fromEnd ?? "none";
  const t = data.toEnd ?? "arrow";
  if (f === "none" && t === "none") return "none";
  if (f === "none" && t === "arrow") return "forward";
  if (f === "arrow" && t === "none") return "backward";
  if (f === "arrow" && t === "arrow") return "both";
  return "forward";
}
