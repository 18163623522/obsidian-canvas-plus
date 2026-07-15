/**
 * 导出高清图
 *
 * 把画布内容导出为 PNG（@2x）或 SVG。
 * 不依赖 Obsidian 原生导出，自己遍历 getData() 重绘。
 *
 * PNG：用离屏 canvas 绘制节点矩形 + 文字 + 边
 * SVG：生成 <rect>/<text>/<line> 元素
 * 选区导出：只导出选中节点的 bbox 范围
 */
import { App, Notice, Modal, Setting } from "obsidian";
import type { Canvas } from "../types/canvas-internal";

export function exportImage(app: App, canvas: Canvas): void {
  new ExportModal(app, (format, scale, selectionOnly) => {
    const data = canvas.getData();
    let nodes = data.nodes;
    let edges = data.edges;

    if (selectionOnly) {
      const selIds = new Set(
        Array.from(canvas.selection?.values?.() ?? []).map((n: any) => n.getData?.()?.id).filter(Boolean)
      );
      nodes = nodes.filter((n: any) => selIds.has(n.id));
      edges = edges.filter((e: any) => selIds.has(e.fromNode) && selIds.has(e.toNode));
    }

    if (nodes.length === 0) {
      new Notice("没有可导出的节点");
      return;
    }

    // 计算包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes as any[]) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const padding = 40;
    minX -= padding; minY -= padding;
    maxX += padding; maxY += padding;
    const w = maxX - minX;
    const h = maxY - minY;

    if (format === "png") {
      exportPNG(nodes, edges, minX, minY, w, h, scale, app);
    } else {
      exportSVG(nodes, edges, minX, minY, w, h, scale, app);
    }
  }).open();
}

/** 导出 PNG */
function exportPNG(nodes: any[], edges: any[], offX: number, offY: number, w: number, h: number, scale: number, app: App) {
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 白色背景
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  // 画边
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1.5;
  for (const e of edges) {
    const from = nodes.find((n) => n.id === e.fromNode);
    const to = nodes.find((n) => n.id === e.toNode);
    if (!from || !to) continue;
    const fx = from.x + from.width / 2 - offX;
    const fy = from.y + from.height / 2 - offY;
    const tx = to.x + to.width / 2 - offX;
    const ty = to.y + to.height / 2 - offY;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  // 画节点
  for (const n of nodes) {
    const x = n.x - offX;
    const y = n.y - offY;
    // 背景
    ctx.fillStyle = n.color ? colorMap(n.color) : "#f5f5f5";
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    if (n.type === "group") {
      ctx.fillStyle = "rgba(200,200,200,0.15)";
    }
    ctx.fillRect(x, y, n.width, n.height);
    ctx.strokeRect(x, y, n.width, n.height);
    // 文字
    if (n.text) {
      ctx.fillStyle = "#333";
      ctx.font = "14px sans-serif";
      const lines = n.text.replace(/[#*>`\[\]]/g, "").split("\n").filter(Boolean).slice(0, 5);
      lines.forEach((line: string, i: number) => {
        ctx.fillText(line.slice(0, 40), x + 8, y + 20 + i * 18);
      });
    }
    if (n.file) {
      ctx.fillStyle = "#666";
      ctx.font = "12px sans-serif";
      ctx.fillText("📄 " + n.file.split("/").pop(), x + 8, y + 20);
    }
  }

  // 下载
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `canvas-export-${Date.now()}.png`);
    new Notice(`已导出 PNG（${Math.round(w * scale)}×${Math.round(h * scale)}）`);
  });
}

/** 导出 SVG */
function exportSVG(nodes: any[], edges: any[], offX: number, offY: number, w: number, h: number, scale: number, app: App) {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">`);
  parts.push(`<rect width="${w}" height="${h}" fill="white"/>`);

  // 边
  for (const e of edges) {
    const from = nodes.find((n) => n.id === e.fromNode);
    const to = nodes.find((n) => n.id === e.toNode);
    if (!from || !to) continue;
    const fx = from.x + from.width / 2 - offX;
    const fy = from.y + from.height / 2 - offY;
    const tx = to.x + to.width / 2 - offX;
    const ty = to.y + to.height / 2 - offY;
    parts.push(`<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="${e.color ? colorMap(e.color) : '#999'}" stroke-width="1.5"/>`);
  }

  // 节点
  for (const n of nodes) {
    const x = n.x - offX;
    const y = n.y - offY;
    const bg = n.color ? colorMap(n.color) : "#f5f5f5";
    const fill = n.type === "group" ? "rgba(200,200,200,0.15)" : bg;
    parts.push(`<rect x="${x}" y="${y}" width="${n.width}" height="${n.height}" fill="${fill}" stroke="#ccc" stroke-width="1" rx="4"/>`);
    if (n.text) {
      const lines = n.text.replace(/[#*>`\[\]]/g, "").split("\n").filter(Boolean).slice(0, 5);
      lines.forEach((line: string, i: number) => {
        const text = line.slice(0, 40).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        parts.push(`<text x="${x + 8}" y="${y + 20 + i * 18}" font-size="14" font-family="sans-serif" fill="#333">${text}</text>`);
      });
    }
    if (n.file) {
      const fname = n.file.split("/").pop().replace(/&/g, "&amp;").replace(/</g, "&lt;");
      parts.push(`<text x="${x + 8}" y="${y + 20}" font-size="12" font-family="sans-serif" fill="#666">📄 ${fname}</text>`);
    }
  }

  parts.push("</svg>");
  const svgStr = parts.join("\n");
  const blob = new Blob([svgStr], { type: "image/svg+xml" });
  downloadBlob(blob, `canvas-export-${Date.now()}.svg`);
  new Notice("已导出 SVG");
}

function colorMap(color: string): string {
  const map: Record<string, string> = {
    "1": "#fb462c", "2": "#e9973f", "3": "#d0a72c",
    "4": "#086d6d", "5": "#0a87c5", "6": "#8764e8",
  };
  return map[color] || color || "#f5f5f5";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

class ExportModal extends Modal {
  private format: "png" | "svg" = "png";
  private scale = 2;
  private selectionOnly = false;
  private onSubmit: (format: "png" | "svg", scale: number, selectionOnly: boolean) => void;

  constructor(app: App, onSubmit: (format: "png" | "svg", scale: number, selectionOnly: boolean) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "导出画布" });

    new Setting(contentEl).setName("格式").addDropdown((d) => {
      d.addOption("png", "PNG 高清");
      d.addOption("svg", "SVG 矢量");
      d.setValue("png");
      d.onChange((v) => (this.format = v as any));
    });

    new Setting(contentEl).setName("倍率（PNG）").addDropdown((d) => {
      d.addOption("1", "1x");
      d.addOption("2", "2x");
      d.addOption("3", "3x");
      d.setValue("2");
      d.onChange((v) => (this.scale = parseInt(v)));
    });

    new Setting(contentEl).setName("仅导出选中").addToggle((t) => {
      t.onChange((v) => (this.selectionOnly = v));
    });

    new Setting(contentEl).addButton((b) => {
      b.setButtonText("导出");
      b.setCta();
      b.onClick(() => {
        this.close();
        this.onSubmit(this.format, this.scale, this.selectionOnly);
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
