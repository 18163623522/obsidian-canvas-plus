/**
 * Fruchterman-Reingold 力导向布局（无依赖，~60 行）
 *
 * 适用场景：节点数 <150 的链接图（笔记邻域）。无 Barnes-Hut，复杂度 O(n²)，
 * 对典型 Obsidian 邻域足够。
 *
 * 参考：Fruchterman & Reingold 1991；实现灵感来自 olvb/nodesoup（MIT）。
 */
export interface ForceNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ForceInput {
  nodes: ForceNode[];
  edges: [string, string][];
  /** 画布参考宽度/高度（用于 k 与初始化） */
  width?: number;
  height?: number;
  iterations?: number;
}

export function forceLayout(input: ForceInput): Map<string, { x: number; y: number }> {
  const { nodes, edges } = input;
  const W = input.width ?? 1400;
  const H = input.height ?? 900;
  const iters = input.iterations ?? 300;

  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    return new Map([[nodes[0].id, { x: W / 2, y: H / 2 }]]);
  }

  const area = W * H;
  const k = Math.sqrt(area / nodes.length);
  const k2 = k * k;
  // 温度退火
  const T0 = W / 10;
  const cool = (i: number) => T0 * (1 - i / iters);

  // 工作副本（避免污染输入）
  const pos = nodes.map((n, i) => ({
    id: n.id,
    x: W / 2 + Math.cos((i / nodes.length) * 2 * Math.PI) * (W / 4),
    y: H / 2 + Math.sin((i / nodes.length) * 2 * Math.PI) * (H / 4),
    vx: 0,
    vy: 0,
  }));
  const idx = new Map(pos.map((p, i) => [p.id, i]));

  for (let iter = 0; iter < iters; iter++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    // 排斥力（全对）
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < i; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // 重合点：随机微小偏移避免除零
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = k2 / d;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        disp[i].x += fx;
        disp[i].y += fy;
        disp[j].x -= fx;
        disp[j].y -= fy;
      }
    }

    // 吸引力（边）
    for (const [a, b] of edges) {
      const ia = idx.get(a);
      const ib = idx.get(b);
      if (ia === undefined || ib === undefined) continue;
      let dx = pos[ia].x - pos[ib].x;
      let dy = pos[ia].y - pos[ib].y;
      let d = Math.hypot(dx, dy);
      if (d < 0.01) d = 0.01;
      const f = (d * d) / k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      disp[ia].x -= fx;
      disp[ia].y -= fy;
      disp[ib].x += fx;
      disp[ib].y += fy;
    }

    // 应用位移（温度限幅）
    const t = cool(iter);
    for (let i = 0; i < pos.length; i++) {
      const m = Math.hypot(disp[i].x, disp[i].y);
      if (m < 0.01) continue;
      const lim = Math.min(m, t);
      pos[i].x += (disp[i].x / m) * lim;
      pos[i].y += (disp[i].y / m) * lim;
      // 软边界
      pos[i].x = Math.max(0, Math.min(W, pos[i].x));
      pos[i].y = Math.max(0, Math.min(H, pos[i].y));
    }
  }

  // 输出每个节点的中心点坐标（布局算法以中心点工作，调用方负责转左上角）
  const out = new Map<string, { x: number; y: number }>();
  for (const p of pos) out.set(p.id, { x: p.x, y: p.y });
  return out;
}
