/**
 * Canvas → Markdown
 *
 * 把画布结构转成一篇带标题层级的大纲笔记：
 *  - 文本节点 → 根据拓扑深度转 #/##/### 标题 + 正文
 *  - 文件节点 → wikilink 嵌入
 *  - 链接节点 → markdown 链接
 *  - 边 → 在源节点的目标位置插入 [[目标]] 链接
 *
 * 拓扑序：对边做拓扑排序，无入边者为根；环则按当前顺序兜底。
 */
import { App, TFile, Notice, normalizePath } from "obsidian";
import type { Canvas, CanvasNodeData, CanvasEdgeData } from "../types/canvas-internal";

function topoSort(
  nodeIds: string[],
  edges: CanvasEdgeData[]
): string[] {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!indeg.has(e.fromNode) || !indeg.has(e.toNode)) continue;
    adj.get(e.fromNode)!.push(e.toNode);
    indeg.set(e.toNode, (indeg.get(e.toNode) ?? 0) + 1);
  }
  const queue = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const out: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const next of adj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if ((indeg.get(next) ?? 0) <= 0 && !seen.has(next)) queue.push(next);
    }
  }
  // 兜底：未访问的节点（成环）追加到末尾
  for (const id of nodeIds) if (!seen.has(id)) out.push(id);
  return out;
}

/** 计算每个节点相对根的深度（BFS over edges） */
function depthMap(
  roots: string[],
  edges: CanvasEdgeData[]
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const arr = adj.get(e.fromNode) ?? [];
    arr.push(e.toNode);
    adj.set(e.fromNode, arr);
  }
  const depth = new Map<string, number>();
  const queue = roots.map((r) => ({ id: r, d: 1 }));
  while (queue.length) {
    const { id, d } = queue.shift()!;
    if (depth.has(id) && depth.get(id)! <= d) continue;
    depth.set(id, d);
    for (const next of adj.get(id) ?? []) queue.push({ id: next, d: d + 1 });
  }
  return depth;
}

export async function exportCanvasToMarkdown(
  app: App,
  canvas: Canvas
): Promise<TFile | null> {
  const data = canvas.getData();
  const nodes = data.nodes;
  const edges = data.edges;
  if (nodes.length === 0) {
    new Notice("画布是空的");
    return null;
  }

  const order = topoSort(
    nodes.map((n) => n.id),
    edges
  );
  const roots = order.filter(
    (id) => !edges.some((e) => e.toNode === id)
  );
  const depth = depthMap(roots.length ? roots : [order[0]], edges);

  // 边目标索引：每个节点 → 它连出去的目标节点数组
  const outEdges = new Map<string, string[]>();
  for (const e of edges) {
    const arr = outEdges.get(e.fromNode) ?? [];
    arr.push(e.toNode);
    outEdges.set(e.fromNode, arr);
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));

  const lines: string[] = [];
  const baseName = canvas.view.file?.basename ?? "Canvas Export";
  lines.push(`# ${baseName}`);
  lines.push("");

  for (const id of order) {
    const n = nodeById.get(id);
    if (!n) continue;
    const d = Math.min(depth.get(id) ?? 2, 6);
    const hashes = "#".repeat(d);

    // 节点标题/正文
    if (n.type === "text") {
      const text = (n as any).text ?? "";
      // 若文本已以 # 开头，直接用；否则加层级前缀
      if (/^#{1,6}\s/.test(text)) {
        lines.push(text);
      } else {
        // 取第一行作标题，其余作正文
        const firstLine = text.split("\n")[0]?.trim() || "(空节点)";
        const rest = text.split("\n").slice(1).join("\n").trim();
        lines.push(`${hashes} ${firstLine}`);
        if (rest) {
          lines.push("");
          lines.push(rest);
        }
      }
    } else if (n.type === "file") {
      const f = (n as any).file as string;
      lines.push(`${hashes} ![[${f}]]`);
    } else if (n.type === "link") {
      const url = (n as any).url ?? "";
      lines.push(`${hashes} [外部链接](${url})`);
    } else if (n.type === "group") {
      lines.push(`${hashes} 📦 ${(n as any).label ?? "分组"}`);
    }
    lines.push("");

    // 出边 → wikilink 列表
    const outs = outEdges.get(id) ?? [];
    if (outs.length) {
      const links: string[] = [];
      for (const tgt of outs) {
        const t = nodeById.get(tgt);
        if (!t) continue;
        if (t.type === "text") {
          const heading = ((t as any).text ?? "")
            .replace(/^#{1,6}\s/, "")
            .split("\n")[0]
            ?.trim();
          links.push(`→ ${heading || tgt}`);
        } else if (t.type === "file") {
          links.push(`→ [[${(t as any).file}]]`);
        } else if (t.type === "link") {
          links.push(`→ [链接](${(t as any).url})`);
        }
      }
      if (links.length) {
        lines.push(`**关联：** ${links.join(" · ")}`);
        lines.push("");
      }
    }
  }

  const md = lines.join("\n");
  const file = canvas.view.file;
  const newPath = normalizePath(
    file?.parent?.path
      ? `${file.parent.path}/${file.basename}.md`
      : `${file?.basename ?? "canvas-export"}.md`
  );
  const newFile = await app.vault.create(newPath, md);
  await app.workspace.openLinkText(newFile.path, "", false);
  new Notice(`已导出到 ${newPath}`);
  return newFile;
}
