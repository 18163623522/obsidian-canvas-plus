/**
 * Markdown → Canvas
 *
 * 把一篇笔记的标题层级 + 正文 + 出链，转成 .canvas 文件：
 *  - 每个 H1/H2/... → 一个文本节点（含该标题下的正文片段）
 *  - 笔记中每个出链（[[wikilink]] 或 [md](link)）→ 在归属的标题节点旁挂一个文件节点 + 一条边
 *  - 调用 applyLayout 自动排布
 *
 * 数据来源：app.metadataCache.getFileCache(file) 的 headings/links 与 position
 * 正文片段：app.vault.cachedRead(file) 切片
 */
import { App, TFile, Notice, normalizePath } from "obsidian";
import type {
  Canvas,
  CanvasNodeData,
  CanvasEdgeData,
} from "../types/canvas-internal";
import {
  genId,
  commitChanges,
  DEFAULT_NODE,
  bboxOf,
} from "./canvas-access";
import { applyLayout } from "./layout";

interface HeadingInfo {
  level: number;
  text: string;
  start: number; // 字符偏移
  end: number; // 下一个同级/上级标题起点（或文末）
}

interface LinkInfo {
  targetPath: string; // 已解析的目标文件 vault 相对路径；未解析则空
  displayText: string;
  offset: number; // 在源文中的字符偏移
}

/** 从 CachedMetadata + 原文构建标题区间 */
function buildHeadingSections(
  file: TFile,
  cache: any,
  content: string
): HeadingInfo[] {
  const headings: any[] = cache.headings ?? [];
  if (headings.length === 0) {
    // 无标题：整篇当一个节点
    return [
      {
        level: 1,
        text: file.basename,
        start: 0,
        end: content.length,
      },
    ];
  }
  // 按 position.start.line 升序
  const sorted = [...headings].sort(
    (a, b) => a.position.start.offset - b.position.start.offset
  );
  return sorted.map((h, i) => {
    const start = h.position.start.offset;
    const end =
      i + 1 < sorted.length ? sorted[i + 1].position.start.offset : content.length;
    return { level: h.level, text: h.heading, start, end };
  });
}

/** 把每个 link 归属到"包含它的最后一个标题" */
function assignLinksToHeadings(
  links: any[],
  sections: HeadingInfo[]
): Map<number, LinkInfo[]> {
  const out = new Map<number, LinkInfo[]>();
  for (const l of links) {
    const off = l.position.start.offset;
    // 找到最后一个 start <= off 的 section
    let idx = -1;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].start <= off && off < sections[i].end) {
        idx = i;
        break;
      }
    }
    if (idx < 0) idx = 0;
    const arr = out.get(idx) ?? [];
    arr.push({
      targetPath: l.link ?? "",
      displayText: l.displayText ?? l.original ?? "",
      offset: off,
    });
    out.set(idx, arr);
  }
  return out;
}

export interface GenerateOptions {
  /** 新建 .canvas 文件还是追加到当前画布 */
  mode: "new" | "append";
  /** 布局算法 */
  layout?: "tree" | "radial" | "force" | "dag";
  /** 是否生成出链对应的文件节点 */
  includeLinks?: boolean;
}

export async function generateCanvasFromNote(
  app: App,
  file: TFile,
  opts: GenerateOptions = { mode: "new", layout: "tree", includeLinks: true }
): Promise<TFile | null> {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) {
    new Notice("笔记元数据尚未就绪，请稍后再试");
    return null;
  }
  const content = await app.vault.cachedRead(file);
  const sections = buildHeadingSections(file, cache, content);
  const linkAssignment = opts.includeLinks
    ? assignLinksToHeadings(cache.links ?? [], sections)
    : new Map<number, LinkInfo[]>();

  // —— 构造节点 / 边 ——
  const newNodes: CanvasNodeData[] = [];
  const newEdges: CanvasEdgeData[] = [];

  // 标题节点：id → nodeData
  const sectionNodeId = new Map<number, string>();
  const headingColorByLevel: Record<number, string> = {
    1: "5",
    2: "4",
    3: "3",
    4: "2",
    5: "1",
    6: "1",
  };

  sections.forEach((s, i) => {
    const id = genId();
    sectionNodeId.set(i, id);
    // 截取该标题下的正文（去掉标题行本身）
    const body = content.slice(s.start, s.end).replace(/^#{1,6}\s*[^\n]*\n/, "").trim();
    const text = `# ${"#".repeat(s.level - 1)}${s.text}\n\n${body}`.trim();
    newNodes.push({
      id,
      type: "text",
      x: 0,
      y: 0,
      width: DEFAULT_NODE.width,
      height: DEFAULT_NODE.height,
      text,
      color: headingColorByLevel[s.level] ?? undefined,
    } as CanvasNodeData);
  });

  // 标题父子边（基于 level 推断：当前节点的父是前一个 level 更小的）
  const levelStack: { level: number; id: string }[] = [];
  sections.forEach((s, i) => {
    const id = sectionNodeId.get(i)!;
    while (levelStack.length && levelStack[levelStack.length - 1].level >= s.level) {
      levelStack.pop();
    }
    if (levelStack.length) {
      const parent = levelStack[levelStack.length - 1];
      newEdges.push({
        id: genId(),
        fromNode: parent.id,
        toNode: id,
        toEnd: "arrow",
      } as CanvasEdgeData);
    }
    levelStack.push({ level: s.level, id });
  });

  // 出链 → 文件节点 + 边（链接目标存在则建 file 节点，否则建 link 节点）
  if (opts.includeLinks) {
    const createdLinkNodes = new Map<string, string>(); // targetPath → nodeId
    for (const [sectionIdx, links] of linkAssignment.entries()) {
      const owner = sectionNodeId.get(sectionIdx);
      if (!owner) continue;
      for (const link of links) {
        // 尝试解析为 TFile
        const dest = app.metadataCache.getFirstLinkpathDest(link.targetPath, file.path);
        const key = dest?.path ?? link.targetPath;
        if (createdLinkNodes.has(key)) {
          // 已建过：只加边
          newEdges.push({
            id: genId(),
            fromNode: owner,
            toNode: createdLinkNodes.get(key)!,
            toEnd: "arrow",
            label: "link",
          } as CanvasEdgeData);
          continue;
        }
        const nid = genId();
        if (dest) {
          newNodes.push({
            id: nid,
            type: "file",
            x: 0,
            y: 0,
            width: DEFAULT_NODE.width,
            height: DEFAULT_NODE.height,
            file: dest.path,
          } as CanvasNodeData);
        } else {
          // 未解析的链接：用 link 节点保留信息
          newNodes.push({
            id: nid,
            type: "link",
            x: 0,
            y: 0,
            width: 240,
            height: 120,
            url: `obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(link.targetPath)}`,
          } as CanvasNodeData);
        }
        createdLinkNodes.set(key, nid);
        newEdges.push({
          id: genId(),
          fromNode: owner,
          toNode: nid,
          toEnd: "arrow",
          label: "link",
        } as CanvasEdgeData);
      }
    }
  }

  // —— 写入画布 ——
  let canvas: Canvas | null = null;
  if (opts.mode === "append") {
    const { getActiveCanvas } = await import("./canvas-access");
    canvas = getActiveCanvas(app);
    if (!canvas) return null;
    // 把新节点放在现有内容下方
    const existing = canvas.getData();
    const bbox = bboxOf(
      existing.nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }))
    );
    const offsetY = existing.nodes.length ? bbox.maxY + 100 : 0;
    newNodes.forEach((n) => (n.y += offsetY));
    commitChanges(canvas, (data) => {
      data.nodes.push(...newNodes);
      data.edges.push(...newEdges);
    });
  } else {
    // 新建 .canvas 文件，与笔记同目录
    const newPath = normalizePath(
      file.parent?.path ? `${file.parent.path}/${file.basename}.canvas` : `${file.basename}.canvas`
    );
    const initial = JSON.stringify({ nodes: newNodes, edges: newEdges });
    const newFile = await app.vault.create(newPath, initial);
    // 打开它并等待 canvas 视图就绪后再布局
    await app.workspace.openLinkText(newFile.path, "", true);
    await waitForCanvasReady(app);
    const { getActiveCanvas } = await import("./canvas-access");
    canvas = getActiveCanvas(app);
    if (!canvas) {
      new Notice("已创建画布文件，但布局失败：请打开后手动运行布局命令");
      return newFile;
    }
    return newFile;
  }

  // —— 自动布局 ——
  const layoutType = opts.layout ?? "tree";
  const canvasNodes = Array.from(canvas.nodes.values()).filter((n) =>
    new Set(newNodes.map((nn) => nn.id)).has(n.id)
  );
  applyLayout(canvas, canvasNodes, newEdges, { type: layoutType });
  new Notice(`已生成 ${newNodes.length} 个节点 / ${newEdges.length} 条边`);
  return opts.mode === "append" ? canvas.view.file : null;
}

/** 等到 canvas 视图真正可读 */
async function waitForCanvasReady(app: App, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const leaf = app.workspace.getLeavesOfType("canvas");
      if (leaf.length && (leaf[0] as any).view?.canvas?.getData) return resolve();
      if (Date.now() - start > timeoutMs) return resolve();
      setTimeout(tick, 50);
    };
    tick();
  });
}
