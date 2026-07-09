/**
 * 表格编辑操作（加行/加列/删行/删列/对齐）
 *
 * 作用对象：当前编辑器（笔记 MarkdownView 或 Canvas 文本节点的 CM6）。
 * 通过 Obsidian Editor 抽象操作，笔记和白板通用。
 *
 * 算法：定位光标所在的表格块（连续的 | 开头行），解析成矩阵，
 * 修改矩阵，再写回。
 */
import { Editor } from "obsidian";

interface TableRange {
  startLine: number; // 表格起始行号
  endLine: number; // 表格结束行号（含分隔行）
  rows: string[][]; // 不含分隔行
}

/** 定位光标所在表格，返回 null 表示不在表格里 */
function findTable(editor: Editor, cursorLine: number): TableRange | null {
  const lineCount = editor.lineCount();

  const isTableRow = (n: number) => /^\s*\|/.test(editor.getLine(n));
  // 往上找起点
  let start = cursorLine;
  while (start > 0 && isTableRow(start - 1)) start--;
  // 往下找终点
  let end = cursorLine;
  while (end < lineCount - 1 && isTableRow(end + 1)) end++;

  if (!isTableRow(start) || !isTableRow(end)) return null;
  if (end - start < 1) return null; // 至少要有表头+分隔

  // 解析所有行，跳过分隔行（---）
  const rows: string[][] = [];
  for (let i = start; i <= end; i++) {
    const text = editor.getLine(i);
    if (/^\s*\|[\s:|-]+\|\s*$/.test(text)) continue; // 分隔行
    rows.push(parseRow(text));
  }
  if (rows.length === 0) return null;
  return { startLine: start, endLine: end, rows };
}

function parseRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function formatRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function formatSeparator(colCount: number, align?: "left" | "center" | "right"): string {
  const cell = (n: number) => {
    if (!align || n !== 0) return "---";
    if (align === "left") return ":---";
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  };
  return `| ${Array.from({ length: colCount }, (_, i) => cell(i)).join(" | ")} |`;
}

/** 找光标在第几列 */
function cursorCol(editor: Editor, cursorLine: number): number {
  const line = editor.getLine(cursorLine);
  const cursorCh = editor.getCursor().ch;
  let col = 0;
  for (let i = 0; i < line.length && i < cursorCh; i++) {
    if (line[i] === "|") col++;
  }
  return Math.max(0, col - 1); // 第一个 | 后是第 0 列
}

/** 把表格块写回编辑器 */
function rewriteTable(editor: Editor, t: TableRange, newRows: string[][], newAlign?: "left" | "center" | "right") {
  const colCount = Math.max(...newRows.map((r) => r.length));
  const normRows = newRows.map((r) => {
    const c = [...r];
    while (c.length < colCount) c.push("");
    return c;
  });
  const header = formatRow(normRows[0]);
  const sep = formatSeparator(colCount, newAlign);
  const body = normRows.slice(1).map(formatRow);
  const newText = [header, sep, ...body].join("\n");

  const from = { line: t.startLine, ch: 0 };
  const to = { line: t.endLine, ch: editor.getLine(t.endLine).length };
  editor.replaceRange(newText + "\n", from, to);
}

// ============== 公开操作 ==============

export function tableAddRow(editor: Editor) {
  const cur = editor.getCursor();
  const t = findTable(editor, cur.line);
  if (!t) return false;
  const colCount = t.rows[0]?.length ?? 1;
  const newRow = Array(colCount).fill("");
  const newRows = [...t.rows, newRow];
  rewriteTable(editor, t, newRows);
  return true;
}

export function tableAddColumn(editor: Editor) {
  const cur = editor.getCursor();
  const t = findTable(editor, cur.line);
  if (!t) return false;
  const newRows = t.rows.map((r) => [...r, ""]);
  rewriteTable(editor, t, newRows);
  return true;
}

export function tableDeleteRow(editor: Editor) {
  const cur = editor.getCursor();
  const t = findTable(editor, cur.line);
  if (!t) return false;
  // 计算光标是第几个数据行（跳过表头）
  const dataLine = cur.line;
  // 找出光标在 rows 里的索引
  let rowIdx = 0;
  let lineIdx = t.startLine;
  // 跳过表头
  if (isSeparator(editor, t.startLine + 1)) lineIdx = t.startLine + 2;
  else lineIdx = t.startLine + 1;
  while (lineIdx <= dataLine && rowIdx < t.rows.length) {
    if (lineIdx === dataLine) break;
    rowIdx++;
    lineIdx++;
    if (isSeparator(editor, lineIdx)) lineIdx++;
  }
  if (t.rows.length <= 1) return false; // 至少留表头
  const targetIdx = Math.max(1, rowIdx); // 不删表头
  const newRows = t.rows.filter((_, i) => i !== targetIdx);
  rewriteTable(editor, t, newRows);
  return true;
}

export function tableDeleteColumn(editor: Editor) {
  const cur = editor.getCursor();
  const t = findTable(editor, cur.line);
  if (!t) return false;
  const col = cursorCol(editor, cur.line);
  if (t.rows[0]?.length <= 1) return false;
  const newRows = t.rows.map((r) => r.filter((_, i) => i !== col));
  rewriteTable(editor, t, newRows);
  return true;
}

export function tableAlign(editor: Editor, align: "left" | "center" | "right") {
  const cur = editor.getCursor();
  const t = findTable(editor, cur.line);
  if (!t) return false;
  rewriteTable(editor, t, t.rows, align);
  return true;
}

function isSeparator(editor: Editor, line: number): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(editor.getLine(line));
}

/** 插入一个 3x3 模板表格 */
export function insertTable(editor: Editor) {
  const template =
    "\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n";
  editor.replaceSelection(template);
}
