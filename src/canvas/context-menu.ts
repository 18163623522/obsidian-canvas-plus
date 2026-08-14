/**
 * 白板右键菜单（DOM 追加方案，零冲突）
 *
 * 监听 canvas.wrapperEl 的 contextmenu 事件。
 * 等原生菜单出现后，往它的 DOM 里追加我们的菜单项。
 * 子菜单用延时关闭，hover 顺畅。
 */
import { Plugin, Menu, Notice } from "obsidian";
import { createTextViaData } from "./canvas-access";
import { setShape, setSticky, togglePlain, setEdgeStyle, setEdgeWeight, setTextScale, setTitleCard } from "./node-styles";
import { expandOneDegree, expandTwoDegrees } from "./graph-expand";
import { createIframeNode } from "./iframe-node";
import { toggleLock, toggleHide, bringToFront, sendToBack } from "./layers";
import { setEdgeLabel, setEdgeColor, setEdgeArrow, getEdgeArrowMode } from "./edge-enhance";
import { groupSelection, toggleCollapseGroup } from "./group-collapse";
import { setNodeIcon, getIconList } from "./node-icon";

/** Lucide SVG 图标（Obsidian 内置风格） */
const ICONS: Record<string, string> = {
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  layout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  palette: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-10-10z"/></svg>',
  spline: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c4-8 14-8 18 0"/><path d="M19 12l2-2M21 14l-2-2"/></svg>',
  chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
};

/** 保存右键位置（画布坐标），供插入节点使用 */
let lastContextMenuPos: { x: number; y: number } = { x: 0, y: 0 };

/**
 * 常驻「+」浮动按钮（不依赖右键事件，100% 可靠）
 *
 * 在白板视图右下角放一个插入按钮，点击弹官方 Menu。
 * 无论右键被哪个插件拦截、菜单是什么形态，这个按钮永远可用。
 */
export function setupQuickInsertButton(plugin: Plugin): () => void {
  const placed = new Set<HTMLElement>();

  const place = () => {
    try {
      const leaves = plugin.app.workspace.getLeavesOfType("canvas");
      for (const leaf of leaves) {
        const view: any = (leaf as any).view;
        const containerEl: HTMLElement | undefined = view?.containerEl;
        const canvas: any = view?.canvas;
        if (!containerEl || !canvas || placed.has(containerEl)) continue;

        const btn = document.createElement("div");
        btn.className = "cp-quick-insert-btn";
        btn.setAttribute("aria-label", "插入节点");
        try {
          const { setIcon } = require("obsidian") as any;
          setIcon(btn, "plus");
        } catch {
          btn.textContent = "+";
        }
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const c2 = view?.canvas;
          if (!c2) return;
          // 以视口中心为插入位置
          const center = c2.posCenter?.() ?? { x: 0, y: 0 };
          showInsertMenu(c2, center, e as MouseEvent);
        });
        containerEl.appendChild(btn);
        placed.add(containerEl);
      }
    } catch (e) {
      console.warn("[cp-menu] 放置插入按钮失败", e);
    }
  };

  plugin.app.workspace.onLayoutReady(place);
  const ref = plugin.app.workspace.on("layout-change", place);

  return () => {
    plugin.app.workspace.offref(ref);
    for (const el of placed) el.querySelector(".cp-quick-insert-btn")?.remove();
    placed.clear();
  };
}

export function setupContextMenu(plugin: Plugin): () => void {
  const handlers = new Map<HTMLElement, (e: MouseEvent) => void>();

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    const wrapper = canvas?.wrapperEl as HTMLElement | undefined;
    if (!wrapper || handlers.has(wrapper)) return;

    const onCtx = (e: MouseEvent) => {
      const canvas2 = (leaves[0] as any).view?.canvas;
      if (!canvas2) return;
      diagnoseEventFired = true;
      // 记录右键位置（转换成画布坐标）
      try {
        lastContextMenuPos = canvas2.posFromEvt?.(e) ?? canvas2.posFromClient?.({ x: e.clientX, y: e.clientY }) ?? { x: 0, y: 0 };
      } catch {
        lastContextMenuPos = canvas2.pointer ?? { x: 0, y: 0 };
      }
      // 等原生菜单出现后追加
      setTimeout(() => appendToNativeMenu(canvas2, plugin), 100);
    };
    wrapper.addEventListener("contextmenu", onCtx, true);
    handlers.set(wrapper, onCtx);
  };

  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    plugin.app.workspace.offref(layoutRef);
    for (const [el, fn] of handlers) el.removeEventListener("contextmenu", fn, true);
    handlers.clear();
  };
}

/** 诊断状态（诊断命令开启后收集右键链路各环节数据） */
let diagnoseActive = false;
let diagnoseEventFired = false;
let diagnoseMenuFound = false;
let diagnosePopupClasses: string[] = [];
let diagnoseMenuClasses: string[] = [];

/**
 * 诊断命令：开启 15 秒诊断窗口。
 * 右键一次后报告：①监听 ②事件 ③菜单出现情况 ④菜单 class 名
 */
export function startContextMenuDiagnose(plugin: Plugin): void {
  diagnoseActive = false;
  diagnoseEventFired = false;
  diagnoseMenuFound = false;
  diagnosePopupClasses = [];
  diagnoseMenuClasses = [];

  let attached = false;
  let wrapperInfo = "无";
  try {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    const canvas = (leaves[0] as any).view?.canvas;
    const wrapper = canvas?.wrapperEl as HTMLElement | undefined;
    attached = !!wrapper;
    wrapperInfo = wrapper ? `${wrapper.className.slice(0, 40)}...` : "wrapperEl 不存在";
  } catch {}

  const baseMenus = document.querySelectorAll(".menu, .canvas-popup-menu").length;

  diagnoseActive = true;
  new Notice(`诊断已开启（15 秒内右键白板一次）\n监听: ${attached ? "✓" : "✗ " + wrapperInfo}`, 6000);

  setTimeout(() => {
    diagnoseActive = false;
    const nowMenus = document.querySelectorAll(".menu, .canvas-popup-menu").length;
    const parts = [
      `① 监听: ${attached ? "✓" : "✗"}`,
      `② 事件: ${diagnoseEventFired ? "✓" : "✗"}`,
      `③ 菜单: ${diagnoseMenuFound ? "✓已增强" : nowMenus > baseMenus ? "出现但未识别" : "✗未弹出"}`,
    ];
    if (diagnosePopupClasses.length > 0) parts.push(`popup-menu class: ${diagnosePopupClasses.join(", ")}`);
    if (diagnoseMenuClasses.length > 0) parts.push(`.menu class: ${diagnoseMenuClasses.join(", ")}`);
    new Notice(`右键诊断：\n${parts.join("\n")}`, 12000);
    console.log("[cp-menu] 诊断详情", { attached, eventFired: diagnoseEventFired, menuFound: diagnoseMenuFound, baseMenus, nowMenus, diagnosePopupClasses, diagnoseMenuClasses });
  }, 15000);
}

/** 找到原生菜单 DOM，往里追加我们的项（带重试：菜单可能渲染慢） */
function appendToNativeMenu(canvas: any, plugin: Plugin, attempt = 0) {
  const DELAYS = [100, 200, 300, 500, 800];
  try {
    const ok = appendToNativeMenuInner(canvas, plugin);
    if (ok) {
      diagnoseMenuFound = true;
      return;
    }
    if (attempt < DELAYS.length) {
      // 菜单还没渲染出来，稍后重试
      setTimeout(() => appendToNativeMenu(canvas, plugin, attempt + 1), DELAYS[attempt]);
    } else {
      // 重试用完（约 2 秒）还没有任何原生菜单 ——
      // 说明这个环境的白板右键根本不弹菜单，直接弹我们的完整菜单兜底
      console.debug("[cp-menu] 原生菜单未出现，直接弹插入菜单");
      showInsertMenu(canvas, lastContextMenuPos);
      if (diagnoseActive) {
        new Notice("诊断：右键事件✓ 但原生菜单未弹出，已直接弹插入菜单", 8000);
      }
    }
  } catch (e) {
    console.error("[cp-menu] 追加菜单项失败", e);
  }
}

function appendToNativeMenuInner(canvas: any, plugin: Plugin): boolean {
  // ── 优先：白板原生 popup menu（图标按钮条）──
  const popup = document.querySelector(".canvas-popup-menu:not(.is-cp-added)") as HTMLElement | null;
  if (popup && document.body.contains(popup)) {
    if (diagnoseActive) diagnosePopupClasses = Array.from(popup.classList);
    popup.classList.add("is-cp-added");
    addInsertButtonToPopupMenu(popup, canvas);
    console.debug("[cp-menu] 已往 canvas-popup-menu 加插入按钮");
    return true;
  }

  // ── fallback：标准 .menu ──
  const menus = Array.from(document.querySelectorAll(".menu")) as HTMLElement[];
  let menuEl: HTMLElement | null = null;
  for (const el of menus) {
    if (el.classList.contains("cp-submenu") || el.classList.contains("is-cp-added")) continue;
    if (!document.body.contains(el)) continue;
    if (diagnoseActive) diagnoseMenuClasses = Array.from(el.classList);
    menuEl = el;
    break;
  }
  if (!menuEl) {
    // 诊断模式：列出页面上所有菜单类元素，帮定位
    if (diagnoseActive) {
      const all = Array.from(document.querySelectorAll("[class*='menu'], [class*='popup'], [class*='context']")) as HTMLElement[];
      const classes = all.slice(0, 10).map((el) => el.className.slice(0, 60));
      console.log("[cp-menu] 页面上的菜单类元素:", classes);
    }
    console.debug("[cp-menu] 没找到菜单 DOM");
    return false;
  }
  menuEl.classList.add("is-cp-added");
  console.debug("[cp-menu] 找到标准菜单，开始追加自定义项");

  // 点击菜单项后关闭整个菜单
  const closeMenu = () => {
    menuEl?.click(); // 点击空白处关闭 Obsidian 菜单
    setTimeout(() => menuEl?.remove(), 100);
  };

  const sel = canvas.selection;
  const selArr = Array.from(sel?.values?.() ?? []);
  const nodes = selArr.filter((el: any) => el?.nodeEl || ["text", "file", "link", "group"].includes(el?.getData?.()?.type));
  const edges = selArr.filter((el: any) => el?.path || el?.line || el?.getData?.()?.fromNode);
  const c = lastContextMenuPos; // 用右键位置而非视口中心

  // 追加分隔线
  const divider = document.createElement("div");
  divider.className = "menu-separator";
  menuEl.appendChild(divider);

  if (edges.length > 0 && nodes.length === 0) {
    appendEdgeItems(menuEl, edges[0], closeMenu);
  } else if (nodes.length > 0) {
    appendNodeItems(menuEl, nodes, closeMenu, canvas, plugin);
  } else {
    appendBlankItems(menuEl, canvas, c, plugin, closeMenu);
  }
  console.debug(`[cp-menu] 追加完成（选中节点 ${nodes.length} / 连线 ${edges.length}）`);
  return true;
}

function attemptLabel(): string {
  return "次尝试";
}

/**
 * 往白板 popup menu（图标按钮条）加一个"插入"按钮。
 * 点击弹出标准 Obsidian Menu（官方 API，最可靠），
 * 内含 标题/气泡/便签/纯文字/图片 等插入项，创建在右键位置。
 */
function addInsertButtonToPopupMenu(popupEl: HTMLElement, canvas: any): void {
  // 已加过就跳过（防御）
  if (popupEl.querySelector(".cp-insert-btn")) return;

  const btn = document.createElement("div");
  btn.className = "clickable-icon cp-insert-btn";
  btn.setAttribute("aria-label", "插入节点");
  btn.style.padding = "6px";
  // 用 Lucide plus 图标（Obsidian setIcon）
  try {
    const { setIcon } = require("obsidian") as any;
    setIcon(btn, "plus");
  } catch {
    btn.textContent = "+";
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    showInsertMenu(canvas, lastContextMenuPos, e as MouseEvent);
  });
  popupEl.appendChild(btn);
}

/** 弹出插入节点菜单（Obsidian 官方 Menu，任意位置可用） */
function showInsertMenu(canvas: any, c: { x: number; y: number }, anchorEvent?: MouseEvent): void {
  const menu = new Menu();
  const items: Array<{ label: string; fn: () => void }> = [
    {
      label: "标题文字（标题栏+正文）",
      fn: () => {
        const id = createTextViaData(canvas, { x: c.x - 150, y: c.y - 60, text: "正文内容", width: 300, height: 120 });
        const n = canvas.nodes.get(id);
        if (n) { setTitleCard(n); (n as any).setData?.({ ...(n as any).getData(), cpTitle: "标题" }); }
      },
    },
    {
      label: "气泡文字",
      fn: () => {
        const id = createTextViaData(canvas, { x: c.x - 90, y: c.y - 35, text: "", width: 180, height: 70 });
        const n = canvas.nodes.get(id);
        if (n) { setSticky(n, "yellow"); setShape(n, "rounded"); }
      },
    },
    {
      label: "文本节点",
      fn: () => { createTextViaData(canvas, { x: c.x - 125, y: c.y - 50, text: "", width: 250, height: 100 }); },
    },
    {
      label: "纯文字（无边框）",
      fn: () => {
        const id = createTextViaData(canvas, { x: c.x - 125, y: c.y - 30, text: "", width: 250, height: 60 });
        const n = canvas.nodes.get(id);
        if (n) togglePlain(n);
      },
    },
    {
      label: "便签（黄）",
      fn: () => {
        const id = createTextViaData(canvas, { x: c.x - 100, y: c.y - 100, text: "", width: 200, height: 200 });
        const n = canvas.nodes.get(id);
        if (n) setSticky(n, "yellow");
      },
    },
    {
      label: "代码节点",
      fn: () => { createTextViaData(canvas, { x: c.x - 175, y: c.y - 100, text: "```js\n\n```", width: 350, height: 200 }); },
    },
    {
      label: "公式节点",
      fn: () => { createTextViaData(canvas, { x: c.x - 125, y: c.y - 60, text: "$$\nE = mc^2\n$$", width: 250, height: 120 }); },
    },
    {
      label: "图片/PDF/视频...",
      fn: async () => {
        const m = await import("./quick-insert");
        m.insertFileNode(canvas, (canvas as any).view?.app ?? (window as any).app);
      },
    },
    {
      label: "网页嵌入...",
      fn: () => {
        const url = window.prompt("输入网址（https://...）", "https://");
        if (url) createIframeNode(canvas, url);
      },
    },
  ];
  for (const it of items) {
    menu.addItem((mi) => mi.setTitle(it.label).onClick(() => { try { it.fn(); } catch (e) { console.error("[cp-menu] 插入失败", e); } }));
  }
  // 定位：优先用真实点击事件的坐标；否则用白板视图中心的屏幕坐标
  let clientX = 0;
  let clientY = 0;
  if (anchorEvent && (anchorEvent.clientX || anchorEvent.clientY)) {
    clientX = anchorEvent.clientX;
    clientY = anchorEvent.clientY;
  } else {
    try {
      const containerEl: HTMLElement | undefined = (canvas as any).view?.containerEl;
      const r = containerEl?.getBoundingClientRect?.();
      if (r) {
        clientX = r.left + r.width / 2;
        clientY = r.top + Math.min(r.height / 2, 300);
      }
    } catch {}
  }
  menu.showAtMouseEvent(new MouseEvent("click", { clientX, clientY }));
}

// ============================================================
//  DOM 菜单项构造
// ============================================================
function createItem(label: string, icon: string, onClick: () => void, hasSubmenu = false): HTMLElement {
  const item = document.createElement("div");
  item.className = "menu-item tappable";
  item.setAttribute("role", "menuitem");
  item.setAttribute("tabindex", "0");

  if (icon && ICONS[icon]) {
    const iconEl = document.createElement("div");
    iconEl.className = "menu-item-icon";
    iconEl.innerHTML = ICONS[icon];
    item.appendChild(iconEl);
  }

  const labelEl = document.createElement("div");
  labelEl.className = "menu-item-label";
  labelEl.textContent = label;
  item.appendChild(labelEl);

  if (hasSubmenu) {
    const arrow = document.createElement("div");
    arrow.className = "menu-item-arrow";
    arrow.innerHTML = ICONS.chevron;
    item.appendChild(arrow);
  }

  item.addEventListener("click", onClick);
  return item;
}

/** 空白处：插入节点 + 布局 */
function appendBlankItems(menuEl: HTMLElement, canvas: any, c: { x: number; y: number }, plugin: Plugin, closeMenu: () => void) {
  const insertItem = createItem("插入节点", "plus", () => {}, true);
  const sub = createSubmenu(insertItem, [
    { label: "文本节点", onClick: () => { createTextViaData(canvas, { x: c.x - 125, y: c.y - 50, text: "", width: 250, height: 100 }); closeMenu(); } },
    { label: "标题文字", onClick: () => { const id = createTextViaData(canvas, { x: c.x - 150, y: c.y - 60, text: "正文内容", width: 300, height: 120 }); const n = canvas.nodes.get(id); if (n) { setTitleCard(n); (n as any).setData?.({ ...(n as any).getData(), cpTitle: "标题" }); } closeMenu(); } },
    { label: "气泡文字", onClick: () => { const id = createTextViaData(canvas, { x: c.x - 90, y: c.y - 35, text: "", width: 180, height: 70 }); const n = canvas.nodes.get(id); if (n) { setSticky(n, "yellow"); setShape(n, "rounded"); } closeMenu(); } },
    { label: "纯文字（无边框）", onClick: () => { const id = createTextViaData(canvas, { x: c.x - 125, y: c.y - 30, text: "", width: 250, height: 60 }); togglePlain(canvas.nodes.get(id)); closeMenu(); } },
    { label: "便签（黄）", onClick: () => { const id = createTextViaData(canvas, { x: c.x - 100, y: c.y - 100, text: "", width: 200, height: 200 }); setSticky(canvas.nodes.get(id), "yellow"); closeMenu(); } },
    { label: "代码节点", onClick: () => { createTextViaData(canvas, { x: c.x - 175, y: c.y - 100, text: "```js\n\n```", width: 350, height: 200 }); closeMenu(); } },
    { label: "公式节点", onClick: () => { createTextViaData(canvas, { x: c.x - 125, y: c.y - 60, text: "$$\nE = mc^2\n$$", width: 250, height: 120 }); closeMenu(); } },
    { label: "Mermaid 流程图", onClick: () => { createTextViaData(canvas, { x: c.x - 200, y: c.y - 150, text: "```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n```", width: 400, height: 300 }); closeMenu(); } },
    { label: "表格", onClick: () => { createTextViaData(canvas, { x: c.x - 175, y: c.y - 100, text: "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |", width: 350, height: 200 }); closeMenu(); } },
    { label: "倒计时", onClick: () => { const t = window.prompt("目标时间（2026-12-31T23:59:59）", "2026-12-31T23:59:59"); if (t) { const d = new Date(t); if (!isNaN(d.getTime())) { createTextViaData(canvas, { x: c.x - 120, y: c.y - 50, text: `%%cp:countdown:${d.toISOString()}%%`, width: 240, height: 100 }); } } closeMenu(); } },
    { label: "秒表", onClick: () => { createTextViaData(canvas, { x: c.x - 120, y: c.y - 70, text: "%%cp:timer%%", width: 240, height: 140 }); closeMenu(); } },
    { label: "图片/PDF/视频...", onClick: async () => { closeMenu(); const m = await import("./quick-insert"); m.insertFileNode(canvas, plugin.app); } },
    { label: "网页嵌入...", onClick: () => { const url = window.prompt("输入网址（https://...）", "https://"); if (url) { createIframeNode(canvas, url); closeMenu(); } } },
  ]);
  menuEl.appendChild(insertItem);

  const layoutItem = createItem("自动布局", "layout", () => {}, true);
  const sub2 = createSubmenu(layoutItem, [
    { label: "力导向", onClick: async () => { closeMenu(); const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "force" }); } },
    { label: "树形", onClick: async () => { closeMenu(); const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "tree" }); } },
    { label: "放射", onClick: async () => { closeMenu(); const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "radial" }); } },
    { label: "流程图", onClick: async () => { closeMenu(); const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "dag" }); } },
  ]);
  menuEl.appendChild(layoutItem);
}

/** 节点右键：快捷插入 + 样式 + 展开链接 + 分组 */
function appendNodeItems(menuEl: HTMLElement, nodes: any[], closeMenu: () => void, canvas: any, plugin: Plugin) {
  // 快捷插入文字（在选中节点旁边创建，方便给图片/视频配文字）
  {
    const refData = nodes[0]?.getData?.() ?? {};
    const nx = refData.x ?? 0;
    const ny = (refData.y ?? 0) + (refData.height ?? 100) + 60; // 节点下方
    const insertItem = createItem("插入文字", "plus", () => {}, true);
    createSubmenu(insertItem, [
      { label: "标题文字（标题栏+正文）", onClick: () => {
          const id = createTextViaData(canvas, { x: nx, y: ny, text: "正文内容", width: 300, height: 120 });
          const n = canvas.nodes.get(id);
          if (n) { setTitleCard(n); (n as any).setData?.({ ...(n as any).getData(), cpTitle: "标题" }); }
          closeMenu();
        } },
      { label: "气泡文字", onClick: () => {
          const id = createTextViaData(canvas, { x: nx, y: ny, text: "", width: 180, height: 70 });
          const n = canvas.nodes.get(id);
          if (n) { setSticky(n, "yellow"); setShape(n, "rounded"); }
          closeMenu();
        } },
      { label: "便签（黄）", onClick: () => {
          const id = createTextViaData(canvas, { x: nx, y: ny, text: "", width: 200, height: 200 });
          const n = canvas.nodes.get(id);
          if (n) setSticky(n, "yellow");
          closeMenu();
        } },
      { label: "纯文字（无边框）", onClick: () => {
          const id = createTextViaData(canvas, { x: nx, y: ny, text: "", width: 250, height: 60 });
          const n = canvas.nodes.get(id);
          if (n) togglePlain(n);
          closeMenu();
        } },
    ]);
    menuEl.appendChild(insertItem);
  }

  // 多选时显示"打包分组"
  if (nodes.length >= 2) {
    const groupItem = createItem("打包分组", "layout", () => { groupSelection(canvas); closeMenu(); });
    menuEl.appendChild(groupItem);
  }

  // 单选 group 节点时显示"折叠/展开"
  if (nodes.length === 1 && nodes[0].getData?.()?.type === "group") {
    const collapseItem = createItem("折叠/展开分组", "layout", () => { toggleCollapseGroup(canvas, nodes[0]); closeMenu(); });
    menuEl.appendChild(collapseItem);
  }
  // 展开链接（仅单选时）
  if (nodes.length === 1) {
    const expandItem = createItem("展开链接", "layout", () => {}, true);
    const sub = createSubmenu(expandItem, [
      { label: "展开 1 度链接", onClick: () => { expandOneDegree(plugin.app, canvas); closeMenu(); } },
      { label: "展开 2 度链接", onClick: () => { expandTwoDegrees(plugin.app, canvas); closeMenu(); } },
    ]);
    menuEl.appendChild(expandItem);
  }

  const styleItem = createItem("节点样式", "palette", () => {}, true);
  const sub = createSubmenu(styleItem, [
    { label: "切换纯文字/卡片", onClick: () => { nodes.forEach((n) => togglePlain(n)); closeMenu(); } },
    { label: "转便签（黄）", onClick: () => { nodes.forEach((n) => setSticky(n, "yellow")); closeMenu(); } },
    { label: "圆角", onClick: () => { nodes.forEach((n) => setShape(n, "rounded")); closeMenu(); } },
    { label: "椭圆", onClick: () => { nodes.forEach((n) => setShape(n, "ellipse")); closeMenu(); } },
    { label: "菱形", onClick: () => { nodes.forEach((n) => setShape(n, "diamond")); closeMenu(); } },
    { label: "默认矩形", onClick: () => { nodes.forEach((n) => setShape(n, undefined)); closeMenu(); } },
  ]);
  menuEl.appendChild(styleItem);

  // 图标标记
  const iconItem = createItem("图标标记", "palette", () => {}, true);
  const iconItems = getIconList().map(icon => ({
    label: icon,
    onClick: () => { nodes.forEach((n) => setNodeIcon(n, icon)); closeMenu(); },
  }));
  iconItems.push({ label: "清除图标", onClick: () => { nodes.forEach((n) => setNodeIcon(n, undefined)); closeMenu(); } });
  createSubmenu(iconItem, iconItems);
  menuEl.appendChild(iconItem);

  // 图层管理（仅单选时）
  if (nodes.length === 1) {
    const layerItem = createItem("图层管理", "layout", () => {}, true);
    const layerSub = createSubmenu(layerItem, [
      { label: "置顶", onClick: () => { bringToFront(nodes[0]); closeMenu(); } },
      { label: "置底", onClick: () => { sendToBack(nodes[0]); closeMenu(); } },
      { label: "锁定/解锁", onClick: () => { toggleLock(nodes[0]); closeMenu(); } },
      { label: "隐藏/显示", onClick: () => { toggleHide(nodes[0]); closeMenu(); } },
    ]);
    menuEl.appendChild(layerItem);
  }
}

/** 连线右键：线型/粗细 */
function appendEdgeItems(menuEl: HTMLElement, edge: any, closeMenu: () => void) {
  // 连线样式（线型/粗细）
  const lineItem = createItem("连线样式", "spline", () => {}, true);
  const sub = createSubmenu(lineItem, [
    { label: "实线", onClick: () => { setEdgeStyle(edge, "solid"); closeMenu(); } },
    { label: "虚线", onClick: () => { setEdgeStyle(edge, "dashed"); closeMenu(); } },
    { label: "点线", onClick: () => { setEdgeStyle(edge, "dotted"); closeMenu(); } },
    { label: "细", onClick: () => { setEdgeWeight(edge, 1); closeMenu(); } },
    { label: "中", onClick: () => { setEdgeWeight(edge, 2); closeMenu(); } },
    { label: "粗", onClick: () => { setEdgeWeight(edge, 3); closeMenu(); } },
  ]);
  menuEl.appendChild(lineItem);

  // 箭头方向
  const curMode = getEdgeArrowMode(edge);
  const arrowItem = createItem("箭头方向", "spline", () => {}, true);
  const arrowSub = createSubmenu(arrowItem, [
    { label: curMode === "forward" ? "✓ 终点箭头" : "终点箭头", onClick: () => { setEdgeArrow(edge, "forward"); closeMenu(); } },
    { label: curMode === "backward" ? "✓ 起点箭头" : "起点箭头", onClick: () => { setEdgeArrow(edge, "backward"); closeMenu(); } },
    { label: curMode === "both" ? "✓ 双向箭头" : "双向箭头", onClick: () => { setEdgeArrow(edge, "both"); closeMenu(); } },
    { label: curMode === "none" ? "✓ 无箭头" : "无箭头", onClick: () => { setEdgeArrow(edge, "none"); closeMenu(); } },
  ]);
  menuEl.appendChild(arrowItem);

  // 颜色
  const colorItem = createItem("连线颜色", "palette", () => {}, true);
  const colorSub = createSubmenu(colorItem, [
    { label: "🔴 红", onClick: () => { setEdgeColor(edge, "1"); closeMenu(); } },
    { label: "🟠 橙", onClick: () => { setEdgeColor(edge, "2"); closeMenu(); } },
    { label: "🟢 绿", onClick: () => { setEdgeColor(edge, "4"); closeMenu(); } },
    { label: "🔵 青", onClick: () => { setEdgeColor(edge, "5"); closeMenu(); } },
    { label: "🟣 紫", onClick: () => { setEdgeColor(edge, "6"); closeMenu(); } },
    { label: "默认色", onClick: () => { setEdgeColor(edge, ""); closeMenu(); } },
  ]);
  menuEl.appendChild(colorItem);

  // 标签
  const labelItem = createItem("编辑标签", "spline", () => {
    const cur = edge.getData()?.label ?? "";
    const text = window.prompt("连线标签", cur);
    if (text !== null) setEdgeLabel(edge, text);
    closeMenu();
  });
  menuEl.appendChild(labelItem);
}

/**
 * 给一个菜单项挂子菜单（hover 显示，延时关闭）
 * 关键修复：mouseleave 后延时 250ms 关闭，给鼠标移动留缓冲
 */
function createSubmenu(parentItem: HTMLElement, items: Array<{ label: string; onClick: () => void }>): HTMLElement {
  const sub = document.createElement("div");
  sub.className = "cp-menu-submenu";
  sub.style.position = "fixed";
  sub.style.display = "none";
  sub.style.zIndex = "1000";

  for (const it of items) {
    const el = createItem(it.label, "", it.onClick);
    sub.appendChild(el);
  }
  document.body.appendChild(sub);

  let hideTimer: number | null = null;
  const showSub = () => {
    if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
    const rect = parentItem.getBoundingClientRect();
    sub.style.display = "block";
    // 智能定位：默认在右侧，如果右边不够放则放左侧
    const subRect = sub.getBoundingClientRect();
    let left = rect.right;
    if (left + subRect.width > window.innerWidth - 8) {
      left = rect.left - subRect.width;
    }
    sub.style.left = `${Math.max(8, left)}px`;
    sub.style.top = `${Math.min(rect.top, window.innerHeight - subRect.height - 8)}px`;
  };
  const hideSub = () => {
    hideTimer = window.setTimeout(() => { sub.style.display = "none"; }, 250);
  };

  parentItem.addEventListener("mouseenter", showSub);
  parentItem.addEventListener("mouseleave", hideSub);
  sub.addEventListener("mouseenter", showSub);
  sub.addEventListener("mouseleave", hideSub);

  return sub;
}
