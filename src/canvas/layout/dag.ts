/**
 * DAG / 流程图布局：基于 @dagrejs/dagre 的 Sugiyama 分层算法。
 *
 * 适合有明确方向流的流程图。输出每个节点的中心点。
 */
import dagre from "@dagrejs/dagre";
import type { LayoutNode, LayoutEdge, LayoutResult } from "./types";

export interface DagOptions {
  /** 布局方向：TB(顶→底) / LR(左→右) / BT / RL */
  rankdir?: "TB" | "LR" | "BT" | "RL";
  /** 层间距 */
  ranksep?: number;
  /** 同层节点间距 */
  nodesep?: number;
}

export function dagLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: DagOptions = {}
): LayoutResult {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: 0, y: 0 }]]);

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: opts.rankdir ?? "LR",
    ranksep: opts.ranksep ?? 80,
    nodesep: opts.nodesep ?? 40,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    // 用节点自身尺寸，让 dagre 不重叠
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  for (const e of edges) {
    // 跳过不存在的端点（防御）
    if (g.hasNode(e.from) && g.hasNode(e.to)) {
      g.setEdge(e.from, e.to);
    }
  }

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number }>();
  g.nodes().forEach((id) => {
    const node = g.node(id);
    if (node) out.set(id, { x: node.x, y: node.y });
  });
  return out;
}
