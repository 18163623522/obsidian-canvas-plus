/**
 * 表格粘贴识别（白板 + 笔记通用）
 *
 * 拦截粘贴事件，识别外部表格并转成 Markdown 表格：
 *  - Excel / Google Sheets / WPS：剪贴板是 Tab 分隔的纯文本（text/plain）
 *    + HTML（text/html 含 <table>）。优先用 HTML（能识别合并信息）。
 *  - 网页选中表格：text/html 含 <table>。
 *  - Notion 复制表格：text/html 含 <table>。
 *
 * 注入点：
 *  - 笔记（MarkdownView）：在 document 级 paste 事件里，判断目标在编辑器内
 *  - 白板（Canvas 文本节点）：轮询 node.child.editMode.cm，给其 dom 挂 paste 监听
 */
import type { Plugin } from "obsidian";

const injected = new WeakSet<HTMLElement>();

/** 把 HTML <table> 转成 Markdown 表格字符串 */
export function htmlTableToMarkdown(html: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return null;

    const matrix: string[][] = [];
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll("td, th"));
      if (cells.length === 0) continue;
      matrix.push(
        cells.map((c) =>
          (c.textContent || "")
            .replace(/\|/g, "\\|")
            .replace(/\n/g, " ")
            .trim()
        )
      );
    }
    if (matrix.length === 0) return null;

    const colCount = Math.max(...matrix.map((r) => r.length));
    // 补齐每行列数
    const normalized = matrix.map((r) => {
      while (r.length < colCount) r.push("");
      return r;
    });

    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const header = line(normalized[0]);
    const separator = line(normalized[0].map(() => "---"));
    const body = normalized.slice(1).map(line);
    return `\n${[header, separator, ...body].join("\n")}\n`;
  } catch (e) {
    console.warn("[canvas-plus] htmlTableToMarkdown failed", e);
    return null;
  }
}

/** 把 Tab 分隔的纯文本转成 Markdown 表格 */
export function tsvToMarkdown(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return null; // 至少 2 行才像表格
  // 必须含 Tab，且大部分行有 Tab
  const tabLines = lines.filter((l) => l.includes("\t"));
  if (tabLines.length < lines.length * 0.5) return null;

  const matrix = lines.map((l) => l.split("\t"));
  const colCount = Math.max(...matrix.map((r) => r.length));
  const normalized = matrix.map((r) => {
    while (r.length < colCount) r.push("");
    return r.map((c) => c.replace(/\|/g, "\\|").trim());
  });

  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const header = line(normalized[0]);
  const separator = line(normalized[0].map(() => "---"));
  const body = normalized.slice(1).map(line);
  return `\n${[header, separator, ...body].join("\n")}\n`;
}

/**
 * 处理一个 paste 事件：若剪贴板含表格，返回应插入的 Markdown，否则返回 null。
 * 调用方根据返回值决定是否 preventDefault。
 */
export function convertPasteEvent(e: ClipboardEvent): string | null {
  const dt = e.clipboardData;
  if (!dt) return null;

  // 优先 HTML 表格
  const html = dt.getData("text/html");
  if (html && /<table[\s>]/i.test(html)) {
    const md = htmlTableToMarkdown(html);
    if (md) return md;
  }
  // 退而求其次：Tab 分隔纯文本
  const plain = dt.getData("text/plain");
  if (plain && plain.includes("\t")) {
    const md = tsvToMarkdown(plain);
    if (md) return md;
  }
  return null;
}

/** 给一个 CM6 编辑器 DOM 注入 paste 拦截 */
function attachPasteHandler(dom: HTMLElement) {
  if (injected.has(dom)) return;
  injected.add(dom);

  const handler = (e: ClipboardEvent) => {
    const md = convertPasteEvent(e);
    if (!md) return; // 不是表格，放行默认行为
    e.preventDefault();
    e.stopPropagation();
    // 插入到 CM6 视图（dom.cmView.view 或通过 dispatch）
    const cm = (dom as any).cmView?.view ?? (dom as any).view;
    if (cm && cm.state && cm.dispatch) {
      const sel = cm.state.selection.main;
      cm.dispatch({
        changes: { from: sel.from, to: sel.to, insert: md },
        selection: { anchor: sel.from + md.length },
      });
    } else {
      // 兜底：用 execCommand 插入（兼容性）
      document.execCommand("insertText", false, md);
    }
  };
  dom.addEventListener("paste", handler, true);
}

/** 主入口：统一在 document 级 capture 监听 paste，判断目标在编辑器内则转换表格 */
export function setupTablePaste(plugin: Plugin): () => void {
  // 统一 paste 处理：白板文本节点 + 笔记 MarkdownView
  const onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // 必须在 CM6 编辑器内
    const cmEditor = target.closest(".cm-editor, .cm-content");
    if (!cmEditor) return;

    const md = convertPasteEvent(e);
    if (!md) return; // 不是表格，放行

    e.preventDefault();
    e.stopPropagation();

    // 找到 CM6 EditorView 实例
    const cmDom = cmEditor as HTMLElement;
    const cm = (cmDom as any).cmView?.view ?? (cmDom as any).view;
    if (cm && cm.state && cm.dispatch) {
      const sel = cm.state.selection.main;
      cm.dispatch({
        changes: { from: sel.from, to: sel.to, insert: md },
        selection: { anchor: sel.from + md.length },
      });
      cm.focus();
    } else {
      // 兜底：execCommand
      document.execCommand("insertText", false, md);
    }
  };
  // capture 阶段拦截，确保在 Obsidian 内部处理之前
  document.addEventListener("paste", onPaste, true);

  return () => {
    document.removeEventListener("paste", onPaste, true);
  };
}
