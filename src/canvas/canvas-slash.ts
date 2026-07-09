/**
 * 白板内 Slash 菜单（input 事件版，更稳定）
 *
 * 原理：轮询 Canvas 节点的 child.editMode.cm，给每个 CM6 实例的 dom
 * 挂 input 事件监听。检测到行首 / 时弹出浮动面板。
 * 方向键/回车/ESC 用全局 keydown 监听处理（仅在弹窗打开时）。
 */
import type { Plugin } from "obsidian";
import { getSlashCompletions, applyCompletion } from "./slash-completions";

const injected = new WeakSet<any>();
let activePopup: HTMLElement | null = null;
let activeItems: any[] = [];
let activeIndex = 0;
let activeCm: any = null;
let activeSlashFrom = 0;

export function setupCanvasSlash(plugin: Plugin): () => void {
  const uninstallers: Array<() => void> = [];

  const injectOne = (cm: any) => {
    if (!cm || injected.has(cm)) return;
    if (!cm.state || typeof cm.dispatch !== "function") return;
    const dom = cm.dom as HTMLElement;
    if (!dom) return;
    injected.add(cm);

    // 用 input 事件检测文本变化（比 keydown 更可靠）
    const onInput = () => checkSlash(cm);
    dom.addEventListener("input", onInput, false);
    // 失焦时关闭
    dom.addEventListener("blur", () => setTimeout(closePopup, 200), false);
  };

  // 全局 keydown 处理弹窗导航（仅在弹窗打开时）
  const onGlobalKeydown = (e: KeyboardEvent) => {
    if (!activePopup) return;
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); selectItem(activeIndex + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); selectItem(activeIndex - 1); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); confirmItem(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePopup(); }
  };
  document.addEventListener("keydown", onGlobalKeydown, true);
  uninstallers.push(() => document.removeEventListener("keydown", onGlobalKeydown, true));

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (!leaves.length) return;
    const canvas = (leaves[0] as any).view?.canvas;
    if (!canvas?.nodes) return;
    for (const node of canvas.nodes.values()) {
      const cm = node?.child?.editMode?.cm;
      if (cm) injectOne(cm);
    }
  };

  const timer = setInterval(attach, 300);
  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  // 点击外面关闭
  const onDocClick = (e: MouseEvent) => {
    if (activePopup && !activePopup.contains(e.target as Node)) closePopup();
  };
  document.addEventListener("click", onDocClick, true);
  uninstallers.push(() => document.removeEventListener("click", onDocClick, true));

  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    uninstallers.forEach((u) => u());
  };
}

/** 检查光标前是否有 / 触发 */
function checkSlash(cm: any) {
  const pos = cm.state.selection.main.head;
  const line = cm.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  // 行首或空格后的 /
  const m = before.match(/(?:^|\s)\/([\w\u4e00-\u9fa5]*)$/);
  if (!m) {
    if (activePopup) closePopup();
    return;
  }
  const query = m[1].toLowerCase();
  const slashPos = pos - m[0].length + (m[0].startsWith("/") ? 0 : 1);
  activeCm = cm;
  activeSlashFrom = slashPos;
  activeItems = getSlashCompletions(query);
  activeIndex = 0;
  if (activeItems.length === 0) {
    closePopup();
    return;
  }
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
  const pos = cm.state.selection.main.head;
  const coords = cm.coordsAtPos?.(pos);
  if (!coords) return;
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
