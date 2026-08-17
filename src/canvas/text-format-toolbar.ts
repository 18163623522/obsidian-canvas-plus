/**
 * 节点富文本工具条（选中文本片段时弹出）
 *
 * 在编辑器（笔记 MarkdownView 或 Canvas 文本节点 CM6）内选中文字时，
 * 在选区上方弹出浮动工具条：加粗 / 斜体 / 高亮 / 行内代码 / 字号。
 *
 * 实现：document 级 selectionchange 监听，判断有非空选区且在编辑器内时显示。
 */
import type { Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { setBlockFontSize } from "../editor/block-fontsize";
import { wrapCodeFence, textToTableMarkdown } from "./table-text";

export class TextFormatToolbar {
  private el: HTMLElement | null = null;
  private fontPanel: HTMLElement | null = null;
  /** 工具条显示时缓存的 CM6 实例（点击按钮后选区可能丢失，提前存好） */
  private cachedCm: any = null;

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
    // 提前缓存 CM6 实例，点击按钮导致选区丢失后仍能操作
    this.cachedCm = this.findCm();

    const buttons: Array<{ label: string; title: string; action: string }> = [
      { label: "B", title: "加粗", action: "bold" },
      { label: "I", title: "斜体", action: "italic" },
      { label: "H", title: "高亮", action: "highlight" },
      { label: "</>", title: "行内代码", action: "code" },
      { label: "U", title: "下划线", action: "underline" },
      { label: "{ }", title: "转为代码块", action: "codeblock" },
      { label: "▦", title: "转为表格（支持 Tab/逗号/每行一格）", action: "table" },
    ];
    for (const b of buttons) {
      const btn = el.createEl("button", {
        cls: "cp-tf-btn",
        attr: { title: b.title, "aria-label": b.title },
      });
      btn.textContent = b.label;
      if (b.action === "bold") btn.style.fontWeight = "700";
      if (b.action === "italic") btn.style.fontStyle = "italic";
      // 转换类按钮：按住时不抢焦点，保住编辑器选区
      if (b.action === "codeblock" || b.action === "table") {
        btn.onmousedown = (e) => e.preventDefault();
      }
      btn.onclick = () => this.applyFormat(plugin, b.action);
    }

    // 分隔符
    el.createEl("span", { cls: "cp-tf-sep" });

    // 字号按钮：点击展开滑块面板
    const fontBtn = el.createEl("button", {
      cls: "cp-tf-btn cp-tf-font-btn",
      attr: { title: "字号（无极调节）", "aria-label": "字号" },
    });
    fontBtn.innerHTML = "A<sub>↕</sub>";
    fontBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleFontPanel(plugin, fontBtn);
    };

    // 定位
    const tbRect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, rect.left + rect.width / 2 - tbRect.width / 2)}px`;
    el.style.top = `${Math.max(8, rect.top - tbRect.height - 8)}px`;
  }

  /** 切换字号滑块面板的显示 */
  private toggleFontPanel(plugin: Plugin, anchor: HTMLElement) {
    // 已开则关
    if (this.fontPanel && document.body.contains(this.fontPanel)) {
      this.fontPanel.remove();
      this.fontPanel = null;
      return;
    }

    const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) return;

    // 读取当前块字号预填
    let curPct = 100;
    try {
      const cursor = editor.getCursor("head");
      let blockStart = cursor.line;
      while (blockStart > 0) {
        if (editor.getLine(blockStart - 1).trim() === "") break;
        blockStart--;
      }
      const markerLine = blockStart - 1;
      if (markerLine >= 0) {
        const m = editor.getLine(markerLine).match(/^<!--cp:size:(\d+)-->/);
        if (m) curPct = parseInt(m[1], 10);
      }
    } catch {}

    const panel = document.body.createDiv({ cls: "cp-tf-font-panel" });
    this.fontPanel = panel;

    // 头部：数字输入 + 滑块
    const row = panel.createDiv({ cls: "cp-tf-font-row" });
    const numInput = row.createEl("input", { type: "number" });
    numInput.min = "50";
    numInput.max = "400";
    numInput.value = String(curPct);
    numInput.style.width = "64px";

    const slider = row.createEl("input", { type: "range" });
    slider.min = "50";
    slider.max = "400";
    slider.step = "1";
    slider.value = String(curPct);
    slider.style.flex = "1";

    // 同步两个控件
    const apply = (pct: number) => {
      if (isNaN(pct) || pct < 50 || pct > 400) return;
      numInput.value = String(pct);
      slider.value = String(pct);
      setBlockFontSize(editor, pct);
    };
    slider.oninput = () => apply(parseInt(slider.value, 10));
    numInput.onchange = () => apply(parseInt(numInput.value, 10));

    // 快捷档位
    const presets = panel.createDiv({ cls: "cp-tf-font-presets" });
    for (const p of [75, 90, 100, 110, 125, 150, 200, 300]) {
      const b = presets.createEl("button", { text: `${p}%` });
      b.onclick = () => apply(p);
    }

    // 定位到按钮下方
    const r = anchor.getBoundingClientRect();
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.bottom + 4}px`;

    // 点外面关闭
    setTimeout(() => {
      const close = (e: MouseEvent) => {
        if (!panel.contains(e.target as Node) && e.target !== anchor) {
          panel.remove();
          this.fontPanel = null;
          document.removeEventListener("mousedown", close);
        }
      };
      document.addEventListener("mousedown", close);
    }, 0);
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
    // 自定义转换动作（无内置命令，直接操作编辑器）
    if (action === "codeblock" || action === "table") {
      this.applyConversion(plugin, action);
      return;
    }
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

  /** 从当前选区定位 CM6 EditorView（白板节点 / 笔记源模式通用） */
  private findCm(): any {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const anchor = sel.anchorNode;
    if (!anchor) return null;
    const el = (anchor.nodeType === 3 ? anchor.parentElement : anchor) as HTMLElement | null;
    const cmDom = el?.closest(".cm-editor") as HTMLElement | null;
    if (!cmDom) return null;
    const cm = (cmDom as any).cmView?.view ?? (cmDom as any).view;
    return cm && cm.state && typeof cm.dispatch === "function" ? cm : null;
  }

  /** 把选中文本转为代码块 / 表格（底层仍是原生 Markdown） */
  private applyConversion(plugin: Plugin, action: "codeblock" | "table") {
    const build = (text: string): string | null =>
      action === "codeblock" ? wrapCodeFence(text) : textToTableMarkdown(text);

    // 1. 优先走 CM6（缓存的实例，或从当前选区找）
    const cm = this.cachedCm ?? this.findCm();
    if (cm) {
      const sel = cm.state.selection.main;
      const text = cm.state.sliceDoc(sel.from, sel.to);
      if (!text.trim()) return;
      const insert = build(text);
      if (!insert) {
        new Notice("无法转为表格：至少需要 2 行文本");
        return;
      }
      cm.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
      });
      cm.focus?.();
      this.hide();
      return;
    }

    // 2. 兜底：笔记阅读/源码模式的 Obsidian Editor
    const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) return;
    const text = editor.getSelection();
    if (!text.trim()) return;
    const insert = build(text);
    if (!insert) {
      new Notice("无法转为表格：至少需要 2 行文本");
      return;
    }
    editor.replaceSelection(insert);
    this.hide();
  }

  hide() {
    if (this.el) this.el.style.display = "none";
    this.cachedCm = null;
  }

  destroy() {
    this.el?.remove();
    this.el = null;
  }
}
