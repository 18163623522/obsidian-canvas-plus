/**
 * 画布访问工具
 *
 * 安全地从运行时取出 Canvas 实例，并提供节点/边创建的便捷包装。
 * 所有写操作都通过 canvas.setData + requestSave，与官方/LNIC 实现一致。
 */
import { App, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { Canvas, CanvasNode, CanvasEdgeData, CanvasNodeData } from "../types/canvas-internal";

/** 16 字符小写十六进制 id（JSON Canvas 规范） */
export function genId(): string {
  let s = "";
  const hex = "0123456789abcdef";
  for (let i = 0; i < 16; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

/** 获取当前激活的 canvas 视图；若没有返回 null */
export function getActiveCanvasLeaf(app: App): WorkspaceLeaf | null {
  // 优先当前聚焦的叶子：多画布并排时命令作用于"正在看的"画布，
  // 而不是 getLeavesOfType 顺序里的最后一个
  const active = (app.workspace as any).activeLeaf;
  if (active && (active as any).view?.getViewType?.() === "canvas") {
    return active as WorkspaceLeaf;
  }
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (leaves.length === 0) return null;
  // 回退：最后一个 canvas 叶子（Obsidian 内部按聚焦顺序维护）
  return leaves[leaves.length - 1];
}

/** 从叶子取出 Canvas 实例（无官方类型，需断言） */
export function getCanvasFromLeaf(leaf: WorkspaceLeaf): Canvas | null {
  const view = (leaf as any).view;
  if (!view || view.getViewType?.() !== "canvas") return null;
  return (view as any).canvas ?? null;
}

/** 取激活画布；若无打开的 .canvas 视图，提示并返回 null */
export function getActiveCanvas(app: App): Canvas | null {
  const leaf = getActiveCanvasLeaf(app);
  if (!leaf) {
    new Notice("请先打开一个 .canvas 白板");
    return null;
  }
  return getCanvasFromLeaf(leaf);
}

/**
 * 诊断：把 Canvas API 访问链路的真实结构打印出来。
 * 在 Obsidian Console (Ctrl+Shift+I) 和 Notice 同时输出，
 * 用于精确定位白板功能失效的环节。
 */
export function diagnoseCanvas(app: App): void {
  const log: string[] = [];
  const push = (s: string) => {
    log.push(s);
    console.log("[canvas-plus diag] " + s);
  };

  push("=== 开始诊断 ===");

  // 1. 是否有 canvas 叶子
  const leaves = app.workspace.getLeavesOfType("canvas");
  push(`1. canvas 叶子数: ${leaves.length}`);
  if (leaves.length === 0) {
    push("  ❌ 没有打开的 .canvas 视图 → 请先打开一个白板");
    finish();
    return;
  }

  const leaf = leaves[leaves.length - 1];
  const view = (leaf as any).view;
  push(`2. leaf.view 类型: ${view?.getViewType?.() ?? "未知"}`);
  push(`   leaf.view 是否存在: ${!!view}`);
  push(`   leaf.view.canvas 是否存在: ${!!view?.canvas}`);

  if (!view || view.getViewType?.() !== "canvas") {
    push("  ❌ view 不是 canvas 类型");
    push(`   view 的所有键: ${view ? Object.keys(view).join(", ") : "无 view"}`);
    finish();
    return;
  }

  const canvas = view.canvas;
  if (!canvas) {
    push("  ❌ view.canvas 不存在！");
    push(`   view 的所有键: ${Object.keys(view).join(", ")}`);
    finish();
    return;
  }

  // 3. Canvas 对象的关键方法/属性
  push("3. Canvas 对象诊断:");
  push(`   getData: ${typeof canvas.getData}`);
  push(`   setData: ${typeof canvas.setData}`);
  push(`   requestSave: ${typeof canvas.requestSave}`);
  push(`   createTextNode: ${typeof canvas.createTextNode}`);
  push(`   nodes (Map): ${canvas.nodes?.constructor?.name}, size=${canvas.nodes?.size}`);
  push(`   edges (Map): ${canvas.edges?.constructor?.name}, size=${canvas.edges?.size}`);
  push(`   selection: ${canvas.selection?.constructor?.name}, size=${canvas.selection?.size}`);

  // 当前数据
  try {
    const data = canvas.getData();
    push(`4. getData() 成功: ${data.nodes?.length ?? 0} 节点, ${data.edges?.length ?? 0} 边`);
  } catch (e: any) {
    push(`4. ❌ getData 抛错: ${e?.message ?? e}`);
  }

  // createTextNode 签名探测
  push(`5. createTextNode 源码前 200 字符:`);
  try {
    push(`   ${canvas.createTextNode.toString().slice(0, 200)}`);
  } catch (e: any) {
    push(`   (无法获取源码: ${e?.message})`);
  }

  push("=== 诊断完成 ===");

  function finish() {
    // Notice 太长会被截断，把关键结论用 Notice 显示，完整在 console
    const summary = log.filter((l) => l.includes("❌") || l.includes("✓") || l.match(/^[0-9]\./));
    new Notice(log.join("\n"), 10000);
  }
}

export interface NewNodeInput {
  text?: string;
  file?: string; // 文件节点：vault 内相对路径
  url?: string; // 链接节点
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
}

/** 默认文本节点尺寸 */
export const DEFAULT_NODE = { width: 300, height: 200 } as const;

/**
 * 把任意多个节点 + 边直接写入 canvas.data（持久化路径）。
 * 这是批量操作的统一入口：修改 data 快照 → setData → requestSave。
 */
export function commitChanges(
  canvas: Canvas,
  mutator: (data: {
    nodes: CanvasNodeData[];
    edges: CanvasEdgeData[];
  }) => void
): void {
  const data = canvas.getData();
  const snapshot = {
    nodes: [...data.nodes],
    edges: [...data.edges],
  };
  mutator(snapshot);
  canvas.setData({ nodes: snapshot.nodes, edges: snapshot.edges });
  canvas.requestSave();
}

/** 取所有节点（数组形式，方便布局算法遍历） */
export function allNodes(canvas: Canvas): CanvasNode[] {
  return Array.from(canvas.nodes.values());
}

/** 取选中节点；若没有选中则返回全部 */
export function targetNodes(canvas: Canvas): CanvasNode[] {
  const sel = Array.from(canvas.selection.values()).filter(
    (n) => "nodeData" in n || "getBBox" in n
  ) as CanvasNode[];
  return sel.length > 0 ? sel : allNodes(canvas);
}

/**
 * 仅取当前选中节点，无选中时返回空数组（不回退到全部节点）。
 * Mindo 等要求明确选中目标的命令用这个——回退到"全部节点的第一个"
 * 会让命令作用到意料之外的节点上。
 */
export function selectedNodes(canvas: Canvas): CanvasNode[] {
  const sel = canvas.selection;
  if (!sel) return [];
  return Array.from(sel.values()).filter(
    (n) => "nodeData" in n || "getBBox" in n
  ) as CanvasNode[];
}

/** 计算 nodes 的包围盒（用于居中/缩放） */
export function bboxOf(nodes: { x: number; y: number; width: number; height: number }[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 可靠创建节点
 *
 * 优先用原生单节点 API（createTextNode / createFileNode / createLinkNode /
 * createGroupNode）：只新增一个节点，不触发全画布 DOM 重建。
 *
 * 重要背景：旧实现走 getData→append→setData（数据快照模式），而全量 setData
 * 会重建所有节点的 DOM，把其他插件写在节点 DOM 上的标记抹掉——例如
 * Mindo Canvas 的卡片皮肤靠 nodeEl.dataset.mindo 驱动，一次全量 setData
 * 就会让整张画布的卡片皮肤全部消失。原生 API（Mindo Canvas 自己也在用）
 * 无此副作用。
 *
 * 原生 API 不可用（旧版 Obsidian）时，退回数据快照模式。
 *
 * @returns 新节点的 id
 */
export function addNodeData(
  canvas: Canvas,
  nodeData: Partial<CanvasNodeData> & { type: string }
): string {
  const c = canvas as any;
  const pos = { x: nodeData.x ?? 0, y: nodeData.y ?? 0 };
  const size = {
    width: nodeData.width ?? (nodeData.type === "file" ? 400 : 300),
    height: nodeData.height ?? (nodeData.type === "file" ? 300 : 200),
  };
  try {
    let node: any = null;
    if (nodeData.type === "text" && typeof c.createTextNode === "function") {
      node = c.createTextNode({ pos, size, text: nodeData.text ?? "", color: nodeData.color });
    } else if (nodeData.type === "file" && typeof c.createFileNode === "function") {
      node = c.createFileNode({ pos, size, file: (nodeData as any).file, color: nodeData.color });
    } else if (nodeData.type === "link" && typeof c.createLinkNode === "function") {
      node = c.createLinkNode({ pos, size, url: (nodeData as any).url, color: nodeData.color });
    } else if (nodeData.type === "group" && typeof c.createGroupNode === "function") {
      node = c.createGroupNode({
        pos,
        size,
        label: (nodeData as any).label,
        color: nodeData.color,
        moveNodes: false,
      });
    }
    if (node?.id) {
      canvas.requestSave();
      return node.id;
    }
  } catch (e) {
    console.warn("[canvas-plus] 原生节点创建失败，退回数据快照模式", e);
  }

  // —— 兜底：数据快照模式（会重建全画布 DOM，可能抹掉其他插件的节点 DOM 标记）——
  const id = nodeData.id ?? genId();
  const full: any = {
    // 先放自定义字段
    ...(nodeData as any),
    // 再覆盖标准字段（保证不被自定义字段覆盖）
    id,
    type: nodeData.type,
    x: nodeData.x ?? 0,
    y: nodeData.y ?? 0,
    width: nodeData.width ?? 300,
    height: nodeData.height ?? 200,
  };
  // 可选字段只在有值时加
  if (nodeData.color !== undefined) full.color = nodeData.color;
  if (nodeData.text !== undefined) full.text = nodeData.text;
  if ((nodeData as any).file !== undefined) full.file = (nodeData as any).file;
  if ((nodeData as any).url !== undefined) full.url = (nodeData as any).url;
  if ((nodeData as any).label !== undefined) full.label = (nodeData as any).label;

  const data = canvas.getData();
  data.nodes = [...data.nodes, full];
  canvas.setData(data);
  canvas.requestSave();
  return id;
}

/** 创建文本节点的便捷封装（数据快照模式） */
export function createTextViaData(
  canvas: Canvas,
  opts: { x: number; y: number; text?: string; width?: number; height?: number; color?: string }
): string {
  return addNodeData(canvas, {
    type: "text",
    x: opts.x,
    y: opts.y,
    width: opts.width ?? 300,
    height: opts.height ?? 200,
    text: opts.text ?? "",
    color: opts.color,
  });
}

/** 创建文件节点的便捷封装 */
export function createFileViaData(
  canvas: Canvas,
  opts: { x: number; y: number; file: string; width?: number; height?: number }
): string {
  return addNodeData(canvas, {
    type: "file",
    x: opts.x,
    y: opts.y,
    width: opts.width ?? 400,
    height: opts.height ?? 300,
    file: opts.file,
  });
}

/** 创建链接节点的便捷封装 */
export function createLinkViaData(
  canvas: Canvas,
  opts: { x: number; y: number; url: string; width?: number; height?: number }
): string {
  return addNodeData(canvas, {
    type: "link",
    x: opts.x,
    y: opts.y,
    width: opts.width ?? 400,
    height: opts.height ?? 300,
    url: opts.url,
  });
}
