/**
 * 节点富文本工具条（选中文本片段时弹出）
 *
 * 在编辑器（笔记 MarkdownView 或 Canvas 文本节点 CM6）内选中文字时，
 * 在选区上方弹出浮动工具条：加粗 / 斜体 / 高亮 / 行内代码 / 字号。
 *
 * 实现：document 级 selectionchange 监听，判断有非空选区且在编辑器内时显示。
 */
import type { Plugin } from "obsidian";

export class TextFormatToolbar {
  private el: HTMLElement | null = null;

  setup(plugin: Plugin): () => void {
    const onSelChange = () => this.onSelectionChange(plugin);
    document.addEventListener("selectionchange", onSelChange);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      this.destroy();
    };
  }

  private onSelectionChange(plugin: Plugin) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || sel.toString().trim() === "") {
      this.hide();
      return;
    }
    // 必须在编辑器内（CM6 的 .cm-content 或 Obsidian 编辑器）
    const anchor = sel.anchorNode;
    if (!anchor) return;
    const el = (anchor.nodeType === 3 ? anchor.parentElement : anchor) as HTMLElement | null;
    if (!el) return;
    const inEditor = el.closest(".cm-content, .markdown-source-view, .markdown-reading-view");
    if (!inEditor) {
      this.hide();
      return;
    }
    // 延迟显示，避免选区还没稳定
    setTimeout(() => this.show(plugin), 10);
  }

  private show(plugin: Plugin) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const el = this.ensureEl();
    el.empty();
    el.style.display = "flex";

    const buttons: Array<{ label: string; title: string; action: string }> = [
      { label: "B", title: "加粗", action: "bold" },
      { label: "I", title: "斜体", action: "italic" },
      { label: "H", title: "高亮", action: "highlight" },
      { label: "</>", title: "行内代码", action: "code" },
      { label: "U", title: "下划线", action: "underline" },
    ];
    for (const b of buttons) {
      const btn = el.createEl("button", {
        cls: "cp-tf-btn",
        attr: { title: b.title, "aria-label": b.title },
      });
      btn.textContent = b.label;
      if (b.action === "bold") btn.style.fontWeight = "700";
      if (b.action === "italic") btn.style.fontStyle = "italic";
      btn.onclick = () => this.applyFormat(plugin, b.action);
    }

    // 定位
    const tbRect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, rect.left + rect.width / 2 - tbRect.width / 2)}px`;
    el.style.top = `${Math.max(8, rect.top - tbRect.height - 8)}px`;
  }

  private ensureEl(): HTMLElement {
    if (this.el && document.body.contains(this.el)) return this.el;
    const el = document.body.createDiv({ cls: "cp-text-format-toolbar" });
    this.el = el;
    // 点外面关闭
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    return el;
  }

  private applyFormat(plugin: Plugin, action: string) {
    // 优先用 Obsidian 内置格式化命令（最可靠，处理选区包裹）
    const commandMap: Record<string, string> = {
      bold: "editor:toggle-bold",
      italic: "editor:toggle-italics",
      highlight: "editor:toggle-highlight",
      code: "editor:toggle-inline-code",
      underline: "editor:toggle-underline",
    };
    const cmdId = commandMap[action];
    if (cmdId) {
      // @ts-ignore executeCommandById 在运行时存在
      plugin.app.commands?.executeCommandById?.(cmdId);
    }
    this.hide();
  }

  hide() {
    if (this.el) this.el.style.display = "none";
  }

  destroy() {
    this.el?.remove();
    this.el = null;
  }
}
