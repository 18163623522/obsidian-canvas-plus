/**
 * 节点富文本工具条（选中文本片段时弹出）
 *
 * 在编辑器（笔记 MarkdownView 或 Canvas 文本节点 CM6）内选中文字时弹出：
 *  - 基础格式：加粗 / 斜体 / 高亮 / 行内代码 / 下划线
 *  - 文字颜色：色轮（系统取色器）+ 色条（色相条拖动）
 *  - 文字字号：0.6×–2.4× 无级滑杆
 *  - 清除选中文字上的行内样式
 *
 * 出现形式：选区【下方】。Obsidian 原生格式工具条出现在选区上方，
 * 本工具条放下方，避免遮挡原生工具条；屏幕放不下时收缩进视口。
 */
import type { Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { setBlockFontSize } from "../editor/block-fontsize";
import { findEditorViewFromSelection } from "../editor/cm-access";
import { wrapCodeFence, textToTableMarkdown } from "./table-text";

export class TextFormatToolbar {
  private el: HTMLElement | null = null;
  private fontPanel: HTMLElement | null = null;
  private app: any = null;
  /**
   * 工具条弹出时缓存的 CM6 EditorView。
   * 滑杆/取色器需要默认 mousedown 行为（会把 DOM 选区折叠到工具条内），
   * 之后无法再从 window.getSelection() 反查编辑器——一律用此缓存。
   * CM 的 state.selection 不受 DOM 选区折叠影响。
   */
  private currentCm: any = null;

  setup(plugin: Plugin): () => void {
    this.app = plugin.app;
    const onSelChange = () => this.onSelectionChange(plugin);
    document.addEventListener("selectionchange", onSelChange);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      this.destroy();
    };
  }

  private onSelectionChange(plugin: Plugin) {
    // 焦点在工具条自身控件上（拖色条/字号滑杆、系统取色器）时不响应——
    // 否则重建 DOM 会打断正在进行的拖动
    if (this.el && document.activeElement && this.el.contains(document.activeElement)) return;
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
    // 缓存当前选区所在的编辑器：input 类控件交互过程中 DOM 选区会丢
    this.currentCm = this.getEditorView();

    // —— 基础格式按钮 ——
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

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 色轮（系统取色器）——
    const colorInput = el.createEl("input", {
      cls: "cp-tf-color",
      attr: { type: "color", title: "色轮：任意颜色", "aria-label": "色轮：任意颜色" },
    });
    colorInput.addEventListener("input", () => {
      if (colorInput.value) this.applySpanStyle(`color:${colorInput.value}`);
    });

    // —— 色条（色相条，拖动连续取色）——
    const hue = el.createEl("input", {
      cls: "cp-tf-hue",
      attr: { type: "range", min: "0", max: "359", step: "1", value: "210", title: "色条：拖动调色相", "aria-label": "色条：拖动调色相" },
    });
    hue.addEventListener("input", () => {
      this.applySpanStyle(`color:hsl(${hue.value}, 85%, 55%)`);
    });

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 字号无级调节 ——
    const sizeLabel = el.createSpan({ cls: "cp-tf-size-label", text: "1.00×" });
    const size = el.createEl("input", {
      cls: "cp-tf-size",
      attr: { type: "range", min: "0.6", max: "2.4", step: "0.05", value: "1", title: "字号：无级调节", "aria-label": "字号：无级调节" },
    });
    size.addEventListener("input", () => {
      const v = parseFloat(size.value);
      sizeLabel.setText(`${v.toFixed(2)}×`);
      this.applySpanStyle(v === 1 ? "font-size:" : `font-size:${v}em`);
    });

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 清除行内样式 ——
    const clearBtn = el.createEl("button", {
      cls: "cp-tf-btn",
      attr: { title: "清除选中文字的颜色/字号样式", "aria-label": "清除行内样式" },
    });
    clearBtn.textContent = "⌫";
    clearBtn.onclick = () => {
      const cm = this.currentCm ?? this.getEditorView();
      if (cm) this.applyInline(cm, stripInlineSpans);
    };

    // —— 定位 ——
    el.style.display = "flex"; // 先显示才能量尺寸
    const tbRect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const left = Math.max(8, Math.min(centerX - tbRect.width / 2, window.innerWidth - tbRect.width - 8));

    // 选区在画布文本节点内时：工具条钳制在节点矩形内部——
    // 节点边缘一圈是原生连接点（拉出箭头的小圆点）的交互区，
    // 工具条绝不能越过去挡住它们
    const nodeEl = (sel.anchorNode?.nodeType === 3 ? (sel.anchorNode as any).parentElement : sel.anchorNode) as HTMLElement | null;
    const canvasNode = nodeEl?.closest(".canvas-node") as HTMLElement | null;
    let top: number;
    if (canvasNode) {
      const nr = canvasNode.getBoundingClientRect();
      // 连接点（拉箭头的小圆点）贴着节点边缘【内侧】放置，约占 16px——
      // 工具条钳制在节点内部时四边都要让出这一圈
      const inset = 16;
      const above = rect.top - tbRect.height - 8; // 优先选区上方（节点内）
      const below = rect.bottom + 8;
      top = above >= nr.top + inset ? above : below;
      // 钳制到节点内部且避开连接点圈（节点太矮放不下时贴着安全区顶部）
      const maxTop = Math.max(nr.top + inset, nr.bottom - tbRect.height - inset);
      top = Math.min(Math.max(top, nr.top + inset), maxTop);
      // 水平也钳制在节点内（同样避开连接点圈）
      const clampedLeft = Math.min(
        Math.max(left, nr.left + inset),
        Math.max(nr.left + inset, nr.right - tbRect.width - inset)
      );
      el.style.left = `${clampedLeft}px`;
      el.style.top = `${top}px`;
      return;
    }

    // 笔记内：选区下方并让出一条"原生车道"（约一个工具条高度）。
    // Obsidian 原生/编辑工具条类插件贴着选区出现（在上/下方），
    // 我们下移 40px 保证互不遮挡；贴到视口底也不回到紧贴选区的位置。
    top = Math.min(rect.bottom + 40, window.innerHeight - tbRect.height - 8);
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
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
    // 按钮类控件阻止焦点转移（保住编辑器选区）；滑杆/取色器需要默认行为
    el.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("button")) e.preventDefault();
      e.stopPropagation();
    });
    return el;
  }

  /**
   * 定位选区所在的 CM6 EditorView。
   * 经运行时验证：.cm-editor/.cm-content 上没有 cmView 属性（社区反查法
   * 无效），必须走 Obsidian 官方对象（markdown leaf 的 editor.cm /
   * 画布节点的 child.editMode.cm / activeEditor 兜底）。
   */
  private getEditorView(): any | null {
    if (!this.app) return null;
    return findEditorViewFromSelection(this.app);
  }

  /**
   * 对选中文字应用一个文本变换（build 返回新文本），变换后保持文字处于选中状态，
   * 便于连续调整（如拖动色条/字号滑杆）反复作用在同一段文字上。
   */
  private applyInline(cm: any, build: (text: string) => string): void {
    const sel = cm.state.selection.main;
    const text = cm.state.sliceDoc(sel.from, sel.to);
    const insert = build(text);
    if (insert === text) return;
    cm.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from, head: sel.from + insert.length },
    });
  }

  /** 用 <span style="..."> 包裹选中文字（同类型包裹会被替换而非嵌套）；传空 value 表示剥除该样式 */
  private applySpanStyle(styleDecl: string): void {
    const cm = this.currentCm ?? this.getEditorView();
    if (!cm) return;
    const m = styleDecl.match(/^([a-z-]+):(.*)$/);
    if (!m) return;
    const prop = m[1];
    const value = m[2];
    const re = new RegExp(`^<span style="${prop}:[^"]*">([\\s\\S]*)</span>$`);
    this.applyInline(cm, (text) => {
      const inner = text.replace(re, "$1"); // 剥掉旧的同类包裹
      if (!value) return inner; // 空 value = 清除该样式
      return `<span style="${prop}:${value}">${inner}</span>`;
    });
  }

  private applyFormat(plugin: Plugin, action: string) {
    // 自定义转换动作（无内置命令，直接操作编辑器）
    if (action === "codeblock" || action === "table") {
      this.applyConversion(plugin, action);
      return;
    }
    // 标记对（行内代码用反引号，下划线用 HTML 标签）
    const markers: Record<string, [string, string]> = {
      bold: ["**", "**"],
      italic: ["*", "*"],
      highlight: ["==", "=="],
      code: ["`", "`"],
      underline: ["<u>", "</u>"],
    };

    // 优先直接对 CM6 派发：笔记编辑器和 Canvas 文本节点都走这里，
    // 精确作用于选区所在的编辑器（executeCommandById 只作用于激活的
    // MarkdownView，在 Canvas 节点内会失效或打到别的编辑器）
    const cm = this.currentCm ?? this.getEditorView();
    const m = markers[action];
    if (cm && m) {
      this.applyInline(cm, (text) => {
        const wrapped =
          text.startsWith(m[0]) && text.endsWith(m[1]) && text.length >= m[0].length + m[1].length;
        return wrapped ? text.slice(m[0].length, text.length - m[1].length) : m[0] + text + m[1];
      });
      return;
    }

    // 兜底：非 CM 上下文（如阅读视图）走 Obsidian 内置命令
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
  }

  /** 把选中文本转为代码块 / 表格（底层仍是原生 Markdown） */
  private applyConversion(plugin: Plugin, action: "codeblock" | "table") {
    const build = (text: string): string | null =>
      action === "codeblock" ? wrapCodeFence(text) : textToTableMarkdown(text);

    // 1. 优先走 CM6（缓存的实例，或从当前选区找）
    const cm = this.currentCm ?? this.getEditorView();
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
    this.currentCm = null;
  }

  destroy() {
    this.el?.remove();
    this.el = null;
  }
}

/** 剥除选中文字里所有行内 span 样式包裹（颜色/字号等，支持嵌套） */
function stripInlineSpans(text: string): string {
  let out = text;
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/<span style="[^"]*">([\s\S]*?)<\/span>/g, "$1");
  }
  return out;
}
