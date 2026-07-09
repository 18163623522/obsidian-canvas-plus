/**
 * 倒计时 / 计时器伪节点（真正的交互组件）
 *
 * 原理：在 text 节点里写标记 `%%cp:countdown:2026-12-31T00:00:00%%`
 * 或 `%%cp:timer%%`（秒表）。轮询所有节点，给带标记的节点：
 *   - 隐藏原始文本
 *   - 在 contentEl 里渲染一个实时更新的倒计时/计时器 DOM
 *
 * 数据存进 nodeData.text（HTML 注释格式 %%...%% 在阅读视图不显示），
 * 持久化可靠，重开自动恢复渲染。
 */
import { App, Plugin, Notice } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { createTextViaData } from "./canvas-access";

const COUNTDOWN_RE = /%%cp:countdown:([^%]+)%%/;
const TIMER_RE = /%%cp:timer%%/;
const rendered = new WeakSet<HTMLElement>();
const timers = new Set<number>();

export function setupTimerNodes(plugin: Plugin): () => void {
  const apply = () => renderTimers(plugin.app);
  const timer = setInterval(apply, 1000);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    timers.forEach((t) => clearInterval(t));
    timers.clear();
  };
}

function renderTimers(app: App) {
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (!leaves.length) return;
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas?.nodes) return;
  for (const node of canvas.nodes.values()) {
    renderOne(node);
  }
}

function renderOne(node: CanvasNode) {
  const data = node.getData() as any;
  const text: string = data?.text ?? "";
  const contentEl = (node as any).contentEl as HTMLElement | undefined;
  // 调试：若节点文本含标记，打印状态
  if ((COUNTDOWN_RE.test(text) || TIMER_RE.test(text))) {
    console.log("[cp-timer] renderOne check:", {
      nodeId: data?.id,
      type: data?.type,
      hasText: !!text,
      textPreview: text.slice(0, 60),
      isCountdown: COUNTDOWN_RE.test(text),
      isTimer: TIMER_RE.test(text),
      hasContentEl: !!contentEl,
      contentElChildren: contentEl?.children?.length,
    });
  }
  if (!data || data.type !== "text") return;
  if (!contentEl) return;

  const cdMatch = text.match(COUNTDOWN_RE);
  const isTimer = TIMER_RE.test(text);

  if (!cdMatch && !isTimer) return;

  // 清理旧渲染（若文本变了，重建）
  const existing = contentEl.querySelector(".cp-timer-widget");
  if (existing) {
    // 若已渲染且标记没变，跳过
    if (rendered.has(contentEl) && existing.getAttribute("data-key") === text) return;
    existing.remove();
  }
  rendered.add(contentEl);

  const widget = contentEl.createDiv({ cls: "cp-timer-widget" });
  widget.setAttribute("data-key", text);
  const label = widget.createDiv({ cls: "cp-timer-label" });
  const value = widget.createDiv({ cls: "cp-timer-value" });

  if (cdMatch) {
    const target = new Date(cdMatch[1].trim());
    label.textContent = "倒计时";
    const update = () => {
      const now = Date.now();
      const diff = target.getTime() - now;
      if (diff <= 0) {
        value.textContent = "已到期";
        value.classList.add("cp-timer-done");
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      value.textContent =
        days > 0
          ? `${days}天 ${hours}时 ${mins}分 ${secs}秒`
          : `${hours}时 ${mins}分 ${secs}秒`;
    };
    update();
    const t = window.setInterval(update, 1000);
    timers.add(t);
  } else if (isTimer) {
    label.textContent = "秒表";
    let elapsed = 0;
    let running = false;
    let startTs = 0;
    value.textContent = "00:00.0";
    const btns = widget.createDiv({ cls: "cp-timer-btns" });
    const toggleBtn = btns.createEl("button", { cls: "cp-timer-toggle" });
    toggleBtn.textContent = "开始";
    const resetBtn = btns.createEl("button", { cls: "cp-timer-reset" });
    resetBtn.textContent = "重置";
    const fmt = (ms: number) => {
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const d = Math.floor((ms % 1000) / 100);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
    };
    const tick = window.setInterval(() => {
      if (running) {
        elapsed = Date.now() - startTs;
        value.textContent = fmt(elapsed);
      }
    }, 100);
    timers.add(tick);
    toggleBtn.onclick = () => {
      running = !running;
      if (running) {
        startTs = Date.now() - elapsed;
        toggleBtn.textContent = "暂停";
      } else {
        toggleBtn.textContent = "继续";
      }
    };
    resetBtn.onclick = () => {
      running = false;
      elapsed = 0;
      value.textContent = "00:00.0";
      toggleBtn.textContent = "开始";
    };
  }
}

/** 创建一个倒计时节点（数据快照模式） */
export function createCountdownNode(canvas: Canvas, isoDate: string, title?: string): void {
  const c = canvas.posCenter?.() ?? { x: 0, y: 0 };
  const text = (title ? title + "\n" : "") + `%%cp:countdown:${isoDate}%%`;
  createTextViaData(canvas, {
    x: c.x - 120,
    y: c.y - 50,
    text,
    width: 240,
    height: 100,
  });
  // 延迟渲染（等 DOM 就绪）
  setTimeout(() => renderAll(canvas), 200);
  setTimeout(() => renderAll(canvas), 1000);
  new Notice("已插入倒计时节点");
}

/** 渲染所有节点的计时器（遍历版，给 createXxx 用） */
function renderAll(canvas: Canvas) {
  if (!canvas?.nodes) return;
  for (const node of canvas.nodes.values()) {
    renderOne(node);
  }
}

/** 诊断：遍历所有节点，打印结构，并强制渲染一次 */
export function diagnoseTimers(canvas: Canvas): void {
  console.log("[cp-timer] ===== diagnoseTimers start =====");
  let count = 0;
  for (const node of canvas.nodes.values() as IterableIterator<CanvasNode>) {
    count++;
    const data = node.getData() as any;
    const text = data?.text ?? "";
    console.log(`[cp-timer] node #${count}:`, {
      id: data?.id,
      type: data?.type,
      text: text.slice(0, 80),
      hasCountdown: COUNTDOWN_RE.test(text),
      hasTimer: TIMER_RE.test(text),
      hasContentEl: !!(node as any).contentEl,
      hasNodeEl: !!(node as any).nodeEl,
      keys: Object.keys(node),
    });
    // 强制尝试渲染
    renderOne(node);
  }
  console.log(`[cp-timer] ===== diagnoseTimers end: ${count} nodes scanned =====`);
}

/** 创建一个秒表节点（数据快照模式） */
export function createStopwatchNode(canvas: Canvas): void {
  const c = canvas.posCenter?.() ?? { x: 0, y: 0 };
  createTextViaData(canvas, {
    x: c.x - 120,
    y: c.y - 50,
    text: "%%cp:timer%%",
    width: 240,
    height: 140,
  });
  setTimeout(() => renderAll(canvas), 200);
  setTimeout(() => renderAll(canvas), 1000);
  new Notice("已插入秒表节点");
}
