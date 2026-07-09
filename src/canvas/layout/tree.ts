/**
 * 层次树布局（Reingold-Tilford "tidy tree"），基于 d3-hierarchy。
 *
 * 输入：根 id + 父子关系边。输出每个节点的中心点坐标。
 * 横向（left→right）或纵向（top→bottom）。
 */
import { hierarchy, tree } from "d3-hierarchy";
import type { LayoutNode, LayoutEdge, LayoutResult } from "./types";

export interface TreeOptions {
  /** 横向布局则 true（根在左，叶在右），否则纵向 */
  horizontal?: boolean;
  /** 节点间距（像素） */
  nodeSizeX?: number;
  nodeSizeY?: number;
}

export function treeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  rootId: string | undefined,
  opts: TreeOptions = {}
): LayoutResult {
  const horizontal = opts.horizontal ?? true;
  const sx = opts.nodeSizeX ?? 320;
  const sy = opts.nodeSizeY ?? 140;

  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    return new Map([[nodes[0].id, { x: 0, y: 0 }]]);
  }

  // 1. 构造父子关系（从边推导）
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    // 边的 from→to 默认视为 parent→child
    const arr = childrenOf.get(e.from) ?? [];
    arr.push(e.to);
    childrenOf.set(e.from, arr);
    hasParent.add(e.to);
  }

  // 2. 选根：用户指定 > 无入边的第一个节点 > 第一个节点
  let root = rootId;
  if (!root || !nodes.find((n) => n.id === root)) {
    root = nodes.find((n) => !hasParent.has(n.id))?.id ?? nodes[0].id;
  }

  // 3. d3-hierarchy：用 children 访问器
  //    为防止环（理论上 .canvas 不该有，但防御一下），用一个 visited 集合
  const visited = new Set<string>();
  const rootObj = { id: root };
  const rootH = hierarchy(rootObj, (d: any) => {
    const kids = childrenOf.get(d.id) ?? [];
    return kids
      .filter((k) => nodes.find((n) => n.id === k) && !visited.has(k))
      .map((k) => {
        visited.add(k);
        return { id: k };
      });
  });

  tree<typeof rootObj>()
    .nodeSize([sx, sy])
    // 分离重叠（d3 默认有 separation）
    .separation(() => 1)(rootH);

  // 4. 提取坐标。d3 tree: x 是"兄弟轴"，y 是"深度轴"。
  const out = new Map<string, { x: number; y: number }>();
  rootH.descendants().forEach((d: any) => {
    // 横向：x→屏幕 y，y→屏幕 x
    if (horizontal) {
      out.set(d.data.id, { x: d.y, y: d.x });
    } else {
      out.set(d.data.id, { x: d.x, y: d.y });
    }
  });

  // 孤立节点（不在树上的）放到右侧空白区，避免重叠
  const orphanX = (rootH.data ? (out.get(root)?.x ?? 0) : 0) + sx * (rootH.height + 2);
  let orphanY = 0;
  for (const n of nodes) {
    if (!out.has(n.id)) {
      out.set(n.id, { x: orphanX, y: orphanY });
      orphanY += sy;
    }
  }

  return out;
}
