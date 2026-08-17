/**
 * 表格/代码块文本工具（纯函数，不依赖编辑器）
 *
 * 供 slash 菜单、选中文本转换、表格网格编辑器共用。
 * 所有产物都是原生 Markdown 文本，不改变存储格式。
 */

/** 生成 cols×rows 的 Markdown 表格（表头 列1..列N，正文留空） */
export function tableMarkdown(cols: number, rows: number): string {
  const header = `| ${Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(" | ")} |`;
  const sep = `| ${Array(cols).fill("---").join(" | ")} |`;
  const bodyRows = Math.max(1, rows - 1);
  const empty = `| ${Array(cols).fill(" ").join(" | ")} |`;
  const body = Array.from({ length: bodyRows }, () => empty);
  return [header, sep, ...body].join("\n") + "\n";
}

/** 表格文本 → 矩阵（不含分隔行）；不是合法表格返回 null */
export function parseTableText(text: string): string[][] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  if (!lines.every((l) => /^\s*\|/.test(l))) return null;

  const rows: string[][] = [];
  let sepCount = 0;
  for (const line of lines) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
      sepCount++;
      continue;
    }
    rows.push(parseRow(line));
  }
  if (sepCount !== 1 || rows.length === 0) return null;

  const colCount = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < colCount) r.push("");
  return rows;
}

/** 矩阵 → Markdown 表格文本（第一行作表头） */
export function serializeTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const norm = rows.map((r) => {
    const c = [...r];
    while (c.length < colCount) c.push("");
    return c;
  });
  const esc = (c: string) => c.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  const line = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  return [line(norm[0]), line(Array(colCount).fill("---")), ...norm.slice(1).map(line)].join("\n");
}

function parseRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  // 转义的 \| 不参与分列
  return trimmed
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

/**
 * 任意分隔文本 → Markdown 表格
 * 识别规则：全部行含 Tab → TSV；全部行含英文逗号 → CSV；否则每行一格（单列）。
 * 至少 2 行才转换，避免误伤普通一句话。
 */
export function textToTableMarkdown(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;

  let rows: string[][];
  if (lines.every((l) => l.includes("\t"))) {
    rows = lines.map((l) => l.split("\t"));
  } else if (lines.every((l) => l.includes(","))) {
    rows = lines.map((l) => l.split(","));
  } else {
    rows = lines.map((l) => [l.trim()]);
  }
  return serializeTable(rows);
}

/** 把选中文本包进代码围栏（不带语言，之后可用节点角标选语言） */
export function wrapCodeFence(text: string): string {
  const body = text.replace(/\n+$/, "");
  // 内容里已有 ``` 时用四个反引号围栏，避免嵌套破裂
  const fence = body.includes("```") ? "````" : "```";
  return `${fence}\n${body}\n${fence}`;
}
