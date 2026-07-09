/**
 * 批量节点操作
 *
 * 三种来源 → 批量在画布上创建文件节点 + 自动连边（基于真实笔记链接关系）：
 *  - 标签：app.metadataCache.getResolvedLinks() 不直接给 tag，改用遍历 + frontmatter/inline tags
 *  - 文件夹：app.vault.getAbstractFileByPath(folder).children 递归
 *  - 搜索：app.vault.getAllLoadedFiles() + 关键字过滤
 *
 * 同一批次内，若两个文件之间有 resolvedLinks 边，则在画布上建对应 edge。
 */
import { App, TFile, TFolder, Notice, Modal, Setting } from "obsidian";
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

/** 收集 vault 中所有 markdown 文件 */
function allMarkdownFiles(app: App): TFile[] {
  return app.vault.getMarkdownFiles();
}

/** 拿一个文件的标签集合（frontmatter + inline） */
function tagsOf(app: App, file: TFile): Set<string> {
  const cache = app.metadataCache.getFileCache(file);
  const out = new Set<string>();
  const fm = cache?.frontmatter?.tags;
  if (fm) {
    const arr = Array.isArray(fm) ? fm : String(fm).split(/[,]\s*/);
    for (const t of arr) if (t) out.add(String(t).replace(/^#/, ""));
  }
  for (const t of cache?.tags ?? []) {
    out.add(t.tag.replace(/^#/, ""));
  }
  return out;
}

/** 取某文件夹下所有 md（递归） */
function filesInFolder(app: App, folderPath: string): TFile[] {
  const entry = app.vault.getAbstractFileByPath(folderPath);
  if (!entry || !(entry instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (folder: TFolder) => {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") out.push(child);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(entry);
  return out;
}

export type BulkSource = "tag" | "folder" | "search";

export interface BulkOptions {
  source: BulkSource;
  /** tag 模式：标签名（不含 #）；folder 模式：文件夹路径；search 模式：关键字 */
  query: string;
  /** 布局算法 */
  layout?: "tree" | "radial" | "force" | "dag";
  /** 是否在批量生成的节点间根据真实链接建边 */
  linkEdges?: boolean;
  /** 上限 */
  limit?: number;
}

/** 主入口：根据来源收集文件 → 建节点+边 → 写入当前画布 → 布局 */
export async function bulkCreate(
  app: App,
  canvas: Canvas,
  opts: BulkOptions
): Promise<void> {
  let files: TFile[] = [];
  switch (opts.source) {
    case "tag": {
      const q = opts.query.replace(/^#/, "").toLowerCase();
      files = allMarkdownFiles(app).filter((f) => {
        for (const t of tagsOf(app, f)) if (t.toLowerCase() === q) return true;
        return false;
      });
      break;
    }
    case "folder": {
      files = filesInFolder(app, opts.query.trim().replace(/\/$/, ""));
      break;
    }
    case "search": {
      const q = opts.query.toLowerCase();
      if (!q) {
        new Notice("请输入搜索关键字");
        return;
      }
      // 简单子串匹配（路径 + 缓存的标题/正文片段）。重负载但够用。
      const all = allMarkdownFiles(app);
      const matched: TFile[] = [];
      for (const f of all) {
        if (f.path.toLowerCase().includes(q)) {
          matched.push(f);
          continue;
        }
        const cache = app.metadataCache.getFileCache(f);
        if (cache?.headings?.some((h: any) => h.heading.toLowerCase().includes(q))) {
          matched.push(f);
        }
      }
      files = matched;
      break;
    }
  }

  if (opts.limit && files.length > opts.limit) files = files.slice(0, opts.limit);

  if (files.length === 0) {
    new Notice(`没有匹配到文件（${opts.source}: ${opts.query}）`);
    return;
  }

  // —— 构造节点 + 边 ——
  const existing = canvas.getData();
  // 已存在的文件节点（避免重复）
  const existingFileNodes = new Map<string, string>();
  for (const n of existing.nodes) {
    if (n.type === "file") existingFileNodes.set((n as any).file, n.id);
  }

  const newNodes: CanvasNodeData[] = [];
  const newEdges: CanvasEdgeData[] = [];
  const pathToNodeId = new Map<string, string>(existingFileNodes);

  // 标签着色
  const tagColor = opts.source === "tag" ? "4" : undefined;

  for (const f of files) {
    if (pathToNodeId.has(f.path)) continue; // 已存在则跳过
    const id = genId();
    pathToNodeId.set(f.path, id);
    newNodes.push({
      id,
      type: "file",
      x: 0,
      y: 0,
      width: DEFAULT_NODE.width,
      height: DEFAULT_NODE.height,
      file: f.path,
      color: tagColor,
    } as CanvasNodeData);
  }

  // 链接边
  if (opts.linkEdges !== false) {
    const inBatch = new Set(files.map((f) => f.path));
    const rl = app.metadataCache.resolvedLinks;
    for (const src of files) {
      const targets = rl[src.path] ?? {};
      for (const dst of Object.keys(targets)) {
        if (!inBatch.has(dst)) continue;
        const fromId = pathToNodeId.get(src.path);
        const toId = pathToNodeId.get(dst);
        if (!fromId || !toId || fromId === toId) continue;
        newEdges.push({
          id: genId(),
          fromNode: fromId,
          toNode: toId,
          toEnd: "arrow",
        } as CanvasEdgeData);
      }
    }
  }

  // 把新节点平移到现有内容下方
  const bbox = bboxOf(
    existing.nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }))
  );
  const offsetY = existing.nodes.length ? bbox.maxY + 100 : 0;
  newNodes.forEach((n) => (n.y += offsetY));

  commitChanges(canvas, (data) => {
    data.nodes.push(...newNodes);
    data.edges.push(...newEdges);
  });

  // 对新增节点布局
  if (newNodes.length) {
    const createdIds = new Set(newNodes.map((n) => n.id));
    const canvasNodes = Array.from(canvas.nodes.values()).filter((n) =>
      createdIds.has(n.id)
    );
    applyLayout(canvas, canvasNodes, newEdges, {
      type: opts.layout ?? "force",
    });
  }

  new Notice(
    `已创建 ${newNodes.length} 个节点 / ${newEdges.length} 条边（${opts.source}: ${opts.query}）`
  );
}

// ============================================================
//  交互式选择 Modal（标签/文件夹/搜索）
// ============================================================

/** 弹一个输入框让用户填来源信息 */
export class BulkCreateModal extends Modal {
  private source: BulkSource = "tag";
  private query = "";
  private layout: BulkOptions["layout"] = "force";
  private linkEdges = true;
  private onSubmit: (opts: BulkOptions) => void;

  constructor(app: App, defaultSource: BulkSource, onSubmit: (opts: BulkOptions) => void) {
    super(app);
    this.source = defaultSource;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "批量创建节点" });

    new Setting(contentEl)
      .setName("来源类型")
      .setDesc("选择从哪里收集文件")
      .addDropdown((d) => {
        d.addOption("tag", "标签 (#tag)");
        d.addOption("folder", "文件夹");
        d.addOption("search", "关键字搜索");
        d.setValue(this.source);
        d.onChange((v) => (this.source = v as BulkSource));
      });

    new Setting(contentEl)
      .setName(this.settingLabel(this.source))
      .addText((t) => {
        t.setValue(this.query);
        t.onChange((v) => (this.query = v));
      });

    new Setting(contentEl)
      .setName("布局算法")
      .addDropdown((d) => {
        d.addOption("force", "力导向");
        d.addOption("tree", "树形");
        d.addOption("radial", "放射");
        d.addOption("dag", "流程图");
        d.setValue(this.layout ?? "force");
        d.onChange((v) => (this.layout = v as any));
      });

    new Setting(contentEl)
      .setName("根据真实链接建边")
      .addToggle((tg) => {
        tg.setValue(this.linkEdges);
        tg.onChange((v) => (this.linkEdges = v));
      });

    new Setting(contentEl).addButton((b) => {
      b.setButtonText("创建");
      b.setCta();
      b.onClick(() => {
        if (!this.query.trim() && this.source !== "search") {
          new Notice("请填写查询内容");
          return;
        }
        this.close();
        this.onSubmit({
          source: this.source,
          query: this.query.trim(),
          layout: this.layout,
          linkEdges: this.linkEdges,
        });
      });
    });
  }

  private settingLabel(source: BulkSource): string {
    switch (source) {
      case "tag":
        return "标签名（不含 #）";
      case "folder":
        return "文件夹路径（如 Notes/Projects）";
      case "search":
        return "关键字（匹配路径或标题）";
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
