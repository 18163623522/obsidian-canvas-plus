/**
 * 斜杠菜单（Slash Menu）—— 飞书/Notion 风格
 *
 * 在编辑器行首或空行输入 `/` 即弹出选项面板，方向键选择、回车确认。
 * 支持输入关键字过滤（如 `/h1`、`/code`、`/size`）。
 *
 * 实现：继承 EditorSuggest<T>。onTrigger 检测行首的 `/`。
 * 选中后用 editor.replaceRange 删除 `/` 并插入对应 Markdown。
 */
import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import { setBlockFontSize, FONT_SIZES } from "./block-fontsize";

/** 一条菜单项 */
export interface SlashItem {
  id: string;
  /** 显示名 */
  label: string;
  /** 用于过滤的关键字（小写） */
  keywords: string[];
  /** 图标 emoji（简单起见用 emoji，不引图标库） */
  icon: string;
  /** 分组 */
  group: "块类型" | "字号" | "格式";
  /** 选中后执行的动作：要么插入文本，要么调命令 */
  insert?: {
    /** 要插入的文本（\n 表示换行）；插入位置会替换掉触发用的 `/` */
    text: string;
    /** 插入后光标相对插入末尾的偏移（用于把光标放到合适位置） */
    cursorOffset?: number;
  };
  /** 或者执行一个命令（用于字号这类需要光标定位的） */
  action?: "fontsize" ;
  actionParam?: string;
}

/** 全部菜单项 */
const MENU_ITEMS: SlashItem[] = [
  // —— 块类型 ——
  {
    id: "h1",
    label: "一级标题",
    keywords: ["h1", "标题", "heading", "title", "大标题"],
    icon: "H₁",
    group: "块类型",
    insert: { text: "# " },
  },
  {
    id: "h2",
    label: "二级标题",
    keywords: ["h2", "标题", "heading", "中标题"],
    icon: "H₂",
    group: "块类型",
    insert: { text: "## " },
  },
  {
    id: "h3",
    label: "三级标题",
    keywords: ["h3", "标题", "heading", "小标题"],
    icon: "H₃",
    group: "块类型",
    insert: { text: "### " },
  },
  {
    id: "highlight",
    label: "高亮块（黄色）",
    keywords: ["highlight", "高亮", "callout", "提示", "重点"],
    icon: "🖍",
    group: "块类型",
    insert: { text: "> [!highlight] 标题\n> 内容\n" },
  },
  {
    id: "info",
    label: "信息块",
    keywords: ["info", "信息", "callout", "提示"],
    icon: "ℹ️",
    group: "块类型",
    insert: { text: "> [!info] 标题\n> 内容\n" },
  },
  {
    id: "warning",
    label: "警告块",
    keywords: ["warning", "警告", "注意", "callout"],
    icon: "⚠️",
    group: "块类型",
    insert: { text: "> [!warning] 标题\n> 内容\n" },
  },
  {
    id: "quote",
    label: "引用",
    keywords: ["quote", "引用", "blockquote"],
    icon: "❝",
    group: "块类型",
    insert: { text: "> " },
  },
  {
    id: "code",
    label: "代码块",
    keywords: ["code", "代码", "codeblock"],
    icon: "</>",
    group: "块类型",
    insert: { text: "```js\n\n```\n", cursorOffset: -5 },
  },
  {
    id: "todo",
    label: "待办事项",
    keywords: ["todo", "待办", "任务", "task", "checkbox"],
    icon: "☐",
    group: "块类型",
    insert: { text: "- [ ] " },
  },
  {
    id: "divider",
    label: "分隔线",
    keywords: ["divider", "分隔", "hr", "线"],
    icon: "―",
    group: "块类型",
    insert: { text: "\n---\n" },
  },
  // —— 格式 ——
  {
    id: "bold",
    label: "加粗",
    keywords: ["bold", "加粗", "粗体"],
    icon: "B",
    group: "格式",
    insert: { text: "****", cursorOffset: -2 },
  },
  {
    id: "italic",
    label: "斜体",
    keywords: ["italic", "斜体", "italic"],
    icon: "I",
    group: "格式",
    insert: { text: "**", cursorOffset: -1 },
  },
  {
    id: "inline-code",
    label: "行内代码",
    keywords: ["code", "inline", "行内代码"],
    icon: "`",
    group: "格式",
    insert: { text: "``", cursorOffset: -1 },
  },
  // —— 字号 ——
  ...Object.entries(FONT_SIZES).map(([size, info]) => ({
    id: `size-${size}`,
    label: `字号 ${info.label}`,
    keywords: ["size", "字号", "字体", "font", size, info.label],
    icon: "🔤",
    group: "字号" as const,
    action: "fontsize" as const,
    actionParam: size,
  })),
];

export class SlashMenuSuggest extends EditorSuggest<SlashItem> {
  app: App;

  constructor(app: App) {
    super(app);
    this.app = app;
  }

  /**
   * 触发条件：行首（或空行）输入了 `/`，且后面只跟可选的过滤词。
   * 用正则匹配 `/` 之后到光标的内容。
   */
  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    // 取当前行从行首到光标的内容
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch);
    // 匹配：行首允许空白，然后 `/`，再跟过滤词（字母数字中文）
    const m = before.match(/^\s*\/([\w\u4e00-\u9fa5]*)$/);
    if (!m) return null;

    return {
      start: { line: cursor.line, ch: before.indexOf("/") },
      end: cursor,
      query: m[1], // `/` 后面的过滤词
    };
  }

  getSuggestions(context: EditorSuggestContext): SlashItem[] {
    const q = context.query.toLowerCase().trim();
    let items = MENU_ITEMS;
    if (q) {
      items = items.filter((item) => {
        if (item.label.toLowerCase().includes(q)) return true;
        return item.keywords.some((k) => k.toLowerCase().includes(q));
      });
    }
    // 按分组排序，让同类挨在一起
    const groupOrder: Record<string, number> = { 块类型: 0, 格式: 1, 字号: 2 };
    return items.sort((a, b) => {
      const ga = groupOrder[a.group] ?? 99;
      const gb = groupOrder[b.group] ?? 99;
      if (ga !== gb) return ga - gb;
      return a.label.localeCompare(b.label, "zh");
    });
  }

  renderSuggestion(item: SlashItem, el: HTMLElement): void {
    const row = el.createDiv({ cls: "cp-slash-item" });
    const icon = row.createSpan({ cls: "cp-slash-icon", text: item.icon });
    icon.setAttribute("aria-hidden", "true");
    row.createSpan({ cls: "cp-slash-label", text: item.label });
    row.createSpan({ cls: "cp-slash-group", text: item.group });
  }

  selectSuggestion(item: SlashItem, _evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (!ctx) return;
    const editor = ctx.editor;

    // 1. 先删除触发的 `/query` 文本（从 start 到 end）
    editor.replaceRange("", ctx.start, ctx.end);

    // 2. 执行动作
    if (item.insert) {
      const before = editor.posToOffset(editor.getCursor());
      editor.replaceSelection(item.insert.text);
      if (item.insert.cursorOffset) {
        const newCursor = editor.offsetToPos(before + item.insert.text.length + item.insert.cursorOffset);
        editor.setCursor(newCursor);
      }
    } else if (item.action === "fontsize" && item.actionParam) {
      setBlockFontSize(editor, parseInt(item.actionParam, 10));
    }

    this.close();
  }
}
