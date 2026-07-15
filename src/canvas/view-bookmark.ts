/**
 * 视图书签
 *
 * 保存当前画布的缩放/平移位置，一键跳回。
 * 数据存在画布的 .canvas 文件里（用隐藏 text 节点存 JSON）。
 *
 * 命令：
 *  - 保存当前视图
 *  - 跳转到视图（列表选择）
 *  - 删除视图
 */
import { App, Notice, FuzzySuggestModal } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { addNodeData, genId } from "./canvas-access";

const VIEWMARKER = "%%cp:views%%";

interface ViewBookmark {
  id: string;
  name: string;
  zoom: number;
  x: number;
  y: number;
  timestamp: number;
}

/** 读取已存的书签列表 */
function loadBookmarks(canvas: Canvas): { bookmarks: ViewBookmark[]; nodeId: string | null } {
  for (const node of canvas.nodes.values()) {
    const data = node.getData() as any;
    if (data?.text?.includes(VIEWMARKER)) {
      try {
        const json = data.text.replace(VIEWMARKER, "").trim();
        const bookmarks = json ? JSON.parse(json) : [];
        return { bookmarks, nodeId: data.id };
      } catch {
        return { bookmarks: [], nodeId: data.id };
      }
    }
  }
  return { bookmarks: [], nodeId: null };
}

/** 保存书签列表 */
function saveBookmarks(canvas: Canvas, bookmarks: ViewBookmark[], nodeId: string | null) {
  const json = JSON.stringify(bookmarks);
  const text = `${VIEWMARKER}${json}`;
  if (!nodeId) {
    const id = addNodeData(canvas, {
      type: "text",
      x: -99999,
      y: -99999,
      width: 1,
      height: 1,
      text,
    });
    return id;
  } else {
    const node = canvas.nodes.get(nodeId);
    if (node) {
      const d = node.getData();
      node.setData({ ...d, text });
      canvas.requestSave();
    }
    return nodeId;
  }
}

/** 保存当前视图 */
export function saveCurrentView(app: App, canvas: Canvas): void {
  const { bookmarks, nodeId } = loadBookmarks(canvas);
  const name = window.prompt("给这个视图起个名字", `视图 ${bookmarks.length + 1}`);
  if (!name) return;

  const bookmark: ViewBookmark = {
    id: genId(),
    name,
    zoom: (canvas as any).tZoom ?? 1,
    x: (canvas as any).tx ?? 0,
    y: (canvas as any).ty ?? 0,
    timestamp: Date.now(),
  };
  bookmarks.push(bookmark);
  saveBookmarks(canvas, bookmarks, nodeId);
  new Notice(`已保存视图「${name}」`);
}

/** 跳转到视图 */
export function gotoView(app: App, canvas: Canvas): void {
  const { bookmarks } = loadBookmarks(canvas);
  if (bookmarks.length === 0) {
    new Notice("没有保存的视图");
    return;
  }
  new ViewPickerModal(app, bookmarks, (bm) => {
    (canvas as any).setViewport?.(bm.x, bm.y, bm.zoom);
    (canvas as any).markViewportChanged?.();
    new Notice(`已跳转到「${bm.name}」`);
  }).open();
}

/** 删除视图 */
export function deleteView(app: App, canvas: Canvas): void {
  const { bookmarks, nodeId } = loadBookmarks(canvas);
  if (bookmarks.length === 0) {
    new Notice("没有保存的视图");
    return;
  }
  new ViewPickerModal(app, bookmarks, (bm) => {
    const filtered = bookmarks.filter((b) => b.id !== bm.id);
    saveBookmarks(canvas, filtered, nodeId);
    new Notice(`已删除「${bm.name}」`);
  }, true).open();
}

class ViewPickerModal extends FuzzySuggestModal<ViewBookmark> {
  private bookmarks: ViewBookmark[];
  private onSelect: (bm: ViewBookmark) => void;

  constructor(app: App, bookmarks: ViewBookmark[], onSelect: (bm: ViewBookmark) => void, _isDelete = false) {
    super(app);
    this.bookmarks = bookmarks;
    this.onSelect = onSelect;
  }

  getItems(): ViewBookmark[] {
    return this.bookmarks;
  }
  getItemText(item: ViewBookmark): string {
    return `${item.name}（缩放 ${Math.round(item.zoom * 100)}%）`;
  }
  onChooseItem(item: ViewBookmark): void {
    this.onSelect(item);
  }
}
