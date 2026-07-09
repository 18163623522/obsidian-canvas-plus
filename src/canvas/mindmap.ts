/**
 * 思维导图生成
 *
 * 用法：选中一个节点 → 运行"思维导图：展开选中节点" →
 *   - 若节点是文件节点：读该笔记的标题层级，每个子标题生成一个节点
 *   - 若节点是文本节点：把文本按行/列表项拆分，每段生成一个子节点
 *   - 自动连线（父→子），并套用树形布局
 *
 * 也支持：从当前笔记直接生成思维导图画布（复用 markdown-to-canvas + 树形布局）
 */
import { App, Notice, TFile } from "obsidian";
import type { Canvas, CanvasNode, CanvasEdgeData } from "../types/canvas-internal";
import { genId } from "./canvas-access";
import { applyLayout } from "./layout";

/** 把一段文本拆成"子项"（每行/每个列表项一个） */
function splitTextToItems(text: string): string[] {
  const lines = text
    .replace(/^#.*$/m, "") // 去掉第一行标题
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: string[] = [];
  for (const line of lines) {
    // 列表项 "- xxx" 或 "1. xxx"
    const m = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
    items.push(m ? m[1] : line);
  }
  return items.slice(0, 12); // 上限 12 个，避免爆炸
}

/** 读笔记的二级标题作为子项 */
function noteHeadingsToItems(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  const headings = (cache?.headings ?? []).filter((h: any) => h.level <= 2);
  return headings.map((h: any) => h.heading).slice(0, 12);
}

/** 读笔记的出链（已解析的目标文件名）作为子项 */
function noteLinksToItems(app: App, file: TFile, limit = 12): string[] {
  const cache = app.metadataCache.getFileCache(file);
  const links = cache?.links ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    const dest = app.metadataCache.getFirstLinkpathDest(l.link, file.path);
    const name = dest?.basename ?? l.displayText ?? l.link;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

export interface MindmapOptions {
  /** 拆分来源：auto（自动判断）/ headings / links / lines */
  source?: "auto" | "headings" | "links" | "lines";
  /** 子节点形状（plain 文字 / 卡片） */
  childStyle?: "plain" | "card";
}

/** 展开选中节点为思维导图 */
export function expandMindmap(app: App, canvas: Canvas, opts: MindmapOptions = {}): void {
  // 取选中节点（单个）
  const sel = Array.from(canvas.selection.values()).filter(
    (n: any) => n.getData?.()?.type === "text" || n.getData?.()?.type === "file"
  ) as CanvasNode[];
  if (sel.length === 0) {
    new Notice("请先选中一个节点");
    return;
  }
  const parent = sel[0];
  const parentData = parent.getData() as any;

  // 决定子项来源
  let items: string[] = [];
  if (parentData.type === "file") {
    const file = app.vault.getAbstractFileByPath(parentData.file);
    if (file instanceof TFile) {
      const src = opts.source ?? "auto";
      if (src === "headings") items = noteHeadingsToItems(app, file);
      else if (src === "links") items = noteLinksToItems(app, file);
      else {
        // auto: 优先标题，没有则链接
        items = noteHeadingsToItems(app, file);
        if (items.length === 0) items = noteLinksToItems(app, file);
      }
    }
  } else {
    // 文本节点：按行拆分
    items = splitTextToItems(parentData.text ?? "");
  }

  if (items.length === 0) {
    new Notice("没有可展开的内容（节点为空，或笔记无标题/链接）");
    return;
  }

  // 已存在的子节点（避免重复）：检查从 parent 出去的边
  const existingChildren = new Set<string>();
  for (const e of canvas.getData().edges) {
    if (e.fromNode === parent.id) existingChildren.add(e.toNode);
  }

  // 创建子节点
  const newNodes: CanvasNode[] = [];
  const newEdges: CanvasEdgeData[] = [];
  const isPlain = opts.childStyle === "plain";

  items.forEach((text, i) => {
    const childId = genId();
    const childNode = canvas.createTextNode({
      pos: { x: parent.x + parent.width + 120, y: parent.y + i * 80 },
      text: text,
      size: { width: 220, height: 60 },
    });
    // 标记形状
    if (isPlain) {
      const d = childNode.getData();
      (childNode as any).setData?.({ ...d, cpStyle: "plain" });
    }
    newNodes.push(childNode);
    newEdges.push({
      id: genId(),
      fromNode: parent.id,
      toNode: childNode.id,
      toEnd: "arrow",
    } as CanvasEdgeData);
  });

  canvas.requestSave();

  // 对父节点 + 新子节点套用树形布局
  const layoutNodes = [parent, ...newNodes];
  applyLayout(canvas, layoutNodes, newEdges, {
    type: "tree",
    rootId: parent.id,
    horizontal: true,
  });

  new Notice(`思维导图：已展开 ${items.length} 个子节点`);
}

/** 从当前笔记一键生成思维导图画布 */
export async function mindmapFromNote(app: App, file: TFile): Promise<TFile | null> {
  const { generateCanvasFromNote } = await import("./markdown-to-canvas");
  // 复用笔记转画布，强制树形布局
  return generateCanvasFromNote(app, file, {
    mode: "new",
    layout: "tree",
    includeLinks: true,
  });
}
