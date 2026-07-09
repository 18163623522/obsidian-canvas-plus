/**
 * 自动布局统一入口
 *
 * 调用方（命令）传入 CanvasNode[] + CanvasEdgeData[]，选择算法，
 * 本模块计算坐标后把结果写回每个节点的 x/y，并 requestSave。
 *
 * 内部做三件事：
 *  1. 选中算法 → 得到中心点坐标
 *  2. 中心点 → 左上角（减去半宽/半高）
 *  3. 整体平移让包围盒左上角对齐 (originX, originY)（默认沿用现有节点最小坐标）
 */
import type { Canvas, CanvasNode, CanvasEdgeData } from "../../types/canvas-internal";
import { treeLayout } from "./tree";
import { radialLayout } from "./radial";
import { dagLayout } from "./dag";
import { forceLayout } from "./force";
import type { LayoutNode, LayoutEdge, LayoutType } from "./types";

export interface ApplyLayoutOptions {
  type: LayoutType;
  /** 仅对选中节点布局；为 false 时作用于全部节点 */
  selectionOnly?: boolean;
  /** 树/放射布局的根节点 id；不指定则自动推断 */
  rootId?: string;
  /** 树形横向 */
  horizontal?: boolean;
  /** DAG 方向 */
  rankdir?: "TB" | "LR" | "BT" | "RL";
  /** 力导向迭代次数 */
  iterations?: number;
  /** 布局起点（左上角对齐到这里）；默认取现有节点最小坐标 */
  originX?: number;
  originY?: number;
}

export function applyLayout(
  canvas: Canvas,
  nodes: CanvasNode[],
  edges: CanvasEdgeData[],
  opts: ApplyLayoutOptions
): void {
  if (nodes.length === 0) return;

  const layoutNodes: LayoutNode[] = nodes.map((n) => ({
    id: n.id,
    width: n.width,
    height: n.height,
  }));

  // 只保留两端都在 nodes 集合内的边
  const idSet = new Set(nodes.map((n) => n.id));
  const layoutEdges: LayoutEdge[] = edges
    .filter((e) => idSet.has(e.fromNode) && idSet.has(e.toNode))
    .map((e) => ({ from: e.fromNode, to: e.toNode }));

  let centers: Map<string, { x: number; y: number }>;

  switch (opts.type) {
    case "tree":
      centers = treeLayout(layoutNodes, layoutEdges, opts.rootId, {
        horizontal: opts.horizontal,
      });
      break;
    case "radial":
      centers = radialLayout(layoutNodes, layoutEdges, opts.rootId);
      break;
    case "dag":
      centers = dagLayout(layoutNodes, layoutEdges, { rankdir: opts.rankdir });
      break;
    case "force":
      centers = forceLayout({
        nodes: layoutNodes.map((n) => ({
          id: n.id,
          x: 0,
          y: 0,
          width: n.width,
          height: n.height,
        })),
        edges: layoutEdges.map((e) => [e.from, e.to] as [string, string]),
        iterations: opts.iterations,
      });
      break;
    default:
      return;
  }

  // 中心点 → 左上角
  const topLeft = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const c = centers.get(n.id);
    if (!c) continue;
    topLeft.set(n.id, {
      x: c.x - n.width / 2,
      y: c.y - n.height / 2,
    });
  }

  // 计算包围盒以居中（让布局结果最小坐标对齐到 origin 或现有最小坐标）
  let minX = Infinity,
    minY = Infinity;
  for (const p of topLeft.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  // 默认 origin：保留当前节点中最小坐标，避免布局把内容甩到很远
  let originX = opts.originX;
  let originY = opts.originY;
  if (originX === undefined || originY === undefined) {
    let curMinX = Infinity,
      curMinY = Infinity;
    for (const n of nodes) {
      curMinX = Math.min(curMinX, n.x);
      curMinY = Math.min(curMinY, n.y);
    }
    originX = originX ?? (isFinite(curMinX) ? curMinX : 0);
    originY = originY ?? (isFinite(curMinY) ? curMinY : 0);
  }
  const dx = originX - minX;
  const dy = originY - minY;

  // 写回每个节点（直接改 x/y，调 setData 触发重渲染+保存）
  for (const n of nodes) {
    const p = topLeft.get(n.id);
    if (!p) continue;
    n.setData({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) } as any, false);
  }

  canvas.requestSave();
  canvas.zoomToFit();
}
