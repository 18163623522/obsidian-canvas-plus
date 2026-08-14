/**
 * 一键插入新节点（图片/PDF/视频/公式/Mermaid/代码）
 *
 * 全部使用 createTextViaData/createFileViaData（数据快照模式），
 * 不依赖 createTextNode（签名不稳定）。参考 Quorafind 插件的验证写法。
 */
import { App, TFile, Notice, FuzzySuggestModal } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { createTextViaData, createFileViaData, createLinkViaData } from "./canvas-access";
import { setTextScale, setSticky, setShape, setTitleCard } from "./node-styles";

/** 在视口中心创建节点 */
function center(canvas: Canvas): { x: number; y: number } {
  return canvas.posCenter?.() ?? { x: 0, y: 0 };
}

/** 创建后缩放过去，确保用户能看见 */
function reveal(canvas: Canvas, label: string): void {
  try {
    canvas.zoomToSelection?.();
  } catch (e) {
    console.warn(`[cp-insert] ${label} reveal failed`, e);
  }
}

// ============================================================
//  公式节点
// ============================================================
export function insertMathNode(canvas: Canvas): void {
  const c = center(canvas);
  createTextViaData(canvas, {
    x: c.x - 125,
    y: c.y - 50,
    text: "$$\nE = mc^2\n$$",
    width: 250,
    height: 120,
  });
  reveal(canvas, "公式节点");
  new Notice("已插入公式节点");
}

// ============================================================
//  Mermaid 流程图节点
// ============================================================
export function insertMermaidNode(canvas: Canvas): void {
  const c = center(canvas);
  createTextViaData(canvas, {
    x: c.x - 200,
    y: c.y - 100,
    text: "```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n    B -->|否| D[跳过]\n```",
    width: 400,
    height: 300,
  });
  reveal(canvas, "Mermaid 节点");
  new Notice("已插入 Mermaid 节点");
}

// ============================================================
//  代码节点
// ============================================================
export function insertCodeNode(canvas: Canvas): void {
  const c = center(canvas);
  createTextViaData(canvas, {
    x: c.x - 175,
    y: c.y - 90,
    text: "```js\nfunction hello() {\n  console.log('hello');\n}\n```",
    width: 350,
    height: 200,
  });
  reveal(canvas, "代码节点");
  new Notice("已插入代码节点");
}

// ============================================================
//  文件节点（图片/PDF/视频/任意 vault 文件）+ 标题/气泡文字
// ============================================================

/** 选择器里的条目：文件 或 虚拟文字项 */
type PickerItem =
  | { kind: "file"; file: TFile }
  | { kind: "title" }
  | { kind: "bubble" };

export async function insertFileNode(canvas: Canvas, app: App): Promise<void> {
  const files = app.vault.getFiles().filter((f) =>
    /\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp4|webm|mp3|wav|ogg)$/i.test(f.path)
  );
  // 文件可以为空（只显示文字选项）；但一个都没有时给提示也行，这里仍打开选择器
  const chosen = await new FilePickerModal(app, files).pick();
  if (!chosen) return;

  const c = center(canvas);

  if (chosen.kind === "file") {
    createFileViaData(canvas, {
      x: c.x - 200,
      y: c.y - 150,
      file: chosen.file.path,
    });
    reveal(canvas, `文件节点 ${chosen.file.name}`);
    new Notice(`已添加 ${chosen.file.name}`);
    return;
  }

  if (chosen.kind === "title") {
    const id = createTextViaData(canvas, { x: c.x - 150, y: c.y - 60, text: "# 标题\n\n正文内容", width: 300, height: 120 });
    const n = canvas.nodes.get(id);
    if (n) setTitleCard(n);
    reveal(canvas, "标题文字");
    new Notice("已添加标题文字");
    return;
  }

  if (chosen.kind === "bubble") {
    const id = createTextViaData(canvas, { x: c.x - 90, y: c.y - 35, text: "", width: 180, height: 70 });
    const n = canvas.nodes.get(id);
    if (n) { setSticky(n, "yellow"); setShape(n, "rounded"); }
    reveal(canvas, "气泡文字");
    new Notice("已添加气泡文字");
    return;
  }
}

// ============================================================
//  外部 URL 节点（YouTube/网页）
// ============================================================
export function insertUrlNode(canvas: Canvas, url: string): void {
  const c = center(canvas);
  createLinkViaData(canvas, {
    x: c.x - 200,
    y: c.y - 150,
    url,
  });
  reveal(canvas, "URL 节点");
  new Notice("已插入 URL 节点");
}

// ============================================================
//  文件选择器 Modal（含标题/气泡文字虚拟项）
// ============================================================
class FilePickerModal extends FuzzySuggestModal<PickerItem> {
  private files: TFile[];
  private resolve?: (item: PickerItem | null) => void;

  constructor(app: App, files: TFile[]) {
    super(app);
    this.files = files;
    this.setPlaceholder("选择图片/PDF/视频/音频，或直接选标题/气泡文字...");
  }

  pick(): Promise<PickerItem | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  getItems(): PickerItem[] {
    // 虚拟文字项放最前面，方便直接选
    const virtuals: PickerItem[] = [
      { kind: "title" },
      { kind: "bubble" },
    ];
    const fileItems: PickerItem[] = this.files.map((f) => ({ kind: "file", file: f }));
    return [...virtuals, ...fileItems];
  }

  getItemText(item: PickerItem): string {
    if (item.kind === "title") return "📝 标题文字";
    if (item.kind === "bubble") return "💬 气泡文字";
    return item.file.path;
  }

  onChooseItem(item: PickerItem): void {
    this.resolve?.(item);
  }

  onClose(): void {
    setTimeout(() => this.resolve?.(null), 0);
  }
}
