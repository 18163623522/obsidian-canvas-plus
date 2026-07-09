/**
 * 知识图谱 N 度展开
 *
 * 选中一个文件节点（或文本节点），根据 vault 的链接关系：
 *  - 文件节点：BFS resolvedLinks N 层，每层生成为文件节点 + 边
 *  - 文本节点：尝试解析文本里的 [[wikilink]]，找到对应文件后同上
 *
 * 已存在的节点不重复创建。展开后用力导向布局。
 */
import { App, Notice, TFile } from "obsidian";
import type { Canvas, CanvasNode, CanvasEdgeData } from "../types/canvas-internal";
import { addNodeData } from "./canvas-access";
import { applyLayout } from "./layout";

interface ExpandOptions {
  /** 展开深度（1=直接链接，2=链接的链接...） */
  depth: number;
  /** 每层最多展开几个节点（防止爆炸） */
  maxPerLayer: number;
}

/**
 * 取一个文件的 N 度链接关系（BFS）
 * 返回：files = 涉及的所有 TFile，edges = [源path, 目标path] 数组
 */
function collectLinks(
  app: App,
  startFile: TFile,
  depth: number,
  maxPerLayer: number
): { files: TFile[]; edges: Array<[string, string]> } {
  const rl = app.metadataCache.resolvedLinks;
  const result: { files: TFile[]; edges: Array<[string, string]> } = {
    files: [startFile],
    edges: [],
  };
  const seen = new Set<string>([startFile.path]);
  let frontier: string[] = [startFile.path];

  for (let h = 0; h < depth && frontier.length > 0; h++) {
    const next: string[] = [];
    let count = 0;
    for (const src of frontier) {
      const targets = rl[src] ?? {};
      for (const dst of Object.keys(targets)) {
        // 边
        result.edges.push([src, dst]);
        if (seen.has(dst)) continue;
        seen.add(dst);
        const f = app.vault.getAbstractFileByPath(dst);
        if (f instanceof TFile) {
          result.files.push(f);
          next.push(dst);
          count++;
          if (count >= maxPerLayer) break;
        }
      }
      if (count >= maxPerLayer) break;
    }
    frontier = next;
  }
  return result;
}

/** 从文本节点的文本里解析 [[wikilink]] 并找到对应文件 */
function extractLinksFromText(app: App, text: string, sourcePath: string): TFile[] {
  const files: TFile[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const link = m[1].split("|")[0].split("#")[0].trim();
    const dest = app.metadataCache.getFirstLinkpathDest(link, sourcePath);
    if (dest) files.push(dest);
  }
  return files;
}

/** 主入口：展开选中节点的链接关系 */
export function expandGraph(app: App, canvas: Canvas, opts: ExpandOptions = { depth: 2, maxPerLayer: 15 }): void {
  const sel = Array.from(canvas.selection.values()).filter((n: any) => n?.getData?.()) as CanvasNode[];
  if (sel.length === 0) {
    new Notice("请先选中一个节点");
    return;
  }
  const startNode = sel[0];
  const startData = startNode.getData() as any;

  // 判断来源
  let startFile: TFile | null = null;
  if (startData.type === "file") {
    const f = app.vault.getAbstractFileByPath(startData.file);
    if (!(f instanceof TFile)) {
      new Notice("该节点不是有效的文件节点");
      return;
    }
    startFile = f;
  } else if (startData.type === "text") {
    // 从文本里解析链接
    const links = extractLinksFromText(app, startData.text ?? "", "");
    if (links.length === 0) {
      new Notice("文本节点里没有 [[wikilink]]，无法展开");
      return;
    }
    // 取第一个链接作为起点
    startFile = links[0];
  } else {
    new Notice("请选中文件节点或含链接的文本节点");
    return;
  }

  // 收集 N 度链接
  const { files, edges } = collectLinks(app, startFile, opts.depth, opts.maxPerLayer);

  // 已存在的文件节点（避免重复）
  const existingNodes = canvas.getData().nodes;
  const pathToNodeId = new Map<string, string>();
  for (const n of existingNodes) {
    if ((n as any).type === "file") pathToNodeId.set((n as any).file, n.id);
  }

  // 创建新节点
  const newNodes: any[] = [];
  const startX = startNode.x;
  const startY = startNode.y;
  for (const f of files) {
    if (pathToNodeId.has(f.path)) continue; // 已存在
    const id = addNodeData(canvas, {
      type: "file",
      x: startX + (Math.random() - 0.5) * 400,
      y: startY + (Math.random() - 0.5) * 400,
      width: 250,
      height: 150,
      file: f.path,
    });
    pathToNodeId.set(f.path, id);
    newNodes.push({ id, x: 0, y: 0, width: 250, height: 150 });
  }

  // 创建边（避免重复）
  const existingEdges = new Set(
    existingNodes.length > 0
      ? canvas.getData().edges.map((e) => `${e.fromNode}->${e.toNode}`)
      : []
  );
  const newEdges: CanvasEdgeData[] = [];
  for (const [srcPath, dstPath] of edges) {
    const fromId = pathToNodeId.get(srcPath);
    const toId = pathToNodeId.get(dstPath);
    if (!fromId || !toId || fromId === toId) continue;
    const key = `${fromId}->${toId}`;
    const revKey = `${toId}->${fromId}`;
    if (existingEdges.has(key) || existingEdges.has(revKey)) continue;
    existingEdges.add(key);
    newEdges.push({
      id: Math.random().toString(36).slice(2, 18),
      fromNode: fromId,
      toNode: toId,
      toEnd: "arrow",
    } as CanvasEdgeData);
  }

  // 把新边写入
  if (newEdges.length > 0) {
    const data = canvas.getData();
    canvas.setData({ ...data, edges: [...data.edges, ...newEdges] });
    canvas.requestSave();
  }

  // 对所有节点用力导向布局
  const allNodes = Array.from(canvas.nodes.values()).map((n: any) => ({
    id: n.id,
    width: n.width,
    height: n.height,
  }));
  const allEdges = canvas.getData().edges.map((e) => ({ from: e.fromNode, to: e.toNode }));
  applyLayout(canvas, allNodes as any, allEdges as any, { type: "force" });

  new Notice(`知识图谱：展开 ${files.length} 个节点 / ${newEdges.length} 条边`);
}

/** 快捷展开：选中节点 -> 右键 -> 展开链接（1度） */
export function expandOneDegree(app: App, canvas: Canvas): void {
  expandGraph(app, canvas, { depth: 1, maxPerLayer: 20 });
}

/** 深度展开：选中节点 -> 右键 -> 展开 2 度 */
export function expandTwoDegrees(app: App, canvas: Canvas): void {
  expandGraph(app, canvas, { depth: 2, maxPerLayer: 12 });
}
