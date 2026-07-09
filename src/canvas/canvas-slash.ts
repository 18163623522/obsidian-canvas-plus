/**
 * 白板内 Slash 菜单（DOM 弹窗版）
 *
 * 原理：轮询 Canvas 节点的 child.editMode.cm，给每个 CM6 实例挂一个
 * keydown 监听器。检测到行首 `/` 输入时，弹出浮动面板，方向键选、回车确认。
 *
 * 不依赖 EditorSuggest（那只对 MarkdownView 生效），
 * 不依赖 autocompletion 扩展（需要 view 用 Compartment 构造）。
 * 直接操作 DOM + CM6 dispatch，最可靠。
 */
import type { App, Plugin } from "obsidian";
import { getSlashCompletions, applyCompletion, SlashCompletion } from "./slash-completions";

// 注：App 暂未在本文件直接使用，但保留以匹配模块签名（applyCompletion 需要）

const injected = new WeakSet<any>();
let activePopup: HTMLElement | null = null;
let activeItems: SlashCompletion[] = [];
let activeIndex = 0;
let activeCm: any = null;
let activeSlashFrom = 0;

export function setupCanvasSlash(plugin: Plugin): () => void {
  const uninstallers: Array<() => void> = [];
  let attached = false;

  const injectOne = (cm: any) => {
    if (!cm || injected.has(cm)) return;
    if (!cm.state || typeof cm.dispatch !== "function") return;
    const dom = cm.dom as HTMLElement;
    if (!dom) return;
    injected.add(cm);

    const onKeydown = (e: KeyboardEvent) => handleKeydown(e, cm);
    dom.addEventListener("keydown", onKeydown, true);
    // 记录以便卸载
    (cm as any).__cpSlashHandler = onKeydown;
  };

  const attach = () => {
    if (attached) return;
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (leaves.length === 0) return;
    attached = true;

    const timer = setInterval(() => {
      const leaves2 = plugin.app.workspace.getLeavesOfType("canvas");
      if (!leaves2.length) return;
      const canvas = (leaves2[0] as any).view?.canvas;
      if (!canvas?.nodes) return;
      for (const node of canvas.nodes.values()) {
        const cm = node?.child?.editMode?.cm;
        if (cm) injectOne(cm);
      }
    }, 500);
    uninstallers.push(() => clearInterval(timer));

    // 点外面关闭弹窗
    const onDocClick = (e: MouseEvent) => {
      if (activePopup && !activePopup.contains(e.target as Node)) closePopup();
    };
    document.addEventListener("click", onDocClick);
    uninstallers.push(() => document.removeEventListener("click", onDocClick));

    console.log("[canvas-plus] canvas slash (DOM mode) attached");
  };

  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    uninstallers.forEach((u) => u());
    plugin.app.workspace.offref(layoutRef);
  };
}

function handleKeydown(e: KeyboardEvent, cm: any) {
  // 弹窗打开时，方向键/回车/ESC 由弹窗处理
  if (activePopup) {
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); selectItem(activeIndex + 1); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); e.stopPropagation(); selectItem(activeIndex - 1); return; }
    if (e.key === "Enter")     { e.preventDefault(); e.stopPropagation(); confirmItem(); return; }
    if (e.key === "Escape")    { e.preventDefault(); e.stopPropagation(); closePopup(); return; }
  }

  // 检测 / 输入或后续字符
  const pos = cm.state.selection.main.head;
  const line = cm.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  // 输入 / 时（行首或空格后）
  if (e.key === "/" && (before === "" || /\s$/.test(before))) {
    // 等 / 实际插入后再弹
    setTimeout(() => maybeOpenPopup(cm, pos + 1), 0);
    return;
  }

  // 弹窗已开，继续输入过滤
  if (activePopup && /^[a-zA-Z0-9\u4e00-\u9fa5]$/.test(e.key)) {
    setTimeout(() => updatePopupFilter(cm), 0);
  }
  // 退格可能改变 query
  if (activePopup && e.key === "Backspace") {
    setTimeout(() => updatePopupFilter(cm), 0);
  }
}

function maybeOpenPopup(cm: any, slashPos: number) {
  activeCm = cm;
  activeSlashFrom = slashPos - 1; // / 的位置
  activeItems = getSlashCompletions("");
  activeIndex = 0;
  renderPopup(cm);
}

function updatePopupFilter(cm: any) {
  const pos = cm.state.selection.main.head;
  const line = cm.state.doc.lineAt(pos);
  const text = line.text.slice(activeSlashFrom - line.from, pos - line.from);
  // 如果 / 已被删或前面不再是 /，关闭
  if (!text.startsWith("/")) { closePopup(); return; }
  const query = text.slice(1);
  activeItems = getSlashCompletions(query);
  activeIndex = 0;
  if (activeItems.length === 0) { closePopup(); return; }
  renderPopup(cm);
}

function renderPopup(cm: any) {
  closePopup();
  const popup = document.body.createDiv({ cls: "cp-slash-popup" });
  activePopup = popup;
  for (let i = 0; i < activeItems.length; i++) {
    const item = activeItems[i];
    const row = popup.createDiv({ cls: "cp-slash-item" + (i === activeIndex ? " is-active" : "") });
    row.createSpan({ cls: "cp-slash-icon", text: item.icon });
    row.createSpan({ cls: "cp-slash-label", text: item.label });
    row.createSpan({ cls: "cp-slash-group", text: item.group });
    const idx = i;
    row.onmouseenter = () => selectItem(idx);
    row.onclick = () => { activeIndex = idx; confirmItem(); };
  }
  positionPopup(cm);
}

function positionPopup(cm: any) {
  if (!activePopup) return;
  // 用光标处的屏幕坐标（CM6 提供 coordsAtPos）
  const pos = cm.state.selection.main.head;
  const coords = cm.coordsAtPos?.(pos);
  if (!coords) return;
  const rect = activePopup.getBoundingClientRect();
  activePopup.style.left = `${coords.left}px`;
  activePopup.style.top = `${coords.bottom + 4}px`;
}

function selectItem(i: number) {
  if (!activePopup) return;
  activeIndex = (i + activeItems.length) % activeItems.length;
  activePopup.querySelectorAll(".cp-slash-item").forEach((el, idx) => {
    el.classList.toggle("is-active", idx === activeIndex);
  });
}

function confirmItem() {
  const item = activeItems[activeIndex];
  if (!item || !activeCm) return;
  // 删除 / 及后续 query
  const pos = activeCm.state.selection.main.head;
  activeCm.dispatch({ changes: { from: activeSlashFrom, to: pos, insert: "" } });
  closePopup();
  applyCompletion(item, activeCm, null as any);
  activeCm.focus();
}

function closePopup() {
  activePopup?.remove();
  activePopup = null;
  activeItems = [];
  activeIndex = 0;
}
