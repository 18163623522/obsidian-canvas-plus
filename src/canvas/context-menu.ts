/**
 * 白板右键菜单（DOM 追加方案，零冲突）
 *
 * 监听 canvas.wrapperEl 的 contextmenu 事件。
 * 等原生菜单（.menu）出现后，往它的 DOM 里追加我们的菜单项。
 * 不修改 Obsidian Menu 对象，不 patch render，最稳定。
 */
import { Plugin } from "obsidian";
import { createTextViaData } from "./canvas-access";
import { setShape, setSticky, togglePlain, setEdgeStyle, setEdgeWeight } from "./node-styles";

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
  // 精确匹配原生菜单：class="menu" 且不是我们的 cp-submenu
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

  const sel = canvas.selection;
  const selArr = Array.from(sel?.values?.() ?? []);
  const nodes = selArr.filter((el: any) => el?.nodeEl || ["text","file","link","group"].includes(el?.getData?.()?.type));
  const edges = selArr.filter((el: any) => el?.path || el?.line || el?.getData?.()?.fromNode);
  const c = canvas.posCenter?.() ?? canvas.pointer ?? { x: 0, y: 0 };

  // 追加分隔线
  menuEl.appendChild(createDivider());

  if (edges.length > 0 && nodes.length === 0) {
    appendEdgeItems(menuEl, edges[0]);
  } else if (nodes.length > 0) {
    appendNodeItems(menuEl, nodes);
  } else {
    appendBlankItems(menuEl, canvas, c, plugin);
  }
}

// ============================================================
//  DOM 菜单项构造（模仿 Obsidian 的 .menu-item 结构）
// ============================================================
function createDivider(): HTMLElement {
  const d = document.createElement("div");
  d.className = "menu-separator";
  return d;
}

function createItem(label: string, icon: string, onClick: () => void, hasSubmenu = false): HTMLElement {
  const item = document.createElement("div");
  item.className = "menu-item";
  item.setAttribute("role", "menuitem");
  item.setAttribute("tabindex", "0");

  const iconEl = document.createElement("div");
  iconEl.className = "menu-item-icon";
  iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
  if (icon === "plus") iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;
  if (icon === "layout") iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`;
  if (icon === "palette") iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
  if (icon === "spline") iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12 Q 12 3 21 12"/></svg>`;

  const labelEl = document.createElement("div");
  labelEl.className = "menu-item-label";
  labelEl.textContent = label;

  item.appendChild(iconEl);
  item.appendChild(labelEl);

  if (hasSubmenu) {
    const arrow = document.createElement("div");
    arrow.className = "menu-item-arrow";
    arrow.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
    item.appendChild(arrow);
  }

  item.addEventListener("click", onClick);
  return item;
}

/** 空白处：插入节点 + 布局 */
function appendBlankItems(menuEl: HTMLElement, canvas: any, c: { x: number; y: number }, plugin: Plugin) {
  // 插入节点（带子菜单）
  const insertItem = createItem("插入节点", "plus", () => {}, true);
  const sub = createSubmenu(insertItem, [
    { label: "文本节点", onClick: () => createTextViaData(canvas, { x: c.x, y: c.y, text: "", width: 250, height: 100 }) },
    { label: "纯文字（无边框）", onClick: () => { const id = createTextViaData(canvas, { x: c.x, y: c.y, text: "", width: 250, height: 60 }); togglePlain(canvas.nodes.get(id)); } },
    { label: "便签（黄）", onClick: () => { const id = createTextViaData(canvas, { x: c.x, y: c.y, text: "", width: 200, height: 200 }); setSticky(canvas.nodes.get(id), "yellow"); } },
    { label: "代码节点", onClick: () => createTextViaData(canvas, { x: c.x - 175, y: c.y - 90, text: "```js\n\n```", width: 350, height: 200 }) },
    { label: "公式节点", onClick: () => createTextViaData(canvas, { x: c.x - 125, y: c.y - 50, text: "$$\nE = mc^2\n$$", width: 250, height: 120 }) },
    { label: "Mermaid 流程图", onClick: () => createTextViaData(canvas, { x: c.x - 200, y: c.y - 100, text: "```mermaid\ngraph TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n```", width: 400, height: 300 }) },
    { label: "表格", onClick: () => createTextViaData(canvas, { x: c.x - 175, y: c.y - 90, text: "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |", width: 350, height: 200 }) },
    { label: "倒计时", onClick: () => { const t = window.prompt("目标时间（2026-12-31T23:59:59）", "2026-12-31T23:59:59"); if (t) { const d = new Date(t); if (!isNaN(d.getTime())) createTextViaData(canvas, { x: c.x - 120, y: c.y - 50, text: `%%cp:countdown:${d.toISOString()}%%`, width: 240, height: 100 }); } } },
    { label: "秒表", onClick: () => createTextViaData(canvas, { x: c.x - 120, y: c.y - 50, text: "%%cp:timer%%", width: 240, height: 140 }) },
    { label: "图片/PDF/视频...", onClick: async () => { const m = await import("./quick-insert"); m.insertFileNode(canvas, plugin.app); } },
  ]);
  menuEl.appendChild(insertItem);

  // 自动布局
  const layoutItem = createItem("自动布局", "layout", () => {}, true);
  const sub2 = createSubmenu(layoutItem, [
    { label: "力导向", onClick: async () => { const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "force" }); } },
    { label: "树形", onClick: async () => { const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "tree" }); } },
    { label: "放射", onClick: async () => { const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "radial" }); } },
    { label: "流程图", onClick: async () => { const m = await import("./layout"); m.applyLayout(canvas, Array.from(canvas.nodes.values()), canvas.getData().edges, { type: "dag" }); } },
  ]);
  menuEl.appendChild(layoutItem);
}

/** 节点右键：样式 */
function appendNodeItems(menuEl: HTMLElement, nodes: any[]) {
  const styleItem = createItem("节点样式", "palette", () => {}, true);
  const sub = createSubmenu(styleItem, [
    { label: "切换纯文字/卡片", onClick: () => nodes.forEach((n) => togglePlain(n)) },
    { label: "转便签（黄）", onClick: () => nodes.forEach((n) => setSticky(n, "yellow")) },
    { label: "圆角", onClick: () => nodes.forEach((n) => setShape(n, "rounded")) },
    { label: "椭圆", onClick: () => nodes.forEach((n) => setShape(n, "ellipse")) },
    { label: "菱形", onClick: () => nodes.forEach((n) => setShape(n, "diamond")) },
    { label: "默认矩形", onClick: () => nodes.forEach((n) => setShape(n, undefined)) },
  ]);
  menuEl.appendChild(styleItem);
}

/** 连线右键：线型/粗细 */
function appendEdgeItems(menuEl: HTMLElement, edge: any) {
  const lineItem = createItem("连线样式", "spline", () => {}, true);
  const sub = createSubmenu(lineItem, [
    { label: "实线", onClick: () => setEdgeStyle(edge, "solid") },
    { label: "虚线", onClick: () => setEdgeStyle(edge, "dashed") },
    { label: "点线", onClick: () => setEdgeStyle(edge, "dotted") },
    { label: "细", onClick: () => setEdgeWeight(edge, 1) },
    { label: "中", onClick: () => setEdgeWeight(edge, 2) },
    { label: "粗", onClick: () => setEdgeWeight(edge, 3) },
  ]);
  menuEl.appendChild(lineItem);
}

/** 给一个菜单项挂子菜单（hover 显示） */
function createSubmenu(parentItem: HTMLElement, items: Array<{ label: string; onClick: () => void }>): HTMLElement {
  const sub = document.createElement("div");
  sub.className = "cp-menu-submenu";  // 不用 "menu" 避免 .menu 选择器误匹配
  sub.style.position = "fixed";
  sub.style.display = "none";
  sub.style.zIndex = "1000";
  for (const it of items) {
    const el = createItem(it.label, "", it.onClick);
    sub.appendChild(el);
  }
  document.body.appendChild(sub);

  parentItem.addEventListener("mouseenter", () => {
    const rect = parentItem.getBoundingClientRect();
    sub.style.display = "block";
    sub.style.left = `${rect.right}px`;
    sub.style.top = `${rect.top}px`;
  });
  parentItem.addEventListener("mouseleave", (e) => {
    // 如果鼠标移到了子菜单，不关
    const related = e.relatedTarget as Node | null;
    if (related && sub.contains(related)) return;
    sub.style.display = "none";
  });
  sub.addEventListener("mouseleave", () => { sub.style.display = "none"; });

  // 点击后移除（菜单关闭时清理）
  items.forEach((it) => {
    const orig = it.onClick;
    it.onClick = () => { orig(); sub.remove(); };
  });
  return sub;
}
