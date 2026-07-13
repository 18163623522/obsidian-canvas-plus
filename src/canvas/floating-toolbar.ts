/**
 * 浮动工具条（Edgeless Toolbar）
 *
 * 选中 Canvas 节点时，在节点上方弹出工具条：
 *  - 颜色（6 色）
 *  - 字号（小/标/大/更大）
 *  - 对齐子菜单（左/水平居中/右/顶/垂直居中/底/水平等距/垂直等距）
 *  - 删除
 *
 * 定位：跟随选中节点的屏幕矩形（getBoundingClientRect，自动含 zoom/pan）
 * 生命周期：选中变化→显示/更新；选中空/进编辑态/切画布→隐藏
 */
import { App, Notice } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";

const COLORS: Record<string, { label: string; bg: string }> = {
  none: { label: "无", bg: "transparent" },
  "1": { label: "红", bg: "#fb462c" },
  "2": { label: "橙", bg: "#e9973f" },
  "3": { label: "黄", bg: "#d0a72c" },
  "4": { label: "绿", bg: "#086d6d" },
  "5": { label: "青", bg: "#0a87c5" },
  "6": { label: "紫", bg: "#8764e8" },
};

const TOOLBAR_ID = "cp-floating-toolbar";

export class FloatingToolbar {
  private el: HTMLElement | null = null;
  private app: App;
  private currentCanvas: any = null;

  constructor(app: App) {
    this.app = app;
  }

  /** 由 selection-changed 事件调用 */
  onSelectionChanged(canvas: any): void {
    this.currentCanvas = canvas;
    const { nodes, edges } = this.getSelected(canvas);
    if (nodes.length === 0 && edges.length === 0) {
      this.hide();
      return;
    }
    // 进入编辑态时隐藏（让位给编辑器内 slash 菜单）
    if (nodes.length === 1 && (nodes[0] as any).isEditing) {
      this.hide();
      return;
    }
    // 优先：选中边时显示边工具条
    if (edges.length > 0 && nodes.length === 0) {
      this.showEdgeToolbar(edges);
      return;
    }
    if (nodes.length > 0) {
      this.show(nodes);
    }
  }

  private getSelected(canvas: any): { nodes: CanvasNode[]; edges: any[] } {
    const sel = canvas?.selection;
    if (!sel) return { nodes: [], edges: [] };
    const nodes: CanvasNode[] = [];
    const edges: any[] = [];
    for (const el of sel.values()) {
      if (!el) continue;
      const data = el.getData?.();
      // 节点：有 nodeEl 或 data.type 是 text/file/link/group
      if (el.nodeEl || (data && ["text", "file", "link", "group"].includes(data.type))) {
        nodes.push(el);
      }
      // 边：有 path 或 data 含 fromNode/toNode
      else if (el.path || el.line || (data && data.fromNode)) {
        edges.push(el);
      }
    }
    return { nodes, edges };
  }

  // 兼容旧调用
  private getSelectedNodes(canvas: any): CanvasNode[] {
    return this.getSelected(canvas).nodes;
  }

  private ensureEl(): HTMLElement {
    if (this.el && document.body.contains(this.el)) return this.el;
    const el = document.body.createDiv({ attr: { id: TOOLBAR_ID } });
    el.className = "cp-floating-toolbar";
    this.el = el;
    return el;
  }

  private show(nodes: CanvasNode[]): void {
    const el = this.ensureEl();
    el.empty();
    el.style.display = "flex";

    const single = nodes.length === 1;
    const n0 = nodes[0];

    // —— 颜色按钮组 ——
    const colorGroup = el.createDiv({ cls: "cp-tb-group" });
    for (const [key, info] of Object.entries(COLORS)) {
      const btn = colorGroup.createEl("button", {
        cls: "cp-tb-btn cp-color-btn",
        attr: { "aria-label": `颜色：${info.label}`, title: `颜色：${info.label}` },
      });
      btn.style.background = info.bg;
      btn.onclick = () => {
        for (const n of nodes) {
          try {
            if (key === "none") (n as any).setColor?.("");
            else (n as any).setColor?.(key);
          } catch (e) {
            console.error(e);
          }
        }
      };
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 字号（持久化版，写进 nodeData.cpTextScale） ——
    const sizeGroup = el.createDiv({ cls: "cp-tb-group" });
    for (const sz of [
      { label: "A-", scale: 0.85, title: "缩小" },
      { label: "A", scale: undefined, title: "标准" },
      { label: "A+", scale: 1.2, title: "放大" },
      { label: "A++", scale: 1.5, title: "更大" },
    ]) {
      const btn = sizeGroup.createEl("button", { cls: "cp-tb-btn cp-size-btn", attr: { title: sz.title } });
      btn.textContent = sz.label;
      btn.onclick = async () => {
        const { setTextScale } = await import("./node-styles");
        for (const n of nodes) setTextScale(n, sz.scale);
      };
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 对齐/分布（需多选） ——
    const alignGroup = el.createDiv({ cls: "cp-tb-group" });
    const aligns = [
      { icon: "⇤", title: "左对齐", fn: () => this.alignLeft(nodes) },
      { icon: "↔", title: "水平居中", fn: () => this.alignHCenter(nodes) },
      { icon: "⇥", title: "右对齐", fn: () => this.alignRight(nodes) },
      { icon: "⇧", title: "顶对齐", fn: () => this.alignTop(nodes) },
      { icon: "↕", title: "垂直居中", fn: () => this.alignVCenter(nodes) },
      { icon: "⇩", title: "底对齐", fn: () => this.alignBottom(nodes) },
      { icon: "⥆", title: "水平等距", fn: () => this.distributeH(nodes) },
      { icon: "⇅", title: "垂直等距", fn: () => this.distributeV(nodes) },
    ];
    for (const a of aligns) {
      const btn = alignGroup.createEl("button", {
        cls: "cp-tb-btn cp-align-btn",
        attr: { title: a.title, "aria-label": a.title },
      });
      btn.textContent = a.icon;
      btn.onclick = a.fn;
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 切换纯文字 / 卡片 ——
    const plainBtn = el.createEl("button", {
      cls: "cp-tb-btn cp-plain-btn",
      attr: { title: "切换纯文字（无边框）/ 卡片样式", "aria-label": "切换纯文字/卡片" },
    });
    plainBtn.textContent = "T̄";
    plainBtn.onclick = async () => {
      const { togglePlain } = await import("./plain-text");
      for (const n of nodes) togglePlain(n);
      this.hide();
    };

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 形状（圆角/椭圆/菱形） ——
    const shapeGroup = el.createDiv({ cls: "cp-tb-group" });
    for (const shape of [
      { icon: "▭", value: undefined, title: "矩形（默认）" },
      { icon: "▢", value: "rounded" as const, title: "圆角" },
      { icon: "○", value: "ellipse" as const, title: "椭圆" },
      { icon: "◇", value: "diamond" as const, title: "菱形" },
    ]) {
      const btn = shapeGroup.createEl("button", {
        cls: "cp-tb-btn cp-shape-btn",
        attr: { title: shape.title, "aria-label": shape.title },
      });
      btn.textContent = shape.icon;
      btn.onclick = async () => {
        const { setShape } = await import("./node-styles");
        for (const n of nodes) setShape(n, shape.value);
        this.hide();
      };
    }

    // —— 便签 ——
    const stickyGroup = el.createDiv({ cls: "cp-tb-group" });
    const stickyBtn = stickyGroup.createEl("button", {
      cls: "cp-tb-btn cp-sticky-btn",
      attr: { title: "转便签（黄）", "aria-label": "便签" },
    });
    stickyBtn.textContent = "📋";
    stickyBtn.onclick = async () => {
      const { setSticky } = await import("./node-styles");
      for (const n of nodes) setSticky(n, "yellow");
      this.hide();
    };

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 删除 ——
    const delBtn = el.createEl("button", {
      cls: "cp-tb-btn cp-delete-btn",
      attr: { title: "删除选中", "aria-label": "删除选中" },
    });
    delBtn.textContent = "🗑";
    delBtn.onclick = () => {
      for (const n of nodes) {
        try {
          (n.canvas as any)?.removeNode?.(n);
        } catch (e) {
          console.error(e);
        }
      }
      this.hide();
    };

    // —— 定位 ——
    this.position(nodes);
  }

  /** 选中边时的工具条：线型/粗细/颜色/删除 */
  private showEdgeToolbar(edges: any[]): void {
    const el = this.ensureEl();
    el.empty();
    el.style.display = "flex";

    // —— 线型 ——
    const styleGroup = el.createDiv({ cls: "cp-tb-group" });
    for (const ls of [
      { icon: "─", value: "solid" as const, title: "实线" },
      { icon: "╌", value: "dashed" as const, title: "虚线" },
      { icon: "⋯", value: "dotted" as const, title: "点线" },
    ]) {
      const btn = styleGroup.createEl("button", {
        cls: "cp-tb-btn",
        attr: { title: ls.title, "aria-label": ls.title },
      });
      btn.textContent = ls.icon;
      btn.onclick = async () => {
        const { setEdgeStyle } = await import("./node-styles");
        for (const e of edges) setEdgeStyle(e, ls.value);
        this.hide();
      };
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 粗细 ——
    const weightGroup = el.createDiv({ cls: "cp-tb-group" });
    for (const w of [
      { icon: "│", value: 1, title: "细" },
      { icon: "┃", value: 2, title: "中" },
      { icon: "█", value: 3, title: "粗" },
    ]) {
      const btn = weightGroup.createEl("button", {
        cls: "cp-tb-btn",
        attr: { title: w.title, "aria-label": w.title },
      });
      btn.textContent = w.icon;
      btn.onclick = async () => {
        const { setEdgeWeight } = await import("./node-styles");
        for (const e of edges) setEdgeWeight(e, w.value);
        this.hide();
      };
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 颜色 ——
    const colorGroup = el.createDiv({ cls: "cp-tb-group" });
    const edgeColors: Record<string, { label: string; bg: string }> = {
      "1": { label: "红", bg: "#fb462c" },
      "2": { label: "橙", bg: "#e9973f" },
      "4": { label: "绿", bg: "#086d6d" },
      "6": { label: "紫", bg: "#8764e8" },
    };
    for (const [key, info] of Object.entries(edgeColors)) {
      const btn = colorGroup.createEl("button", {
        cls: "cp-tb-btn cp-color-btn",
        attr: { title: `颜色：${info.label}`, "aria-label": `颜色：${info.label}` },
      });
      btn.style.background = info.bg;
      btn.onclick = () => {
        for (const e of edges) {
          try {
            (e as any).setColor?.(key);
          } catch (err) {
            console.error(err);
          }
        }
        this.hide();
      };
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 删除 ——
    const delBtn = el.createEl("button", {
      cls: "cp-tb-btn cp-delete-btn",
      attr: { title: "删除连线", "aria-label": "删除连线" },
    });
    delBtn.textContent = "🗑";
    delBtn.onclick = () => {
      for (const e of edges) {
        try {
          (e.canvas as any)?.removeEdge?.(e);
        } catch (err) {
          console.error(err);
        }
      }
      this.hide();
    };

    // 定位到边的中间
    this.positionEdge(edges);
  }

  /** 定位到边的屏幕中点上方 */
  private positionEdge(edges: any[]): void {
    if (!this.el) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of edges) {
      // 边的 SVG path：getBBox 拿画布坐标；但屏幕坐标更准用 getBoundingClientRect
      const pathEl = (e.path as SVGElement | undefined) ?? (e.line as SVGElement | undefined);
      if (pathEl && pathEl.getBoundingClientRect) {
        const r = pathEl.getBoundingClientRect();
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right);
        maxY = Math.max(maxY, r.bottom);
      }
    }
    if (minX === Infinity) {
      // 兜底：用边端点节点的位置
      this.hide();
      return;
    }
    const cx = (minX + maxX) / 2;
    const tbRect = this.el.getBoundingClientRect();
    const left = cx - tbRect.width / 2;
    const topAbove = minY - tbRect.height - 52;
    const topBelow = maxY + 12;
    const top = topAbove >= 8 ? topAbove : topBelow;
    this.el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tbRect.width - 8))}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }

  /** 定位到选中节点集合的包围盒上方居中 */
  private position(nodes: CanvasNode[]): void {
    if (!this.el) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const nodeEl = (n as any).nodeEl as HTMLElement | undefined;
      if (!nodeEl) continue;
      const r = nodeEl.getBoundingClientRect();
      if (r.left < minX) minX = r.left;
      if (r.top < minY) minY = r.top;
      if (r.right > maxX) maxX = r.right;
      if (r.bottom > maxY) maxY = r.bottom;
    }
    if (minX === Infinity) {
      this.hide();
      return;
    }
    const width = maxX - minX;
    const tbRect = this.el.getBoundingClientRect();
    const left = minX + width / 2 - tbRect.width / 2;
    // 上方留 52px 给 Obsidian 原生工具条；空间不够时放下方
    const topAbove = minY - tbRect.height - 52;
    const topBelow = maxY + 12;
    const top = topAbove >= 8 ? topAbove : topBelow;
    this.el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tbRect.width - 8))}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }

  hide(): void {
    if (this.el) this.el.style.display = "none";
  }

  destroy(): void {
    this.el?.remove();
    this.el = null;
  }

  // ============================================================
  // ============================================================
  //  字号缩放已迁移到 node-styles.ts 的 setTextScale（持久化版）
  // ============================================================

  // ============================================================
  //  对齐与分布（直接改 node.x/y，再 setData 触发重渲染）
  // ============================================================
  private moveNode(node: CanvasNode, x: number, y: number): void {
    try {
      (node as any).setData?.({ x: Math.round(x), y: Math.round(y) } as any);
    } catch (e) {
      console.error(e);
    }
  }

  private alignLeft(nodes: CanvasNode[]) {
    const minX = Math.min(...nodes.map((n) => n.x));
    for (const n of nodes) this.moveNode(n, minX, n.y);
    this.currentCanvas?.requestSave?.();
  }
  private alignRight(nodes: CanvasNode[]) {
    const maxX = Math.max(...nodes.map((n) => n.x + n.width)) ;
    for (const n of nodes) this.moveNode(n, maxX - n.width, n.y);
    this.currentCanvas?.requestSave?.();
  }
  private alignHCenter(nodes: CanvasNode[]) {
    const minCenter = Math.min(...nodes.map((n) => n.x + n.width / 2));
    for (const n of nodes) this.moveNode(n, minCenter - n.width / 2, n.y);
    this.currentCanvas?.requestSave?.();
  }
  private alignTop(nodes: CanvasNode[]) {
    const minY = Math.min(...nodes.map((n) => n.y));
    for (const n of nodes) this.moveNode(n, n.x, minY);
    this.currentCanvas?.requestSave?.();
  }
  private alignBottom(nodes: CanvasNode[]) {
    const maxY = Math.max(...nodes.map((n) => n.y + n.height));
    for (const n of nodes) this.moveNode(n, n.x, maxY - n.height);
    this.currentCanvas?.requestSave?.();
  }
  private alignVCenter(nodes: CanvasNode[]) {
    const minCenter = Math.min(...nodes.map((n) => n.y + n.height / 2));
    for (const n of nodes) this.moveNode(n, n.x, minCenter - n.height / 2);
    this.currentCanvas?.requestSave?.();
  }
  private distributeH(nodes: CanvasNode[]) {
    if (nodes.length < 3) return;
    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const step = (last.x - first.x) / (sorted.length - 1);
    sorted.forEach((n, i) => this.moveNode(n, first.x + step * i, n.y));
    this.currentCanvas?.requestSave?.();
  }
  private distributeV(nodes: CanvasNode[]) {
    if (nodes.length < 3) return;
    const sorted = [...nodes].sort((a, b) => a.y - b.y);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const step = (last.y - first.y) / (sorted.length - 1);
    sorted.forEach((n, i) => this.moveNode(n, n.x, first.y + step * i));
    this.currentCanvas?.requestSave?.();
  }
}
