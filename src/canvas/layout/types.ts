/**
 * 布局算法共享类型
 *
 * 约定：所有算法返回的是节点中心点坐标（layout space），
 * 由 index.ts 负责转成 canvas 的左上角坐标并整体平移居中。
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

/** id → 中心点坐标 */
export type LayoutResult = Map<string, { x: number; y: number }>;

export type LayoutType = "tree" | "radial" | "force" | "dag";
