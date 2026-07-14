/**
 * 节点内嵌搜索
 *
 * 选中文件节点 -> 命令/右键 -> 输入关键词 ->
 * 在节点内容里高亮所有匹配项，并可跳转上一个/下一个。
 *
 * 实现：在节点的 markdown-preview-view 里搜索文本节点，
 * 给匹配的文字加 <mark> 高亮，记录位置列表。
 */
import { App, Notice, Modal, Setting } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";

let activeHighlights: HTMLElement[] = [];
let currentIndex = -1;

/** 搜索节点内容 */
export function searchInNode(app: App, canvas: Canvas): void {
  const sel = Array.from(canvas.selection.values()).filter(
    (n: any) => n?.getData?.()?.type === "file" || n?.getData?.()?.type === "text"
  ) as CanvasNode[];
  if (sel.length === 0) {
    new Notice("请先选中一个节点");
    return;
  }
  const node = sel[0];
  new SearchModal(app, node).open();
}

class SearchModal extends Modal {
  private node: CanvasNode;
  private keyword = "";

  constructor(app: App, node: CanvasNode) {
    super(app);
    this.node = node;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "节点内搜索" });

    new Setting(contentEl)
      .setName("关键词")
      .addText((t) => {
        t.setPlaceholder("输入搜索内容...");
        t.onChange((v) => (this.keyword = v));
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.doSearch();
          }
        });
      });

    const btnRow = contentEl.createDiv({ cls: "cp-search-btns" });
    btnRow.style.cssText = "display:flex;gap:6px;margin-top:8px";

    btnRow.createEl("button", { text: "搜索" }).onclick = () => this.doSearch();
    const prevBtn = btnRow.createEl("button", { text: "◀ 上一个" });
    prevBtn.onclick = () => this.prev();
    const nextBtn = btnRow.createEl("button", { text: "下一个 ▶" });
    nextBtn.onclick = () => this.next();
    btnRow.createEl("button", { text: "清除" }).onclick = () => this.clear();

    this.titleEl?.setText("节点内搜索");
  }

  private getContentEl(): HTMLElement | null {
    const contentEl = (this.node as any).contentEl as HTMLElement | undefined;
    if (!contentEl) return null;
    // 阅读视图
    const preview = contentEl.querySelector(".markdown-preview-view") as HTMLElement;
    if (preview) return preview;
    return contentEl;
  }

  private doSearch() {
    this.clear();
    if (!this.keyword.trim()) return;
    const contentEl = this.getContentEl();
    if (!contentEl) {
      new Notice("节点内容未加载");
      return;
    }

    // 遍历所有文本节点，高亮匹配
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.textContent) return NodeFilter.FILTER_REJECT;
        // 排除 script/style
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return node.textContent.includes(this.keyword)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const kw = this.keyword;
    const kwLower = kw.toLowerCase();
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) textNodes.push(n as Text);

    for (const textNode of textNodes) {
      const text = textNode.textContent!;
      const frag = document.createDocumentFragment();
      let lastEnd = 0;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(kwLower);
      while (idx !== -1) {
        if (idx > lastEnd) frag.appendChild(document.createTextNode(text.slice(lastEnd, idx)));
        const mark = document.createElement("mark");
        mark.className = "cp-search-highlight";
        mark.textContent = text.slice(idx, idx + kw.length);
        mark.style.cssText = "background:#fff3a3;border-radius:2px;padding:0 1px";
        frag.appendChild(mark);
        activeHighlights.push(mark);
        lastEnd = idx + kw.length;
        idx = lower.indexOf(kwLower, lastEnd);
      }
      if (lastEnd < text.length) frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    if (activeHighlights.length === 0) {
      new Notice("未找到匹配内容");
      return;
    }
    currentIndex = 0;
    this.scrollToCurrent();
    new Notice(`找到 ${activeHighlights.length} 处匹配`);
  }

  private scrollToCurrent() {
    if (currentIndex < 0 || currentIndex >= activeHighlights.length) return;
    // 清除上一个的高亮样式
    activeHighlights.forEach((el, i) => {
      el.style.background = i === currentIndex ? "#ff9a3c" : "#fff3a3";
    });
    activeHighlights[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  private next() {
    if (activeHighlights.length === 0) return;
    currentIndex = (currentIndex + 1) % activeHighlights.length;
    this.scrollToCurrent();
  }

  private prev() {
    if (activeHighlights.length === 0) return;
    currentIndex = (currentIndex - 1 + activeHighlights.length) % activeHighlights.length;
    this.scrollToCurrent();
  }

  private clear() {
    // 恢复原始文本
    for (const mark of activeHighlights) {
      const text = mark.textContent || "";
      mark.replaceWith(document.createTextNode(text));
    }
    activeHighlights = [];
    currentIndex = -1;
  }

  onClose() {
    this.clear();
    this.contentEl.empty();
  }
}
