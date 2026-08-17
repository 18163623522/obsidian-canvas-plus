/**
 * 节点角标：代码语言切换 + 表格网格编辑入口
 *
 * 轮询文本节点：
 *  - 内容是单个代码围栏 → 右上角渲染语言下拉框，选中即改围栏语言标识
 *  - 内容是整张表格   → 右上角渲染「▦」按钮，点开网格编辑弹窗
 *
 * 只增不改存储：产物仍是原生 Markdown 文本节点，.canvas 格式零变化。
 * 注意（踩过的坑）：不改写 node className、不动 overflow，
 * 只向 nodeEl 追加一个绝对定位的小控件，避免弄坏连接把手。
 */
import { App, Modal, Notice, Plugin } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { CODE_LANGS } from "./slash-completions";
import { parseTableText, serializeTable } from "./table-text";

const FENCE_RE = /^```([A-Za-z0-9#+.-]*)\s*\n([\s\S]*?)```\s*$/;
const WIDGET_CLS = "cp-node-widget";

export function setupNodeWidgets(plugin: Plugin): () => void {
  const apply = () => scan(plugin.app);
  const timer = setInterval(apply, 500);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
  };
}

function scan(app: App) {
  const leaves = app.workspace.getLeavesOfType("canvas");
  for (const leaf of leaves) {
    const canvas = (leaf as any).view?.canvas as Canvas | undefined | null;
    if (!canvas?.nodes) continue;
    for (const node of canvas.nodes.values()) {
      try {
        updateNodeWidget(app, node);
      } catch (e) {
        console.warn("[canvas-plus] node widget failed", e);
      }
    }
  }
}

function updateNodeWidget(app: App, node: CanvasNode) {
  const data = node.getData() as any;
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (!nodeEl || !document.contains(nodeEl)) return;

  const existing = findWidget(nodeEl);
  if (!data || data.type !== "text") {
    existing?.remove();
    return;
  }
  const text: string = data.text ?? "";

  // 代码围栏节点
  const m = text.match(FENCE_RE);
  if (m) {
    const lang = (m[1] ?? "").toLowerCase();
    if (existing && existing.dataset.kind === "code" && existing.dataset.key === lang) return;
    existing?.remove();
    nodeEl.appendChild(buildCodeWidget(node, lang));
    return;
  }

  // 纯表格节点
  if (parseTableText(text)) {
    if (existing && existing.dataset.kind === "table") return;
    existing?.remove();
    nodeEl.appendChild(buildTableWidget(app, node));
    return;
  }

  existing?.remove();
}

function findWidget(nodeEl: HTMLElement): HTMLElement | null {
  for (const child of Array.from(nodeEl.children)) {
    if (child.classList.contains(WIDGET_CLS)) return child as HTMLElement;
  }
  return null;
}

/** 阻止画布对控件按下/双击的默认响应（拖节点、进编辑模式） */
function stopCanvasEvents(el: HTMLElement) {
  for (const type of ["pointerdown", "mousedown", "dblclick"]) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

// ============================================================
//  代码语言下拉
// ============================================================

function buildCodeWidget(node: CanvasNode, lang: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `${WIDGET_CLS} ${WIDGET_CLS}-code`;
  wrap.dataset.kind = "code";
  wrap.dataset.key = lang;

  const select = wrap.createEl("select", { cls: "cp-code-lang-select" });
  const known = CODE_LANGS.map((l) => l.lang);
  // 当前语言不在预置列表时也显示出来
  const options = ["", ...(known.includes(lang) ? known : [lang, ...known])];
  for (const l of options) {
    select.createEl("option", { value: l, text: l === "" ? "text" : l });
  }
  select.value = lang;
  select.title = "代码语言";

  stopCanvasEvents(wrap);
  select.onchange = () => {
    const d = node.getData() as any;
    if (!FENCE_RE.test(d?.text ?? "")) return;
    const newText = (d.text as string).replace(/^```[A-Za-z0-9#+.-]*/, "```" + select.value);
    (node as any).setData?.({ ...d, text: newText });
    (node as any).canvas?.requestSave?.();
    wrap.dataset.key = select.value;
    new Notice(`代码语言：${select.value || "纯文本"}`);
  };
  return wrap;
}

// ============================================================
//  表格编辑按钮 + 网格编辑弹窗
// ============================================================

function buildTableWidget(app: App, node: CanvasNode): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `${WIDGET_CLS} ${WIDGET_CLS}-table`;
  wrap.dataset.kind = "table";

  const btn = wrap.createEl("button", { cls: "cp-table-edit-btn", text: "▦ 表格" });
  btn.title = "网格编辑表格";
  stopCanvasEvents(wrap);
  btn.onclick = (e) => {
    e.stopPropagation();
    const d = node.getData() as any;
    const rows = parseTableText(d?.text ?? "");
    if (!rows) return;
    new TableGridModal(app, rows, (md) => {
      const cur = node.getData() as any;
      (node as any).setData?.({ ...cur, text: md });
      (node as any).canvas?.requestSave?.();
      new Notice("表格已更新");
    }).open();
  };
  return wrap;
}

class TableGridModal extends Modal {
  private rows: string[][];
  private onSubmit: (md: string) => void;
  private tableEl!: HTMLElement;

  constructor(app: App, rows: string[][], onSubmit: (md: string) => void) {
    super(app);
    // 深拷贝，编辑期间不碰原数据
    this.rows = rows.map((r) => [...r]);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cp-table-modal");
    contentEl.createEl("h3", { text: "编辑表格" });

    // 行列操作工具条
    const toolbar = contentEl.createDiv({ cls: "cp-table-grid-toolbar" });
    const ops: Array<{ label: string; fn: () => void }> = [
      { label: "+ 行", fn: () => this.addRow() },
      { label: "+ 列", fn: () => this.addCol() },
      { label: "− 行", fn: () => this.removeRow() },
      { label: "− 列", fn: () => this.removeCol() },
    ];
    for (const op of ops) {
      const b = toolbar.createEl("button", { text: op.label });
      b.onclick = () => {
        this.syncFromDom();
        op.fn();
        this.renderTable();
      };
    }

    const wrapEl = contentEl.createDiv({ cls: "cp-table-grid-wrap" });
    this.tableEl = wrapEl.createEl("table", { cls: "cp-table-grid" });
    this.renderTable();

    const footer = contentEl.createDiv({ cls: "cp-table-grid-footer" });
    const ok = footer.createEl("button", { text: "确定", cls: "mod-cta" });
    ok.onclick = () => {
      this.syncFromDom();
      this.close();
      this.onSubmit(serializeTable(this.rows));
    };
    const cancel = footer.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();
  }

  private renderTable() {
    this.tableEl.empty();
    this.rows.forEach((row, r) => {
      const tr = this.tableEl.createEl("tr");
      row.forEach((cell, c) => {
        const td = tr.createEl(r === 0 ? "th" : "td");
        td.contentEditable = "true";
        td.textContent = cell;
        td.dataset.r = String(r);
        td.dataset.c = String(c);
        td.addEventListener("keydown", (e) => this.onCellKeydown(e, td));
        // 粘贴只取纯文本，避免带入 HTML 撑坏单元格
        td.addEventListener("paste", (e) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, text.replace(/\n/g, " "));
        });
      });
    });
  }

  private onCellKeydown(e: KeyboardEvent, td: HTMLElement) {
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    if (e.key === "Tab") {
      e.preventDefault();
      const cols = this.rows[0]?.length ?? 1;
      let nr = r;
      let nc = c + (e.shiftKey ? -1 : 1);
      if (nc >= cols) { nc = 0; nr = r + 1; }
      if (nc < 0) { nc = cols - 1; nr = r - 1; }
      this.focusCell(nr, nc);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (r === this.rows.length - 1) {
        this.syncFromDom();
        this.addRow();
        this.renderTable();
      }
      this.focusCell(r + 1, c);
    } else if (e.key === "Escape") {
      // 让 Modal 处理关闭
      (td as HTMLTableCellElement).blur?.();
    }
  }

  private focusCell(r: number, c: number) {
    const td = this.tableEl.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (!td) return;
    td.focus();
    // 光标移到末尾
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /** 把 DOM 里的单元格内容读回 this.rows */
  private syncFromDom() {
    this.tableEl.querySelectorAll<HTMLElement>("tr").forEach((tr, r) => {
      tr.querySelectorAll<HTMLElement>("th, td").forEach((td, c) => {
        if (this.rows[r]) this.rows[r][c] = td.textContent ?? "";
      });
    });
  }

  private colCount(): number {
    return this.rows[0]?.length ?? 1;
  }
  private addRow() {
    this.rows.push(Array(this.colCount()).fill(""));
  }
  private addCol() {
    for (const row of this.rows) row.push("");
  }
  private removeRow() {
    if (this.rows.length > 2) this.rows.pop(); // 至少留表头 + 一行
  }
  private removeCol() {
    if (this.colCount() > 1) for (const row of this.rows) row.pop();
  }

  onClose() {
    this.contentEl.empty();
  }
}
