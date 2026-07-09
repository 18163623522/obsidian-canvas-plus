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
}

export function getSlashCompletions(query: string): SlashCompletion[] {
  const q = query.toLowerCase().trim();
  const all = ALL_COMPLETIONS;
  if (!q) return all;
  return all.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.keywords.some((k) => k.toLowerCase().includes(q))
  );
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
  { id: "code", label: "代码块", group: "块类型", icon: "</>", keywords: ["code", "代码"], text: "```js\n\n```\n", cursorOffset: -6 },
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
    text: "\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n",
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
