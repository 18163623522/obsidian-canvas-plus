/**
 * 评论/批注节点
 *
 * 在节点旁加评论气泡。数据存进 text 节点的 `%%cp:comment:作者:内容%%` 标记。
 * 轮询时给带标记的节点渲染评论气泡 DOM。
 *
 * 评论关联到目标节点：用 edge 连接（评论节点 -> 目标节点）。
 */
import { App, Plugin, Notice, Modal, Setting } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { addNodeData, genId } from "./canvas-access";

const COMMENT_RE = /%%cp:comment:([^:]*):(.+?)%%/s;
const rendered = new WeakSet<HTMLElement>();

export function setupCommentNodes(plugin: Plugin): () => void {
  const apply = () => renderComments(plugin.app);
  const timer = setInterval(apply, 500);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
  };
}

function renderComments(app: App) {
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas?.nodes) return;
  for (const node of canvas.nodes.values()) {
    renderOne(node);
  }
}

function renderOne(node: CanvasNode) {
  const data = node.getData() as any;
  if (!data || data.type !== "text") return;
  const text: string = data.text ?? "";
  const m = text.match(COMMENT_RE);
  if (!m) return;

  const contentEl = (node as any).contentEl as HTMLElement | undefined;
  if (!contentEl || !document.contains(contentEl)) return;

  const author = m[1] || "匿名";
  const content = m[2] || "";

  // 已渲染且内容没变则跳过
  const existing = contentEl.querySelector(".cp-comment-widget");
  if (existing && existing.getAttribute("data-key") === text) return;
  existing?.remove();

  contentEl.innerHTML = "";
  const widget = contentEl.createDiv({ cls: "cp-comment-widget" });
  widget.setAttribute("data-key", text);

  const header = widget.createDiv({ cls: "cp-comment-header" });
  header.createSpan({ cls: "cp-comment-author", text: "💬 " + author });

  const body = widget.createDiv({ cls: "cp-comment-body" });
  body.textContent = content;

  const footer = widget.createDiv({ cls: "cp-comment-footer" });
  const editBtn = footer.createEl("button", { text: "编辑" });
  editBtn.onclick = () => {
    const newText = window.prompt("编辑评论", content);
    if (newText !== null) {
      const newText2 = newText.replace(/%%/g, "");
      const d = node.getData();
      (node as any).setData?.({ ...d, text: `%%cp:comment:${author}:${newText2}%%` });
      node.canvas?.requestSave?.();
    }
  };
  const delBtn = footer.createEl("button", { text: "删除" });
  delBtn.onclick = () => {
    (node.canvas as any)?.removeNode?.(node);
  };
}

/** 创建评论节点 */
export function createCommentNode(canvas: Canvas, app: App, targetNode?: CanvasNode): void {
  const author = app.vault.getName() || "匿名";
  const modal = new CommentModal(app, author, (content) => {
    const c = canvas.posCenter?.() ?? { x: 0, y: 0 };
    let x = c.x + 200;
    let y = c.y - 50;
    if (targetNode) {
      const td = targetNode.getData();
      x = td.x + td.width + 60;
      y = td.y;
    }
    const id = addNodeData(canvas, {
      type: "text",
      x,
      y,
      width: 220,
      height: 120,
      text: `%%cp:comment:${author}:${content}%%`,
      color: "3",
    });
    // 如果有目标节点，连一条边
    if (targetNode) {
      const td = targetNode.getData();
      const data = canvas.getData();
      data.edges.push({
        id: genId(),
        fromNode: td.id,
        toNode: id,
        toEnd: "arrow",
        color: "3",
      });
      canvas.setData(data);
    }
    canvas.requestSave();
    new Notice("已添加评论");
  });
  modal.open();
}

class CommentModal extends Modal {
  private author: string;
  private content = "";
  private onSubmit: (content: string) => void;

  constructor(app: App, author: string, onSubmit: (content: string) => void) {
    super(app);
    this.author = author;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "添加评论" });

    new Setting(contentEl).setName("内容").addTextArea((t) => {
      t.setPlaceholder("输入评论内容...");
      t.onChange((v) => (this.content = v));
      t.inputEl.style.width = "300px";
      t.inputEl.style.height = "80px";
    });

    new Setting(contentEl).addButton((b) => {
      b.setButtonText("添加");
      b.setCta();
      b.onClick(() => {
        if (!this.content.trim()) {
          new Notice("请输入评论内容");
          return;
        }
        this.close();
        this.onSubmit(this.content.trim());
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
