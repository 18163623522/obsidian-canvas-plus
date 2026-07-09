/**
 * 白板右键菜单（DOM 追加方案，零冲突）
 *
 * 监听 canvas.wrapperEl 的 contextmenu 事件。
 * 等原生菜单出现后，往它的 DOM 里追加我们的菜单项。
 * 子菜单用延时关闭，hover 顺畅。
 */
import { Plugin, Menu } from "obsidian";
import { createTextViaData } from "./canvas-access";
import { setShape, setSticky, togglePlain, setEdgeStyle, setEdgeWeight } from "./node-styles";
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

/** 找到原生菜单 DOM，往里追加我们的项 */
function appendToNativeMenu(canvas: any, plugin: Plugin) {
  const menus = Array.from(document.querySelectorAll(".menu"));
  let menuEl: HTMLElement | null = null;
  for (const m of menus) {
    const el = m as HTMLElement;
    if (!el.classList.contains("cp-submenu") && el.children.length > 0 && !el.classList.contains("is-cp-added")) {
      menuEl = el;
      break;
    }
  }
  if (!menuEl) return;
  menuEl.classList.add("is-cp-added");

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

/** 节点右键：样式 + 展开链接 + 分组 */
function appendNodeItems(menuEl: HTMLElement, nodes: any[], closeMenu: () => void, canvas: any, plugin: Plugin) {
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
