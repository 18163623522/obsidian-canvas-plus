/**
 * 一键插入新节点（图片/PDF/视频/公式/Mermaid/代码）
 *
 * 全部使用 createTextViaData/createFileViaData（数据快照模式），
 * 不依赖 createTextNode（签名不稳定）。参考 Quorafind 插件的验证写法。
 */
import { App, TFile, Notice, FuzzySuggestModal } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { createTextViaData, createFileViaData, createLinkViaData } from "./canvas-access";

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
//  文件节点（图片/PDF/视频/任意 vault 文件）
// ============================================================
export async function insertFileNode(canvas: Canvas, app: App): Promise<void> {
  const files = app.vault.getFiles().filter((f) =>
    /\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp4|webm|mp3|wav|ogg)$/i.test(f.path)
  );
  if (files.length === 0) {
    new Notice("Vault 里没有图片/PDF/视频/音频文件");
    return;
  }
  const chosen = await new FilePickerModal(app, files).pick();
  if (!chosen) return;
  const c = center(canvas);
  createFileViaData(canvas, {
    x: c.x - 200,
    y: c.y - 150,
    file: chosen.path,
  });
  reveal(canvas, `文件节点 ${chosen.name}`);
  new Notice(`已添加 ${chosen.name}`);
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
//  文件选择器 Modal
// ============================================================
class FilePickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private resolve?: (f: TFile | null) => void;

  constructor(app: App, files: TFile[]) {
    super(app);
    this.files = files;
    this.setPlaceholder("选择图片/PDF/视频/音频...");
  }

  pick(): Promise<TFile | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  getItems(): TFile[] {
    return this.files;
  }
  getItemText(item: TFile): string {
    return item.path;
  }
  onChooseItem(item: TFile): void {
    this.resolve?.(item);
  }
  onClose(): void {
    setTimeout(() => this.resolve?.(null), 0);
  }
}
