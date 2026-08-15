/**
 * Mindo Canvas 整合模块（从 obsidian-mindo-canvas v0.5.0 合并）
 *
 * 提供 Mindo 式思维导图工作流：
 *  - 添加子节点 / 添加兄弟节点（"# 新节点\n\n" 标题+正文卡片，自动连线）
 *  - 思维导图自动布局（Reingold-Tilford tidy tree，根居中、分支分左右）
 *  - Mindo 卡片样式（styleAttributes.mindo + DOM data-mindo，色带卡片皮肤）
 *  - 节点转笔记（text 节点内容存为 .md 并替换为 file 节点）
 *  - 官方 canvas:node-menu / canvas:selection-menu 右键菜单项
 *  - patch 节点创建：原生新建的 text 节点自动套 Mindo 样式（可选）
 *
 * 整合说明：原 mindo-canvas 插件与本插件（canvas-plus）功能高度相关且互相
 * 冲突（全量 setData 会抹掉 data-mindo 导致卡片皮肤消失），合并后用户可
 * 停用 mindo-canvas 插件，所有功能保留在此。
 *
 * 皮肤自愈：任何路径导致节点 DOM 重建后，node-styles 轮询器会按数据回填
 * data-mindo；本模块在全量 setData 后也会立即回填一次（不等轮询）。
 */
import { App, Notice, Plugin, setTooltip } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { genId } from "./canvas-access";

// ============== 常量 ==============

const DEFAULT_NODE_SIZE = { width: 250, height: 120 };
const DEFAULT_GAP_X = 350; // 父子水平间距
const DEFAULT_GAP_Y = 160; // 兄弟垂直间距（findSiblingSlot 用 40，这里保留原值语义）

export interface MindoOptions {
  /** 新建节点默认颜色（色板索引 "1"-"6"，空串用白板默认） */
  defaultNodeColor: string;
  /** 新建节点是否自动套 Mindo 卡片样式 */
  markNewNodes: boolean;
  /** 自动布局：父子水平间距 */
  layoutLevelGapX: number;
  /** 自动布局：同层垂直间距 */
  layoutSiblingGapY: number;
}

// ============== 连线 ==============

/**
 * 在两节点间创建连线。白板没有公开的 createEdge，通过
 * getData→append edge→setData 写回（随后立即回填 data-mindo，
 * 因为全量 setData 会重建节点 DOM）。
 */
export function connectEdge(
  canvas: Canvas,
  fromId: string,
  toId: string,
  fromSide: "left" | "right" | "top" | "bottom" = "right",
  toSide: "left" | "right" | "top" | "bottom" = "left",
  label?: string
): void {
  const data = canvas.getData();
  const edge: any = {
    id: genId(),
    fromNode: fromId,
    fromSide,
    toNode: toId,
    toSide,
    ...(label ? { label } : {}),
  };
  data.edges = [...(data.edges || []), edge];
  canvas.setData(data);
  (canvas as any).pushHistory?.(data);
  resyncMindoDatasets(canvas);
}

// ============== Mindo 标记 ==============

/** 把节点标记为 Mindo 卡片（写数据 + 写 DOM dataset） */
export function markMindo(canvas: Canvas, nodeIds: string[], value: string = "card"): void {
  for (const id of nodeIds) {
    const node = canvas.nodes.get(id);
    if (!node) continue;
    const data = node.getData();
    const newStyleAttrs = { ...(data as any).styleAttributes || {}, mindo: value };
    (node as any).setData?.({ ...data, styleAttributes: newStyleAttrs } as any);
    syncNodeDataset(node, "mindo", value);
  }
  canvas.requestSave();
}

export function unmarkMindo(canvas: Canvas, nodeIds: string[]): void {
  for (const id of nodeIds) {
    const node = canvas.nodes.get(id);
    if (!node) continue;
    const data = node.getData();
    const newStyleAttrs = { ...(data as any).styleAttributes || {} };
    delete newStyleAttrs.mindo;
    (node as any).setData?.({ ...data, styleAttributes: newStyleAttrs } as any);
    syncNodeDataset(node, "mindo", null);
  }
  canvas.requestSave();
}

/** 把 styleAttributes 子 key 同步到节点 DOM（原生不自动同步） */
function syncNodeDataset(node: CanvasNode, key: string, value: string | null): void {
  try {
    const el = (node as any).nodeEl as HTMLElement | undefined;
    if (!el) return;
    if (value == null) delete (el.dataset as any)[key];
    else (el.dataset as any)[key] = value;
  } catch {
    // 忽略 DOM 操作失败
  }
}

/** 全量 setData 重建 DOM 后，按数据回填所有节点的 data-mindo */
export function resyncMindoDatasets(canvas: Canvas): void {
  try {
    for (const node of canvas.nodes.values()) {
      const mindo = (node.getData() as any)?.styleAttributes?.mindo;
      syncNodeDataset(node, "mindo", mindo ?? null);
    }
  } catch {
    // 忽略
  }
}

// ============== 从连线推断父子树 ==============

export interface TreeNode {
  id: string;
  parentId: string | null;
}

/** 从 rootId 出发沿连线 BFS 收集子树（fromNode=父，toNode=子），防环 */
export function buildChildTree(
  canvas: Canvas,
  rootId: string
): { nodes: TreeNode[]; parentOf: Map<string, string | null> } {
  const data = canvas.getData();
  const nodes: TreeNode[] = [];
  const parentOf = new Map<string, string | null>();
  const visited = new Set<string>();

  const childrenOf = new Map<string, string[]>();
  for (const edge of data.edges || []) {
    const arr = childrenOf.get(edge.fromNode) || [];
    arr.push(edge.toNode);
    childrenOf.set(edge.fromNode, arr);
  }

  const queue: Array<{ id: string; parentId: string | null }> = [{ id: rootId, parentId: null }];
  while (queue.length > 0) {
    const { id, parentId } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    nodes.push({ id, parentId });
    parentOf.set(id, parentId);
    for (const childId of childrenOf.get(id) || []) {
      if (!visited.has(childId)) queue.push({ id: childId, parentId: id });
    }
  }
  return { nodes, parentOf };
}

export function findParentId(canvas: Canvas, nodeId: string): string | null {
  const data = canvas.getData();
  for (const edge of data.edges || []) {
    if (edge.toNode === nodeId) return edge.fromNode;
  }
  return null;
}

function findChildrenIds(canvas: Canvas, nodeId: string): string[] {
  const data = canvas.getData();
  const children: string[] = [];
  for (const edge of data.edges || []) {
    if (edge.fromNode === nodeId) children.push(edge.toNode);
  }
  return children;
}

/** 父节点右侧空位（避开已有子节点） */
function findChildSlot(canvas: Canvas, parentId: string): { x: number; y: number } {
  const parent = canvas.nodes.get(parentId);
  if (!parent) return { x: 0, y: 0 };
  const pData = parent.getData();
  const existingChildren = findChildrenIds(canvas, parentId);

  let y = pData.y;
  if (existingChildren.length > 0) {
    let maxY = -Infinity;
    for (const cid of existingChildren) {
      const c = canvas.nodes.get(cid);
      if (!c) continue;
      const cd = c.getData();
      maxY = Math.max(maxY, cd.y + cd.height);
    }
    if (maxY > -Infinity) y = maxY + 40;
  }
  return { x: pData.x + pData.width + DEFAULT_GAP_X, y };
}

/** 兄弟节点下方空位 */
function findSiblingSlot(canvas: Canvas, siblingId: string): { x: number; y: number } {
  const sib = canvas.nodes.get(siblingId);
  if (!sib) return { x: 0, y: 0 };
  const sd = sib.getData();
  return { x: sd.x, y: sd.y + sd.height + 40 };
}

// ============== 位置写回 ==============

/** 移动节点到目标位置（setData 全量展开 + markMoved 通知渲染） */
function setNodePosition(canvas: Canvas, nodeId: string, targetX: number, targetY: number): void {
  const node = canvas.nodes.get(nodeId);
  if (!node) return;
  const data = node.getData();
  if (data.x === targetX && data.y === targetY) return;
  (node as any).setData?.({ ...data, x: targetX, y: targetY } as any, false);
  try {
    (canvas as any).markMoved(node);
  } catch {}
}

// ============== 核心命令实现 ==============

export function addChildNode(canvas: Canvas, parent: CanvasNode, opts: MindoOptions): void {
  const slot = findChildSlot(canvas, parent.id);
  const color = opts.defaultNodeColor || undefined;
  const child = (canvas as any).createTextNode({
    pos: { x: slot.x, y: slot.y },
    size: { width: DEFAULT_NODE_SIZE.width, height: DEFAULT_NODE_SIZE.height },
    text: "# 新节点\n\n",
    color,
  });
  if (!child) throw new Error("createTextNode 返回空");

  connectEdge(canvas, parent.id, child.id, "right", "left");

  if (opts.markNewNodes) markMindo(canvas, [child.id]);
  canvas.selectOnly(child);
}

export function addSiblingNode(canvas: Canvas, sibling: CanvasNode, opts: MindoOptions): void {
  const parentId = findParentId(canvas, sibling.id);
  const slot = findSiblingSlot(canvas, sibling.id);
  const color = opts.defaultNodeColor || undefined;
  const node = (canvas as any).createTextNode({
    pos: { x: slot.x, y: slot.y },
    size: { width: DEFAULT_NODE_SIZE.width, height: DEFAULT_NODE_SIZE.height },
    text: "# 新节点\n\n",
    color,
  });
  if (!node) throw new Error("createTextNode 返回空");

  if (parentId) connectEdge(canvas, parentId, node.id, "right", "left");
  if (opts.markNewNodes) markMindo(canvas, [node.id]);
  canvas.selectOnly(node);
  if (!parentId) new Notice("已是根节点，已在旁边新建独立节点");
}

export function autoMindoLayout(canvas: Canvas, rootId: string, opts: MindoOptions): number {
  const { nodes: treeNodes, parentOf } = buildChildTree(canvas, rootId);
  if (treeNodes.length === 0) throw new Error("没有可布局的节点");

  const layoutNodes = treeNodes.map((tn) => {
    const n = canvas.nodes.get(tn.id);
    const d = n ? n.getData() : null;
    return {
      id: tn.id,
      width: d?.width || 250,
      height: d?.height || 120,
      parentId: tn.parentId,
    };
  });

  const positions = layoutMindMap(layoutNodes, rootId, {
    levelGapX: opts.layoutLevelGapX,
    siblingGapY: opts.layoutSiblingGapY,
  });

  // 平移到根节点当前位置附近
  const rootCurrent = canvas.nodes.get(rootId)?.getData();
  const rootLayouted = positions.get(rootId);
  let dx = 0;
  let dy = 0;
  if (rootCurrent && rootLayouted) {
    dx = rootCurrent.x - rootLayouted.x;
    dy = rootCurrent.y - rootLayouted.y;
  }

  for (const [id, pos] of positions) {
    setNodePosition(canvas, id, pos.x + dx, pos.y + dy);
  }

  (canvas as any).pushHistory?.(canvas.getData());
  try {
    (canvas as any).zoomToFit?.();
  } catch {}
  return positions.size;
}

export function toggleMindoStyle(canvas: Canvas, nodeIds: string[]): string {
  const first = canvas.nodes.get(nodeIds[0]);
  const data = first?.getData();
  const cur = (data as any)?.styleAttributes?.mindo;
  // 三态循环：无 → card（标题卡）→ band（无标题色带卡）→ 无
  let next: string | undefined;
  let label: string;
  if (cur === "card") {
    next = "band";
    label = `已切换为无标题卡（${nodeIds.length} 个）`;
  } else if (cur === "band") {
    next = undefined;
    label = "已取消 Mindo 样式";
  } else {
    next = "card";
    label = `已应用标题卡（${nodeIds.length} 个）`;
  }
  if (next) markMindo(canvas, nodeIds, next);
  else unmarkMindo(canvas, nodeIds);
  return label;
}

// ============== 节点转笔记 ==============

export async function convertNodeToNote(
  canvas: Canvas,
  app: App,
  nodeId: string,
  markStyle = true
): Promise<string | null> {
  const node = canvas.nodes.get(nodeId);
  if (!node) return null;
  const data = node.getData();
  if (data.type !== "text") throw new Error("只有文本节点可以转成笔记");
  const text: string = (data as any).text || "";

  // 提取标题作文件名
  let title = "未命名";
  const h1Match = text.match(/^#\s+(.+)$/m);
  if (h1Match) title = h1Match[1].trim();
  else {
    const firstLine = text.split("\n").find((l) => l.trim());
    if (firstLine) title = firstLine.replace(/[#*>`\-\[\]]/g, "").trim().slice(0, 40) || "未命名";
  }
  const safeName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

  const view: any = (canvas as any).view;
  const canvasFile: any = view?.file;
  const folder: string = canvasFile?.parent?.path || "";
  const basePath = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;

  let finalPath = basePath;
  let i = 1;
  while (app.vault.getAbstractFileByPath(finalPath)) {
    finalPath = basePath.replace(/\.md$/, ` ${i}.md`);
    i++;
  }

  await app.vault.create(finalPath, text);

  const fileNode = (canvas as any).createFileNode({
    pos: { x: data.x, y: data.y },
    size: { width: data.width, height: data.height },
    file: finalPath,
    color: (data as any).color,
  });

  if (markStyle && fileNode) {
    try {
      const fData = fileNode.getData();
      const styleAttrs = { ...(fData as any).styleAttributes || {}, mindo: "card" };
      fileNode.setData({ ...fData, styleAttributes: styleAttrs } as any);
      syncNodeDataset(fileNode, "mindo", "card");
    } catch {}
    try {
      canvas.selectOnly(fileNode);
    } catch {}
  }

  try {
    (canvas as any).removeNode?.(node);
  } catch (e) {
    console.warn("[canvas-plus] removeNode 失败", e);
  }
  canvas.requestSave();
  return finalPath;
}

// ============== patch 节点创建：新建 text 节点自动带 Mindo 样式 ==============

export function patchNodeCreation(app: App, shouldMark: () => boolean): () => void {
  let patched = false;
  const cleanups: Array<() => void> = [];

  const markNodeData = (data: any): void => {
    if (!data || data.type !== "text") return;
    if (!data.styleAttributes) data.styleAttributes = {};
    if (data.styleAttributes.mindo) return;
    data.styleAttributes.mindo = "card";
  };

  const doPatch = (): boolean => {
    if (patched) return true;
    try {
      const leaves = (app.workspace as any).getLeavesOfType("canvas");
      if (!leaves || leaves.length === 0) return false;
      const canvas: any = (leaves[0] as any).view?.canvas;
      if (!canvas) return false;
      const proto = canvas.constructor?.prototype;
      if (!proto) return false;

      if (typeof proto.createTextNode === "function") {
        const original = proto.createTextNode;
        proto.createTextNode = function (this: any, ...args: any[]): any {
          const node: any = original.apply(this, args);
          try {
            if (shouldMark() && node) {
              const data = node.getData();
              const styleAttrs = { ...(data as any).styleAttributes || {}, mindo: "card" };
              node.setData({ ...data, styleAttributes: styleAttrs } as any);
              syncNodeDataset(node, "mindo", "card");
            }
          } catch (e) {
            console.warn("[canvas-plus] createTextNode Mindo 标记失败", e);
          }
          return node;
        };
        cleanups.push(() => {
          try {
            proto.createTextNode = original;
          } catch {}
        });
      }

      if (typeof proto.importData === "function") {
        const original = proto.importData;
        proto.importData = function (this: any, data: any, ...rest: any[]): void {
          try {
            if (shouldMark() && data && Array.isArray(data.nodes)) {
              const existingIds = new Set<string>();
              try {
                for (const id of this.nodes.keys()) existingIds.add(id);
              } catch {}
              for (const nodeData of data.nodes) {
                if (nodeData.type === "text" && !existingIds.has(nodeData.id)) {
                  markNodeData(nodeData);
                }
              }
            }
          } catch (e) {
            console.warn("[canvas-plus] importData Mindo 标记失败", e);
          }
          return original.apply(this, [data, ...rest]);
        };
        cleanups.push(() => {
          try {
            proto.importData = original;
          } catch {}
        });
      }

      patched = true;
      return true;
    } catch (e) {
      console.warn("[canvas-plus] Mindo patch 节点创建失败", e);
      return false;
    }
  };

  if (!doPatch()) {
    const ref = (app.workspace as any).on("layout-change", () => {
      if (doPatch()) {
        try {
          (app.workspace as any).offref(ref);
        } catch {}
      }
    });
  }

  return () => cleanups.forEach((fn) => fn());
}

// ============== 右键菜单（官方事件，比 DOM 追加稳定） ==============

/**
 * 通过 canvas:node-menu / canvas:selection-menu 官方事件注入菜单项。
 * 这是 mindo-canvas 验证过的可靠方式（Menu.addItem 走 Obsidian 原生流程）。
 */
export function setupMindoMenu(plugin: Plugin, opts: () => MindoOptions): () => void {
  const workspace: any = plugin.app.workspace;
  const offRefs: any[] = [];
  currentOptions = opts;

  const inject = (menu: any, canvas: Canvas, selectedOverride?: CanvasNode, allOverride?: CanvasNode[]) => {
    const selected = selectedOverride !== undefined ? selectedOverride : getSelectedNode(canvas);
    const allSelected = allOverride || getSelectedNodes(canvas);

    const addItem = (label: string, show: boolean, action: () => void) => {
      if (!show) return;
      menu.addItem((mi: any) => {
        mi.setTitle(label);
        mi.onClick(() => {
          try {
            action();
          } catch (e) {
            console.error("[canvas-plus] Mindo 菜单动作失败", e);
          }
        });
      });
    };

    const hasSel = !!selected;
    addItem("添加子节点", hasSel, () => addChildNodeWrap(canvas, selected!, opts()));
    addItem("添加兄弟节点", hasSel, () => addSiblingNodeWrap(canvas, selected!, opts()));
    addItem("自动布局（思维导图）", hasSel, () => layoutWrap(canvas, selected!.id, opts()));
    addItem("Mindo 卡片样式", allSelected.length > 0, () =>
      toggleMindoStyle(canvas, allSelected.map((n) => n.id))
    );
    addItem("转成笔记", !!(selected && selected.getData()?.type === "text"), async () => {
      const path = await convertNodeToNote(canvas, plugin.app, selected!.id);
      if (path) new Notice(`已转为笔记：${path}`);
    });
  };

  try {
    const ref = workspace.on("canvas:selection-menu", (menu: any, canvas: Canvas) => {
      inject(menu, canvas);
    });
    offRefs.push(ref);
    plugin.register(() => safeOff(workspace, ref));
  } catch (e) {
    console.warn("[canvas-plus] Mindo selection-menu 注册失败", e);
  }

  try {
    // node-menu 第二个参数是 CanvasNode（不是 canvas），从 node.canvas 取白板
    const ref = workspace.on("canvas:node-menu", (menu: any, node: CanvasNode) => {
      const canvas = (node as any).canvas as Canvas;
      if (!canvas) return;
      inject(menu, canvas, node, [node]);
    });
    offRefs.push(ref);
    plugin.register(() => safeOff(workspace, ref));
  } catch (e) {
    console.warn("[canvas-plus] Mindo node-menu 注册失败", e);
  }

  // ─── C) advanced-canvas:popup-menu-created ───
  // 用户装了 advanced-canvas：它的圆形弹出菜单创建后发这个事件，
  // 借此把 Mindo 项也注入弹出菜单（前两个事件覆盖不到的入口）
  try {
    const ref = workspace.on("advanced-canvas:popup-menu-created", (canvas: Canvas) => {
      injectPopupViaAdvancedCanvas(canvas);
    });
    offRefs.push(ref);
    plugin.register(() => safeOff(workspace, ref));
  } catch (e) {
    // 没装 advanced-canvas 时这个事件不存在，监听不会报错但不触发
  }

  return () => offRefs.forEach((r) => safeOff(workspace, r));
}

/** 注入 advanced-canvas 的圆形弹出菜单（canvas.menu.menuEl） */
function injectPopupViaAdvancedCanvas(canvas: Canvas): void {
  // 去重：250ms 内不重复注入
  const now = Date.now();
  if (now - lastPopupInjectTime < 250) return;
  lastPopupInjectTime = now;

  let menuEl: HTMLElement | null = null;
  try {
    menuEl = (canvas as any).menu?.menuEl ?? null;
  } catch {
    return;
  }
  if (!menuEl) return;

  // 清掉上次注入的，避免累积
  menuEl.querySelectorAll(".mindo-popup-item").forEach((el) => el.remove());

  const selected = getSelectedNode(canvas);
  const allSelected = getSelectedNodes(canvas);

  const addBtn = (label: string, show: boolean, action: () => void) => {
    if (!show) return;
    const btn = document.createElement("button");
    btn.className = "clickable-icon mindo-popup-item";
    btn.setAttribute("aria-label", label);
    try {
      setTooltip(btn, label, { placement: "top" } as any);
    } catch {
      btn.title = label;
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        action();
      } catch (err) {
        console.error("[canvas-plus] Mindo 弹出菜单动作失败", err);
      }
    });
    menuEl!.appendChild(btn);
  };

  addBtn("添加子节点", !!selected, () => addChildNodeWrap(canvas, selected!, currentOptions()));
  addBtn("添加兄弟节点", !!selected, () => addSiblingNodeWrap(canvas, selected!, currentOptions()));
  addBtn("自动布局", !!selected, () => layoutWrap(canvas, selected!.id, currentOptions()));
  addBtn("Mindo 卡片样式", allSelected.length > 0, () =>
    toggleMindoStyle(canvas, allSelected.map((n) => n.id))
  );
}

let lastPopupInjectTime = 0;
/** 由 setupMindoMenu 注入的选项读取器（闭包持有最新设置） */
let currentOptions: () => MindoOptions = () => ({
  defaultNodeColor: "1",
  markNewNodes: true,
  layoutLevelGapX: 350,
  layoutSiblingGapY: 40,
});

function safeOff(workspace: any, ref: any): void {
  try {
    workspace.offref(ref);
  } catch {}
}

function getSelectedNode(canvas: Canvas): CanvasNode | null {
  try {
    const sel = (canvas as any).getSelectionData?.();
    if (!sel?.nodes || sel.nodes.length === 0) return null;
    return canvas.nodes.get(sel.nodes[0].id) || null;
  } catch {
    return null;
  }
}

function getSelectedNodes(canvas: Canvas): CanvasNode[] {
  try {
    const sel = (canvas as any).getSelectionData?.();
    return (sel?.nodes ?? [])
      .map((d: any) => canvas.nodes.get(d.id))
      .filter((n: any): n is CanvasNode => !!n);
  } catch {
    return [];
  }
}

function addChildNodeWrap(canvas: Canvas, node: CanvasNode, opts: MindoOptions): void {
  try {
    addChildNode(canvas, node, opts);
    new Notice("已添加子节点");
  } catch (e) {
    new Notice("添加子节点失败：" + (e as Error).message);
  }
}

function addSiblingNodeWrap(canvas: Canvas, node: CanvasNode, opts: MindoOptions): void {
  try {
    addSiblingNode(canvas, node, opts);
    new Notice("已添加兄弟节点");
  } catch (e) {
    new Notice("添加兄弟节点失败：" + (e as Error).message);
  }
}

function layoutWrap(canvas: Canvas, rootId: string, opts: MindoOptions): void {
  try {
    const n = autoMindoLayout(canvas, rootId, opts);
    new Notice(`已整理 ${n} 个节点`);
  } catch (e) {
    new Notice("自动布局失败：" + (e as Error).message);
  }
}

// ============== 思维导图布局算法（移植自 mindo-canvas layout.ts） ==============

export interface MindoLayoutNode {
  id: string;
  width: number;
  height: number;
  parentId: string | null;
}

interface LayoutOptions {
  siblingGapY?: number;
  levelGapX?: number;
}

interface RTNode {
  node: MindoLayoutNode;
  children: RTNode[];
  parent: RTNode | null;
  prelim: number;
  mod: number;
  x: number;
  y: number;
  depth: number;
  subtreeHeight: number;
}

/** Reingold-Tilford tidy tree（根居中，深度 1 分左右两侧，子树跟随） */
export function layoutMindMap(
  nodes: MindoLayoutNode[],
  rootId: string,
  options: LayoutOptions = {}
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  const levelGapX = options.levelGapX ?? DEFAULT_GAP_X;
  const siblingGapY = options.siblingGapY ?? 40;

  const byId = new Map<string, MindoLayoutNode>();
  for (const n of nodes) byId.set(n.id, n);

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) || [];
      arr.push(n.id);
      childrenOf.set(n.parentId, arr);
    }
  }

  const buildRT = (id: string, parent: RTNode | null, depth: number): RTNode => {
    const node = byId.get(id)!;
    const rt: RTNode = {
      node,
      children: [],
      parent,
      prelim: 0,
      mod: 0,
      x: 0,
      y: 0,
      depth,
      subtreeHeight: node.height,
    };
    for (const cid of childrenOf.get(id) || []) {
      rt.children.push(buildRT(cid, rt, depth + 1));
    }
    if (rt.children.length > 0) {
      rt.subtreeHeight = rt.children.reduce(
        (sum, c, i) => sum + c.subtreeHeight + (i > 0 ? siblingGapY : 0),
        0
      );
      rt.subtreeHeight = Math.max(rt.subtreeHeight, node.height);
    }
    return rt;
  };

  const root = buildRT(rootId, null, 0);

  const firstWalk = (n: RTNode) => {
    if (n.children.length === 0) {
      n.prelim = 0;
      return;
    }
    for (const c of n.children) firstWalk(c);
    let acc = 0;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      c.prelim = acc + c.subtreeHeight / 2;
      acc += c.subtreeHeight + siblingGapY;
    }
    const firstC = n.children[0];
    const lastC = n.children[n.children.length - 1];
    n.prelim = (firstC.prelim - firstC.subtreeHeight / 2 + lastC.prelim + lastC.subtreeHeight / 2) / 2;
  };

  firstWalk(root);

  const assignY = (n: RTNode, parentCenterY: number, isRoot: boolean) => {
    if (isRoot) n.y = 0;
    for (const c of n.children) {
      const childCenterY = parentCenterY + (c.prelim - n.prelim);
      c.y = childCenterY - c.node.height / 2;
      assignY(c, childCenterY, false);
    }
  };

  assignY(root, 0, true);
  root.y = -root.node.height / 2;

  const assignX = (n: RTNode, side: -1 | 0 | 1) => {
    if (side === 0) {
      n.x = 0;
    } else {
      const parentX = n.parent ? n.parent.x : 0;
      const parentW = n.parent ? n.parent.node.width : 0;
      if (side > 0) {
        n.x = parentX + parentW + levelGapX;
      } else {
        n.x = parentX - levelGapX - n.node.width;
      }
    }
    const kids = n.children;
    if (kids.length > 0) {
      if (side === 0) {
        const mid = Math.ceil(kids.length / 2);
        kids.forEach((c, i) => assignX(c, i < mid ? -1 : 1));
      } else {
        kids.forEach((c) => assignX(c, side as -1 | 1));
      }
    }
  };

  assignX(root, 0);

  const result = new Map<string, { x: number; y: number }>();
  const collect = (n: RTNode) => {
    result.set(n.node.id, { x: n.x, y: n.y });
    for (const c of n.children) collect(c);
  };
  collect(root);

  return result;
}
