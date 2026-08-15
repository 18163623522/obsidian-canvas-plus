/**
 * CM6 EditorView 定位器
 *
 * 经运行时验证（eval 实测 Obsidian 1.7.x，2026-08）：
 * .cm-editor / .cm-content 元素上【没有】cmView 属性——社区流传的
 * dom.cmView.view 反查法在此版本无效，依赖它的功能全部静默失效。
 *
 * 有效路径（按优先级）：
 *  1) 笔记编辑器：markdown leaf 的 view.editor.cm（Obsidian Editor 暴露 .cm）
 *  2) 画布文本节点：node.child.editMode.cm（编辑态挂载的编辑器）
 *  3) 兜底：app.workspace.activeEditor.editor.cm（活动编辑器，含画布节点编辑场景）
 */
import type { App } from "obsidian";

/** 从当前 DOM 选区出发，定位选区所在编辑器的 CM6 EditorView */
export function findEditorViewFromSelection(app: App): any | null {
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  if (!anchor) return null;
  const el = (anchor.nodeType === 3 ? anchor.parentElement : anchor) as HTMLElement | null;
  if (!el) return null;
  return findEditorViewFromElement(app, el);
}

/** 从任意 DOM 元素出发（元素需在目标编辑器内），定位其 CM6 EditorView */
export function findEditorViewFromElement(app: App, el: HTMLElement): any | null {
  const ws = app.workspace as any;

  // 1) 笔记编辑器
  try {
    for (const leaf of ws.getLeavesOfType("markdown")) {
      const editor = leaf?.view?.editor;
      if (editor?.cm && leaf.view.contentEl?.contains(el)) return editor.cm;
    }
  } catch {}

  // 2) 画布文本节点（编辑中的）
  try {
    for (const leaf of ws.getLeavesOfType("canvas")) {
      const canvas = leaf?.view?.canvas;
      if (!canvas?.nodes) continue;
      for (const n of canvas.nodes.values()) {
        const cm = (n as any)?.child?.editMode?.cm;
        if (cm && (n as any).contentEl?.contains(el)) return cm;
      }
    }
  } catch {}

  // 3) 兜底：当前活动编辑器（含画布文本节点编辑场景）
  try {
    const cm = ws.activeEditor?.editor?.cm;
    if (cm) return cm;
  } catch {}

  return null;
}
