/**
 * Canvas 内部 API 类型 shim
 *
 * Obsidian 官方 obsidian-api 只导出数据格式（CanvasData 等，见 import 'obsidian/canvas'），
 * 不包含运行时类型（Canvas / CanvasNode / CanvasView）。本文件提供我们用到的子集，
 * 精简自 advanced-canvas 的 @types/Canvas.d.ts（MIT, Developer-Mike）。
 *
 * 仅声明本插件实际调用的成员；未确认或会漂移的字段一律走 any。
 *
 * 来源：
 *  - advanced-canvas: https://github.com/Developer-Mike/obsidian-advanced-canvas/blob/main/src/@types/Canvas.d.ts
 *  - enchanted-canvas: https://github.com/borolgs/enchanted-canvas/blob/master/src/shared/types.ts
 *  - 官方数据格式:     https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts
 */

// 已在 obsidian/canvas 中定义，运行时也可用：直接复用官方数据类型
import type { CanvasData, CanvasNodeData, CanvasEdgeData } from "obsidian/canvas";

export type { CanvasData, CanvasNodeData, CanvasEdgeData };

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 运行时 CanvasNode（非官方）——只暴露本插件用到的字段 */
export interface CanvasNode {
  id: string;
  canvas: Canvas;
  /** 实时坐标，可直接修改后让 canvas 重新渲染 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 文本节点的纯文本/markdown 内容（setText 后存在） */
  text?: string;
  /** 文件节点的目标路径 */
  filePath?: string;
  /** 持久化的 JSON 节点数据 */
  nodeData: CanvasNodeData;
  /** 非标准字段（forward-compat），自定义属性落在这里 */
  unknownData?: Record<string, any>;
  /** 文本节点子编辑器（CodeMirror 6 视图），用于阶段 1B 的编辑器扩展 */
  child?: { editMode?: { cm?: any } };

  getData(): CanvasNodeData;
  setData(data: Partial<CanvasNodeData>, addHistory?: boolean): void;
  getBBox(): BBox;
  setColor(color: string): void;
  setText(text: string): void;
  setIsEditing(editing: boolean): void;
  /** 运行时是否存在此属性未确认，作为可选 */
  isEditing?: boolean;
  initialize?(): void;
}

export interface CanvasEdge {
  id: string;
  canvas: Canvas;
  /** 持久化的 JSON 边数据 */
  edgeData: CanvasEdgeData;
  getData(): CanvasEdgeData;
  setData(data: Partial<CanvasEdgeData>, addHistory?: boolean): void;
}

export interface CanvasView extends import("obsidian").ItemView {
  file: import("obsidian").TFile;
  canvas: Canvas;
  getViewData(): string;
  setViewData(data: string, clear?: boolean): void;
  requestSave(): void;
  /** 最近一次写入磁盘的内容，用于脏检查 */
  lastSavedData?: string;
}

export interface Canvas {
  view: CanvasView;
  /** 全部节点的运行时映射，key=节点 id */
  nodes: Map<string, CanvasNode>;
  /** 全部边的运行时映射，key=边 id */
  edges: Map<string, CanvasEdge>;
  /** 当前指针所在画布坐标（用于在新节点位置播种） */
  pointer?: { x: number; y: number };
  /** 当前选中的元素集合 */
  selection: Set<CanvasNode | CanvasEdge>;

  // —— 节点创建 ——
  createTextNode(options: {
    pos: { x: number; y: number };
    text?: string;
    size?: { width: number; height: number };
    focus?: boolean;
  }): CanvasNode;
  createFileNode(options: Record<string, any>): CanvasNode;
  createGroupNode(options: Record<string, any>): CanvasNode;
  createLinkNode(options: Record<string, any>): CanvasNode;

  // —— 边操作 ——
  addEdge(edge: Partial<CanvasEdgeData> & { fromNode: string; toNode: string }): CanvasEdge;
  removeEdge(edge: CanvasEdge): void;
  getEdgesForNode(node: CanvasNode): CanvasEdge[];

  // —— 选中 ——
  selectOnly(el: CanvasNode | CanvasEdge): void;
  deselectAll(): void;
  updateSelection(fn: (sel: Set<CanvasNode | CanvasEdge>) => void): void;

  // —— 数据 / 持久化 ——
  getData(): CanvasData;
  setData(data: CanvasData, addHistory?: boolean): void;
  /** 不进历史的批量替换，clearCanvas=true 时等价于重建 */
  importData(data: CanvasData, clearCanvas?: boolean, silent?: boolean): void;
  requestSave(): void;
  pushHistory(data?: CanvasData): void;

  // —— 视口 ——
  zoomToFit(): void;
  zoomToSelection(): void;
  zoomToBbox(bbox: BBox): void;
  getViewportBBox(): BBox;
  posCenter?(): { x: number; y: number };
  posFromClient?(clientPos: { x: number; y: number }): { x: number; y: number };
  posFromEvt?(evt: MouseEvent | { clientX: number; clientY: number }): { x: number; y: number };
}

/** 让 app.workspace 拿 canvas 叶子时获得类型 */
declare module "obsidian" {
  interface Workspace {
    getLeavesOfType(viewType: "canvas"): import("obsidian").WorkspaceLeaf[];
  }
}
