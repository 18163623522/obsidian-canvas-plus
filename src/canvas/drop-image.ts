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
  // wrapper -> 卸载函数（同时移除 drop 和 dragover 两个监听）
  const handlers = new Map<HTMLElement, () => void>();

  const attach = () => {
    // 遍历全部画布叶子：多画布并存时每个画布都支持拖入图片
    for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
      const canvas = (leaf as any).view?.canvas;
      const wrapper = canvas?.wrapperEl as HTMLElement | undefined;
      if (!wrapper || handlers.has(wrapper)) continue;

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

        const canvas2 = (leaf as any).view?.canvas;
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
      // 阻止 Obsidian 默认处理（避免它当成文本插入）
      const onDragOver = (e: DragEvent) => e.preventDefault();
      wrapper.addEventListener("drop", onDrop, true);
      wrapper.addEventListener("dragover", onDragOver, true);
      handlers.set(wrapper, () => {
        wrapper.removeEventListener("drop", onDrop, true);
        wrapper.removeEventListener("dragover", onDragOver, true);
      });
    }
  };

  const timer = setInterval(attach, 800);
  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    for (const dispose of handlers.values()) dispose();
    handlers.clear();
  };
}

/** 把拖入的文件保存到 vault 附件目录，创建 file 节点 */
async function importAndCreate(app: App, canvas: Canvas, file: File, pos: { x: number; y: number }) {
  try {
    // 读文件为 ArrayBuffer
    const buf = await file.arrayBuffer();
    const fileName = file.name || `pasted-${Date.now()}.png`;
    const fullPath = await resolveAttachmentPath(app, canvas, fileName);

    // 确保目录存在
    const folder = fullPath.replace(/\/[^/]*$/, "");
    if (folder) {
      try {
        await app.vault.createFolder(folder);
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
    // createBinary 返回 TFile；createFileNode 只认 TFile，传字符串会毒化节点
    // （filePath=undefined + 每次渲染 getShortName 崩溃），所以直接把 TFile 传下去
    createFileViaData(canvas, {
      x: pos.x,
      y: pos.y,
      file: created,
      width: 300,
      height: 220,
    });
    new Notice(`已添加 ${fileName}`);
  } catch (e) {
    console.error("[canvas-plus] importAndCreate failed", e);
    new Notice(`添加失败：${(e as Error).message}`);
  }
}

/**
 * 解析附件存放路径。
 * 优先用官方 vault.getAvailablePathForAttachments：完整尊重"附件默认存放位置"
 * 的四种模式（含 "./"=当前文件所在目录，即白板文件旁边），并自动处理同名。
 * 老版本没有该 API 时，手工兜底（"./" 会被归一化到仓库根目录）。
 */
async function resolveAttachmentPath(app: App, canvas: Canvas, fileName: string): Promise<string> {
  const vault = app.vault as any;
  if (typeof vault.getAvailablePathForAttachments === "function") {
    try {
      const dot = fileName.lastIndexOf(".");
      const base = dot > 0 ? fileName.slice(0, dot) : fileName;
      const ext = dot > 0 ? fileName.slice(dot + 1) : "png";
      const activeFile = (canvas as any).view?.file ?? app.workspace.getActiveFile();
      const path = await vault.getAvailablePathForAttachments(base, ext, activeFile);
      if (typeof path === "string" && path) return normalizePath(path);
    } catch {
      // 走下面的手工兜底
    }
  }
  const attachFolder = vault.config?.attachmentFolderPath ?? "attachments";
  const folder = attachFolder === "/" || attachFolder === "" ? "" : attachFolder + "/";
  return normalizePath(folder + fileName);
}
