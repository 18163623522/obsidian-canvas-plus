/**
 * Slash 补全项数据源（白板内 & MarkdownView 共用）
 *
 * 菜单项定义在这里，canvas-slash.ts（白板）和 editor/slash-menu.ts（笔记）都引用。
 */
import type { App } from "obsidian";

export interface SlashCompletion {
  id: string;
  label: string;
  group: string;
  icon: string;
  keywords: string[];
  /** 插入文本（apply 优先） */
  text?: string;
  /** 插入后光标相对末尾偏移 */
  cursorOffset?: number;
  /** 特殊动作（不直接插文本）：table-grid = 弹表格格子选择器 */
  action?: "table-grid";
}

/** 常用代码语言：[fence 标识, 显示名, 额外关键字] */
export const CODE_LANGS: Array<{ lang: string; name: string; extra?: string[] }> = [
  { lang: "js", name: "JavaScript" },
  { lang: "ts", name: "TypeScript" },
  { lang: "python", name: "Python", extra: ["py"] },
  { lang: "c", name: "C" },
  { lang: "cpp", name: "C++", extra: ["c++", "cc"] },
  { lang: "csharp", name: "C#", extra: ["c#", "cs"] },
  { lang: "java", name: "Java" },
  { lang: "rust", name: "Rust", extra: ["rs"] },
  { lang: "go", name: "Go", extra: ["golang"] },
  { lang: "html", name: "HTML" },
  { lang: "css", name: "CSS" },
  { lang: "json", name: "JSON" },
  { lang: "yaml", name: "YAML", extra: ["yml"] },
  { lang: "bash", name: "Bash", extra: ["sh", "shell"] },
  { lang: "sql", name: "SQL" },
  { lang: "glsl", name: "GLSL" },
  { lang: "hlsl", name: "HLSL" },
  { lang: "lua", name: "Lua" },
];

/** 生成某语言的代码围栏补全项 */
function codeLangItem(lang: string, name: string, extra: string[] = []): SlashCompletion {
  return {
    id: `code-${lang}`,
    label: `代码块 ${name}`,
    group: "代码块",
    icon: "</>",
    keywords: ["code", "代码", "代码块", lang, name.toLowerCase(), ...extra],
    text: "```" + lang + "\n\n```\n",
    cursorOffset: -5, // 光标落在围栏中间的空行
  };
}

export function getSlashCompletions(query: string): SlashCompletion[] {
  const q = query.toLowerCase().trim();
  const all = ALL_COMPLETIONS;
  if (!q) return all;
  // 打分过滤：精确命中关键字 > 关键字前缀 > 标题包含 > 关键字包含
  return all
    .map((c, i) => ({ c, i, s: score(c, q) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.c);
}

function score(c: SlashCompletion, q: string): number {
  for (const k of c.keywords) if (k.toLowerCase() === q) return 0;
  for (const k of c.keywords) if (k.toLowerCase().startsWith(q)) return 1;
  if (c.label.toLowerCase().includes(q)) return 2;
  for (const k of c.keywords) if (k.toLowerCase().includes(q)) return 3;
  return 99;
}

const ALL_COMPLETIONS: SlashCompletion[] = [
  // 块类型
  { id: "h1", label: "一级标题", group: "块类型", icon: "H₁", keywords: ["h1", "标题", "title"], text: "# " },
  { id: "h2", label: "二级标题", group: "块类型", icon: "H₂", keywords: ["h2", "标题"], text: "## " },
  { id: "h3", label: "三级标题", group: "块类型", icon: "H₃", keywords: ["h3", "标题"], text: "### " },
  { id: "highlight", label: "高亮块", group: "块类型", icon: "🖍", keywords: ["highlight", "高亮", "callout", "提示"], text: "> [!highlight] \n> " },
  { id: "info", label: "信息块", group: "块类型", icon: "ℹ️", keywords: ["info", "信息", "callout"], text: "> [!info] \n> " },
  { id: "warning", label: "警告块", group: "块类型", icon: "⚠️", keywords: ["warning", "警告", "注意"], text: "> [!warning] \n> " },
  { id: "success", label: "成功块", group: "块类型", icon: "✅", keywords: ["success", "成功", "done"], text: "> [!success] \n> " },
  { id: "quote", label: "引用", group: "块类型", icon: "❝", keywords: ["quote", "引用"], text: "> " },
  { id: "code", label: "代码块", group: "块类型", icon: "</>", keywords: ["code", "代码", "代码块"], text: "```\n\n```\n", cursorOffset: -5 },
  // 各语言代码块（紧随通用代码块之后，打 /c、/py 等直接命中）
  ...CODE_LANGS.map((l) => codeLangItem(l.lang, l.name, l.extra)),
  { id: "math", label: "数学公式", group: "块类型", icon: "∑", keywords: ["math", "公式", "formula", "katex", "latex"], text: "$$\n\n$$\n", cursorOffset: -4 },
  {
    id: "mermaid",
    label: "Mermaid 流程图",
    group: "块类型",
    icon: "⑃",
    keywords: ["mermaid", "流程图", "flowchart", "graph"],
    text: "```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n```\n",
  },
  { id: "todo", label: "待办", group: "块类型", icon: "☐", keywords: ["todo", "待办", "task"], text: "- [ ] " },
  {
    id: "table",
    label: "表格",
    group: "块类型",
    icon: "▦",
    keywords: ["table", "表格", "chart"],
    action: "table-grid",
  },
  { id: "divider", label: "分隔线", group: "块类型", icon: "―", keywords: ["divider", "分隔", "hr"], text: "\n---\n" },
  // 格式
  { id: "bold", label: "加粗", group: "格式", icon: "B", keywords: ["bold", "加粗"], text: "****", cursorOffset: -2 },
  { id: "italic", label: "斜体", group: "格式", icon: "I", keywords: ["italic", "斜体"], text: "**", cursorOffset: -1 },
  { id: "inlinecode", label: "行内代码", group: "格式", icon: "`", keywords: ["code", "行内"], text: "``", cursorOffset: -1 },
];

/** 应用一个补全项到 CM6 EditorView（白板）或 Editor（笔记） */
export function applyCompletion(
  item: SlashCompletion,
  target: any, // CM6 EditorView 或 Obsidian Editor
  _app: App
): void {
  if (!item.text) return;
  // CM6 EditorView 接口
  if (target.state && typeof target.dispatch === "function") {
    const sel = target.state.selection.main;
    target.dispatch({
      changes: { from: sel.from, to: sel.to, insert: item.text },
      selection: {
        anchor:
          sel.from +
          item.text.length +
          (item.cursorOffset ?? 0),
      },
    });
    target.focus();
  } else {
    // Obsidian Editor 接口（replaceSelection）
    target.replaceSelection?.(item.text);
  }
}
