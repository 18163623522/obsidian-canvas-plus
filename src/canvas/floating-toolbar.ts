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
import { genId } from "./canvas-access";
import { resyncMindoDatasets } from "./mindo";

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
  // 跟随机制：记录当前选中的节点/边，定时重算屏幕位置
  private currentNodes: CanvasNode[] | null = null;
  private currentEdges: any[] | null = null;
  private followTimer: number | null = null;
  /** 工具栏位置模式：top=节点上方（默认）bottom=节点下方 screen-top=屏幕顶部 */
  positionMode: "top" | "bottom" | "screen-top" = "top";
  /** 已保存的颜色（调色板），由 main.ts 接到 settings.savedColors */
  getSavedColors?: () => string[];
  /** 保存一个颜色到调色板（持久化），由 main.ts 接 saveSettings */
  saveColor?: (hex: string) => void;

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

  /**
   * 光标/选区进入任何 CM 编辑器时隐藏工具条。
   * 双击节点进入编辑态后 selection-changed 不一定再触发，
   * 上面的 isEditing 检查没机会执行，靠这个兜底收起，
   * 避免工具条悬在正在编辑的节点上方与斜杠菜单/格式工具条叠加。
   */
  onDocumentSelectionChange(): void {
    if (!this.el || this.el.style.display === "none") return;
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;
    const anchor = sel.anchorNode;
    const el = (anchor.nodeType === 3 ? anchor.parentElement : anchor) as HTMLElement | null;
    if (el?.closest(".cm-editor")) this.hide();
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
    this.currentNodes = nodes;
    this.currentEdges = null;
    this.startFollow();

    const single = nodes.length === 1;
    const n0 = nodes[0];

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

    // —— 无级调节行：色轮 + 色条 + 字号滑杆 ——
    // 点选节点直接调卡片颜色和文字大小（不要求进入编辑态）
    const tuneRow = el.createDiv({ cls: "cp-tb-tune" });
    const firstData = (): any => (nodes[0] as any)?.getData?.() ?? {};

    const applyColor = (hex: string) => {
      for (const n of nodes) {
        try {
          const d = (n as any).getData?.() ?? {};
          (n as any).setData?.({ ...d, color: hex });
        } catch (e) {
          console.error(e);
        }
      }
      this.currentCanvas?.requestSave?.();
    };

    // 色轮：系统取色器，任意颜色（只改选中卡片的颜色，不自动保存；
    // 要存模版点旁边的"＋"）
    const wheel = tuneRow.createEl("input", {
      cls: "cp-tb-wheel",
      attr: { type: "color", title: "色轮：改选中卡片的颜色（保存请点＋）", "aria-label": "色轮" },
    });
    const curColor = String(firstData().color ?? "");
    if (/^#[0-9a-fA-F]{6}/.test(curColor)) wheel.value = curColor;
    wheel.addEventListener("input", () => {
      if (wheel.value) applyColor(wheel.value);
    });

    // 已保存颜色（调色板）：点击一键套用
    const palette = tuneRow.createDiv({ cls: "cp-tb-palette" });
    const renderPalette = () => {
      palette.empty();
      const saved = this.getSavedColors?.() ?? [];
      for (const hex of saved.slice(-10)) {
        const dot = palette.createEl("button", {
          cls: "cp-tb-swatch",
          attr: { title: `套用 ${hex}`, "aria-label": `颜色 ${hex}` },
        });
        dot.style.background = hex;
        dot.onclick = () => applyColor(hex);
      }
    };
    renderPalette();

    // 保存颜色模版：把当前节点的颜色存进调色板
    const saveColorBtn = tuneRow.createEl("button", {
      cls: "cp-tb-btn cp-tb-savecolor",
      attr: { title: "保存当前颜色到调色板", "aria-label": "保存颜色" },
    });
    saveColorBtn.textContent = "＋";
    saveColorBtn.onclick = () => {
      const col = String(firstData().color ?? "");
      if (/^#[0-9a-fA-F]{3,8}$/.test(col)) {
        this.saveColor?.(col);
        renderPalette();
        new Notice(`已保存 ${col}`);
      } else {
        new Notice("当前节点没有可保存的自定义颜色（先用色轮/色条选色）");
      }
    };

    // 色条：色相条拖动（松手时写入，避免拖动中频繁 setData 重建 DOM）
    const hue = tuneRow.createEl("input", {
      cls: "cp-tb-hue",
      attr: { type: "range", min: "0", max: "359", step: "1", value: "210", title: "色条：拖动调色相", "aria-label": "色条" },
    });
    hue.addEventListener("change", () => {
      applyColor(hslToHex(parseInt(hue.value, 10), 0.85, 0.55));
    });

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 字号：滑杆 + 实时倍率徽章（点徽章复位 1.00×）——
    const sizeGroup2 = tuneRow.createDiv({ cls: "cp-tb-sizegrp" });
    sizeGroup2.createSpan({ cls: "cp-tb-size-cap", text: "字号" });
    const scale = sizeGroup2.createEl("input", {
      cls: "cp-tb-scale",
      attr: { type: "range", min: "0.6", max: "2.4", step: "0.05", value: "1", title: "字号无级调节", "aria-label": "字号" },
    });
    const badge = sizeGroup2.createEl("button", {
      cls: "cp-tb-scale-chip",
      attr: { title: "点击复位为 1.00×", "aria-label": "字号倍率" },
    });
    const fmt = (v: number) => `${v.toFixed(2)}×`;
    const curScale = firstData().cpTextScale;
    if (typeof curScale === "number" && curScale > 0) scale.value = String(curScale);
    badge.textContent = fmt(parseFloat(scale.value));
    const applyScale = async (v: number) => {
      const { setTextScale } = await import("./node-styles");
      for (const n of nodes) setTextScale(n, v === 1 ? undefined : v);
      badge.textContent = fmt(v);
    };
    scale.addEventListener("change", () => applyScale(parseFloat(scale.value)));
    scale.addEventListener("input", () => {
      badge.textContent = fmt(parseFloat(scale.value));
    });
    badge.onclick = () => {
      scale.value = "1";
      applyScale(1);
    };

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 尺寸快捷调整（拖拽手柄不可用时的保底：一键加宽/加高）——
    const sizeAdj = tuneRow.createDiv({ cls: "cp-tb-group" });
    for (const a of [
      { t: "↔+", dw: 60, dh: 0, tt: "加宽 60px" },
      { t: "↔-", dw: -60, dh: 0, tt: "减窄 60px" },
      { t: "↕+", dw: 0, dh: 40, tt: "加高 40px" },
      { t: "↕-", dw: 0, dh: -40, tt: "减矮 40px" },
    ]) {
      const b = sizeAdj.createEl("button", {
        cls: "cp-tb-btn",
        attr: { title: a.tt, "aria-label": a.tt },
      });
      b.textContent = a.t;
      b.onclick = () => {
        for (const n of nodes) {
          try {
            const d = (n as any).getData?.() ?? {};
            const w = Math.max(80, (d.width ?? (n as any).width ?? 200) + a.dw);
            const h = Math.max(40, (d.height ?? (n as any).height ?? 100) + a.dh);
            (n as any).setData?.({ ...d, width: w, height: h });
          } catch (e) {
            console.error(e);
          }
        }
        this.currentCanvas?.requestSave?.();
      };
    }

    el.createDiv({ cls: "cp-tb-divider" });

    // —— 连线模式（不依赖悬停圆点，远程/触屏等丢 hover 的环境也能连线）——
    // 点它后进入连线模式，再点目标节点即建箭头连线，Esc 取消
    const linkBtn = el.createEl("button", {
      cls: "cp-tb-btn",
      attr: { title: "连线：点后选来源，再点目标节点", "aria-label": "连线" },
    });
    linkBtn.textContent = "🔗";
    linkBtn.onclick = () => {
      if (nodes.length === 0) return;
      this.enterLinkMode(nodes[0]);
    };

    el.createDiv({ cls: "cp-tb-divider" });

    // —— Mindo 卡片样式：一键循环 无 → 标题卡 → 无标题卡 ——
    const curMode = String(firstData().styleAttributes?.mindo ?? "");
    const styleBtn = el.createEl("button", {
      cls: "cp-tb-btn cp-tb-stylebtn",
      attr: { title: "Mindo 卡片样式：点击切换（无 → 标题卡 → 无标题卡）", "aria-label": "Mindo 样式" },
    });
    styleBtn.textContent = curMode === "card" ? "🗂" : curMode === "band" ? "▤" : "▦";
    styleBtn.onclick = async () => {
      const { toggleMindoStyle } = await import("./mindo");
      const { refreshMindoCards } = await import("./mindo-card");
      toggleMindoStyle(this.currentCanvas, nodes.map((n: any) => n.id));
      // 立即重刷卡片组件 + 工具栏按钮状态；setData 可能异步重建 DOM，
      // 补两次延时刷新保证新样式及时显示
      refreshMindoCards(nodes);
      setTimeout(() => refreshMindoCards(nodes), 150);
      setTimeout(() => refreshMindoCards(nodes), 400);
      this.show(nodes);
    };

    // -- 正文对齐：左对齐 <-> 居中（写原生 textAlign，与原生命令/右键菜单同一状态；
    //    Obsidian 命令面板搜"对齐"也可绑定快捷键执行本切换）--
    const curAlign = String(firstData().styleAttributes?.cpAlign === "center"
      ? "center"
      : firstData().styleAttributes?.textAlign ?? "left");
    const alignBtn = el.createEl("button", {
      cls: "cp-tb-btn cp-tb-alignbtn",
      attr: { title: "正文对齐：左对齐 / 居中", "aria-label": "正文对齐" },
    });
    alignBtn.textContent = curAlign === "center" ? "⇹" : "⇤";
    alignBtn.onclick = () => {
      const toCenter = curAlign !== "center";
      for (const n of nodes) {
        try {
          const d = (n as any).getData?.() ?? {};
          const sa = { ...((d as any).styleAttributes ?? {}) };
          delete sa.cpAlign; // 统一收敛到原生 textAlign，清掉遗留自定义字段
          if (toCenter) sa.textAlign = "center";
          else delete sa.textAlign;
          (n as any).setData?.({ ...d, styleAttributes: sa });
        } catch (e) {
          console.error(e);
        }
      }
      this.currentCanvas?.requestSave?.();
      import("./mindo-card").then(({ refreshMindoCards }) => {
        refreshMindoCards(nodes);
        setTimeout(() => refreshMindoCards(nodes), 150);
      });
      this.show(nodes);
    };

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
    this.currentEdges = edges;
    this.currentNodes = null;
    this.startFollow();

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
            // CanvasEdge 没有 setColor 方法，走 setData 改颜色
            const d = (e as any).getData?.() ?? {};
            const ed: any = { ...d };
            if (key) ed.color = key;
            else delete ed.color;
            (e as any).setData?.(ed);
          } catch (err) {
            console.error(err);
          }
        }
        this.currentCanvas?.requestSave?.();
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

  /**
   * 跟随循环：工具条可见期间定时按选中节点的当前屏幕位置重算坐标。
   * 不跟随的话，平移/缩放/拖动节点后工具条会滞留原地，
   * 恰好盖住节点的连接点，导致"从节点边缘拉不出连线"。
   */
  private startFollow(): void {
    if (this.followTimer !== null) return;
    this.followTimer = window.setInterval(() => this.followTick(), 80);
  }

  private stopFollow(): void {
    if (this.followTimer !== null) {
      clearInterval(this.followTimer);
      this.followTimer = null;
    }
  }

  private followTick(): void {
    if (!this.el || this.el.style.display === "none") {
      this.stopFollow();
      return;
    }
    if (this.currentNodes && this.currentNodes.length > 0) {
      // 节点被删除/重建（nodeEl 脱离文档）则收起
      const alive = this.currentNodes.some(
        (n) => (n as any).nodeEl && document.contains((n as any).nodeEl)
      );
      if (!alive) {
        this.hide();
        return;
      }
      this.position(this.currentNodes);
      return;
    }
    if (this.currentEdges && this.currentEdges.length > 0) {
      const alive = this.currentEdges.some((e) => {
        const p = e.path ?? e.line;
        return p && document.contains(p);
      });
      if (!alive) {
        this.hide();
        return;
      }
      this.positionEdge(this.currentEdges);
    }
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
    this.el.style.left = `${Math.max(8, cx - tbRect.width / 2)}px`;
    // 与边保持 16px 间距，避让连线交互区
    this.el.style.top = `${Math.max(8, minY - tbRect.height - 16)}px`;
  }

  /** 定位到选中节点集合；按 positionMode 决定上方/下方/屏幕顶部 */
  private position(nodes: CanvasNode[]): void {
    if (!this.el) return;
    // 屏幕顶部固定：横条贴顶居中，完全不挡画布
    if (this.positionMode === "screen-top") {
      const tbRect = this.el.getBoundingClientRect();
      this.el.style.left = `${Math.max(8, (window.innerWidth - tbRect.width) / 2)}px`;
      this.el.style.top = "8px";
      return;
    }
    // 合并所有选中节点的屏幕矩形
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
    // 与节点保持 16px 间距：节点四边中点的连接点（拉出连线的小圆点）
    // 贴边缘内侧放置，16px 间距保证工具条不盖住它们
    let top: number;
    if (this.positionMode === "bottom") {
      top = maxY + 16;
      if (top + tbRect.height > window.innerHeight - 8) top = minY - tbRect.height - 16;
    } else {
      top = minY - tbRect.height - 16;
      if (top < 8) top = Math.min(maxY + 16, window.innerHeight - tbRect.height - 8);
    }
    this.el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tbRect.width - 8))}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  }

  /**
   * 连线模式：不依赖悬停圆点。点工具栏 🔗 后进入，
   * 再点任意目标节点即建立 来源→目标 箭头连线，Esc 取消。
   * 解决远程桌面/触屏等 hover 事件丢失导致原生圆点不出现的问题。
   */
  private linkCleanup?: () => void;

  private enterLinkMode(source: CanvasNode): void {
    this.exitLinkMode();
    this.hide();
    new Notice("连线模式：点击目标节点（Esc 取消）", 3000);

    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".canvas-node") as HTMLElement | null;
      if (!target) return;
      const canvas = this.currentCanvas as any;
      if (!canvas?.nodes) return;
      let hit: CanvasNode | null = null;
      for (const n of canvas.nodes.values()) {
        if ((n as any).nodeEl === target) { hit = n; break; }
      }
      if (!hit || hit === source) return;
      e.stopPropagation();
      this.createEdge(canvas, (source as any).id, (hit as any).id);
      this.exitLinkMode();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.exitLinkMode();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    this.linkCleanup = () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }

  private exitLinkMode(): void {
    this.linkCleanup?.();
    this.linkCleanup = undefined;
  }

  private createEdge(canvas: any, fromId: string, toId: string): void {
    try {
      const data = canvas.getData();
      const id = genId();
      data.edges = [...(data.edges || []), { id, fromNode: fromId, toNode: toId, toEnd: "arrow" } as any];
      canvas.setData(data);
      canvas.requestSave();
      resyncMindoDatasets(canvas);
      new Notice("已连线", 2000);
    } catch (e) {
      console.error("[canvas-plus] createEdge failed", e);
    }
  }

  hide(): void {
    if (this.el) this.el.style.display = "none";
    this.currentNodes = null;
    this.currentEdges = null;
    this.stopFollow();
  }

  destroy(): void {
    this.stopFollow();
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
      // 全量展开再覆盖坐标：防止 setData 以替换语义实现时把节点其他数据清掉
      const d = (node as any).getData?.() ?? {};
      (node as any).setData?.({ ...d, x: Math.round(x), y: Math.round(y) } as any);
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

/** HSL 转 HEX（色条输出需要，JSON Canvas 的 color 字段只认 hex/预设值） */
function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
