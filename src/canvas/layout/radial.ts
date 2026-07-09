/**
 * 放射状（径向）布局：先跑 tree 再把深度映射到极坐标。
 * 视觉上适合思维导图。
 */
import { hierarchy, tree } from "d3-hierarchy";
import type { LayoutNode, LayoutEdge, LayoutResult } from "./types";

export interface RadialOptions {
  /** 每层半径（像素） */
  radiusStep?: number;
  /** 同层节点角间距基数 */
  angleSize?: number;
}

export function radialLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  rootId: string | undefined,
  opts: RadialOptions = {}
): LayoutResult {
  const radiusStep = opts.radiusStep ?? 260;
  const angleSize = opts.angleSize ?? 140;

  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: 0, y: 0 }]]);

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    const arr = childrenOf.get(e.from) ?? [];
    arr.push(e.to);
    childrenOf.set(e.from, arr);
    hasParent.add(e.to);
  }

  let root = rootId;
  if (!root || !nodes.find((n) => n.id === root)) {
    root = nodes.find((n) => !hasParent.has(n.id))?.id ?? nodes[0].id;
  }

  const visited = new Set<string>([root]);
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

  // d3 tree 给 x（角度轴）和 y（深度轴）
  tree<typeof rootObj>()
    .nodeSize([angleSize, radiusStep])
    .separation(() => 1)(rootH);

  const out = new Map<string, { x: number; y: number }>();
  rootH.descendants().forEach((d: any) => {
    // 极坐标：角度 = d.x / radiusStep（标准化），半径 = d.y
    const angle = (d.x / radiusStep) % (2 * Math.PI);
    const r = d.y;
    out.set(d.data.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });

  // 孤立节点放到外圈
  let orphanAngle = 0;
  const orphanR = radiusStep * (rootH.height + 2);
  for (const n of nodes) {
    if (!out.has(n.id)) {
      out.set(n.id, {
        x: Math.cos(orphanAngle) * orphanR,
        y: Math.sin(orphanAngle) * orphanR,
      });
      orphanAngle += 0.5;
    }
  }

  return out;
}
