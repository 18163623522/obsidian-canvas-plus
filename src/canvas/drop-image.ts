/**
 * 图片/文件拖拽入白板
 *
 * 从外部（文件管理器/浏览器）拖文件到 Canvas：
 *  - 图片（png/jpg/...）：保存到 vault 附件目录，创建 file 节点
 *  - 其他文件：保存到 vault，创建 file 节点
 *
 * 实现：监听 canvas.wrapperEl 的 drop 事件，拦截 DataTransfer。
 */
import type { App, Plugin } from "obsidian";
import { TFile, Notice, normalizePath } from "obsidian";
import type { Canvas } from "../types/canvas-internal";
import { createFileViaData } from "./canvas-access";

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

export function setupDropHandler(plugin: Plugin): () => void {
  const handlers = new Map<HTMLElement, (e: DragEvent) => void>();

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    const wrapper = canvas?.wrapperEl as HTMLElement | undefined;
    if (!wrapper || handlers.has(wrapper)) return;

    const onDrop = async (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      // 只处理含文件的拖拽
      const hasFiles = dt.files && dt.files.length > 0;
      const hasHtmlImg = Array.from(dt.items || []).some(
        (i) => i.kind === "file" && i.type.startsWith("image/")
      );
      if (!hasFiles && !hasHtmlImg) return;

      e.preventDefault();
      e.stopPropagation();

      const canvas2 = (leaves[0] as any).view?.canvas;
      if (!canvas2) return;

      // 释放点 → 画布坐标
      const dropPos = canvas2.posFromEvt?.(e) ?? canvas2.posFromClient?.({
        x: e.clientX,
        y: e.clientY,
      }) ?? { x: 0, y: 0 };

      // 1. 真实文件（从文件管理器拖入）
      if (dt.files && dt.files.length > 0) {
        for (const file of Array.from(dt.files)) {
          await importAndCreate(plugin.app, canvas2, file, dropPos);
        }
        return;
      }

      // 2. 网页图片（拖入的是 img 元素，需从 items 取）
      for (const item of Array.from(dt.items || [])) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) await importAndCreate(plugin.app, canvas2, f as File, dropPos);
        }
      }
    };
    wrapper.addEventListener("drop", onDrop, true);
    // 阻止 Obsidian 默认处理（避免它当成文本插入）
    wrapper.addEventListener("dragover", (e) => e.preventDefault(), true);
    handlers.set(wrapper, onDrop);
  };

  const timer = setInterval(attach, 800);
  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    for (const [el, fn] of handlers) {
      el.removeEventListener("drop", fn, true);
    }
    handlers.clear();
  };
}

/** 把拖入的文件保存到 vault 附件目录，创建 file 节点 */
async function importAndCreate(app: App, canvas: Canvas, file: File, pos: { x: number; y: number }) {
  try {
    // 读文件为 ArrayBuffer
    const buf = await file.arrayBuffer();
    // 附件目录：用 Obsidian 配置，兜底 attachments/
    const attachFolder = (app.vault as any).config?.attachmentFolderPath ?? "attachments";
    const folder = attachFolder === "/" || attachFolder === "" ? "" : attachFolder + "/";
    const fileName = file.name || `pasted-${Date.now()}.png`;
    const fullPath = normalizePath(folder + fileName);

    // 确保目录存在
    if (folder) {
      try {
        await app.vault.createFolder(folder.replace(/\/$/, ""));
      } catch {
        // 已存在，忽略
      }
    }
    // 避免覆盖：若已存在同名，加序号
    let finalPath = fullPath;
    let i = 1;
    while (app.vault.getAbstractFileByPath(finalPath)) {
      const ext = fullPath.match(/\.\w+$/)?.[0] ?? "";
      const base = fullPath.slice(0, -ext.length);
      finalPath = `${base}-${i}${ext}`;
      i++;
    }

    const created = await app.vault.createBinary(finalPath, new Uint8Array(buf) as any);
    // 创建文件节点（数据快照模式）
    createFileViaData(canvas, {
      x: pos.x,
      y: pos.y,
      file: finalPath,
      width: 300,
      height: 220,
    });
    new Notice(`已添加 ${fileName}`);
  } catch (e) {
    console.error("[canvas-plus] importAndCreate failed", e);
    new Notice(`添加失败：${(e as Error).message}`);
  }
}
