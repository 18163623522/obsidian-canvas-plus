/**
 * 每块字号调整
 *
 * 持久化方案：在目标块前一行插入 HTML 注释标记
 *   <!--cp:size:130-->
 *   被标记的"块"= 标记后到下一个同级标记或空行结束的所有行。
 *
 * Live Preview：CM6 ViewPlugin 扫描标记，对块内每一行套 Decoration.line({class})
 * Reading view：MarkdownPostProcessor 找到注释节点，给后续兄弟节点套 inline style
 *
 * 标记本身是 HTML 注释，在 Reading view 默认不渲染，无副作用。
 */
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { Editor } from "obsidian";

/** 字号档位 → CSS class 后缀 */
export const FONT_SIZES: Record<string, { label: string; pct: number }> = {
  "90": { label: "小 (90%)", pct: 90 },
  "100": { label: "标准 (100%)", pct: 100 },
  "110": { label: "大 (110%)", pct: 110 },
  "125": { label: "较大 (125%)", pct: 125 },
  "150": { label: "很大 (150%)", pct: 150 },
  "200": { label: "标题级 (200%)", pct: 200 },
};

/** 标记正则：匹配行首的 <!--cp:size:130--> */
const MARKER_RE = /^<!--cp:size:(\d+)-->\/?/;

/** 给定文档，返回每个行号应套的字号 pct（0 = 无） */
function scanDoc(view: EditorView): Map<number, number> {
  const result = new Map<number, number>();
  let currentSize = 0; // 当前生效的字号（来自最近的标记）
  const lineCount = view.state.doc.lines;
  for (let i = 1; i <= lineCount; i++) {
    const lineText = view.state.doc.line(i).text;
    const m = lineText.match(MARKER_RE);
    if (m) {
      currentSize = parseInt(m[1], 10);
      continue; // 标记行本身不套字号
    }
    // 空行或下一个标记会重置块；这里简化：遇到空行重置
    if (lineText.trim() === "") {
      currentSize = 0;
      continue;
    }
    if (currentSize > 0) result.set(i, currentSize);
  }
  return result;
}

const viewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const sizes = scanDoc(view);
      const decos: Array<{ from: number; deco: Decoration }> = [];
      for (const [lineNo, pct] of sizes) {
        const line = view.state.doc.line(lineNo);
        decos.push({
          from: line.from,
          deco: Decoration.line({ class: `cp-size cp-size-${pct}` }),
        });
      }
      return Decoration.set(
        decos.map((d) => d.deco.range(d.from)),
        true
      );
    }
  },
  { decorations: (v) => v.decorations }
);

export const blockFontsizeExtension: Extension = viewPlugin;

// ============================================================
//  命令：在光标所在块前插入/清除字号标记
// ============================================================

/** 把光标所在"块"（段落）的字号设为指定 pct；pct=0 表示清除 */
export function setBlockFontSize(editor: Editor, pct: number): void {
  const cursor = editor.getCursor("head");
  const lineCount = editor.lineCount();

  // 找到光标所在块的起始行（往上找，直到空行或文档顶）
  let blockStart = cursor.line;
  while (blockStart > 0) {
    const prev = editor.getLine(blockStart - 1);
    if (prev.trim() === "") break;
    blockStart--;
  }

  // 检查块起始行上方是否已有标记；若有则替换/删除
  let markerLine = blockStart - 1;
  const existing = markerLine >= 0 ? editor.getLine(markerLine) : "";
  const existingMatch = existing.match(MARKER_RE);

  if (pct === 0) {
    // 清除：删掉已有标记
    if (existingMatch) {
      editor.replaceRange("", { line: markerLine, ch: 0 }, { line: markerLine + 1, ch: 0 });
    }
    return;
  }

  const newMarker = `<!--cp:size:${pct}-->`;
  if (existingMatch) {
    // 替换已有标记
    editor.replaceRange(newMarker, { line: markerLine, ch: 0 }, { line: markerLine, ch: existing.length });
  } else {
    // 在块前插入标记 + 换行
    editor.replaceRange(newMarker + "\n", { line: blockStart, ch: 0 });
  }
}
