/**
 * 选中变化监听（monkey-patch）
 *
 * Obsidian 官方没有 canvas:selection-changed 事件。
 * 本模块 patch Canvas.prototype.updateSelection / selectOnly / deselectAll，
 * 在选中变化时派发自己的 "canvas-plus:selection-changed" 事件，
 * 供浮动工具条等功能订阅。
 *
 * 使用 monkey-around（pjeby/monkey-around），协作式 patch，可在 onunload 还原。
 */
import type { Plugin } from "obsidian";
import { around } from "monkey-around";

export const SELECTION_CHANGED_EVENT = "canvas-plus:selection-changed";

export function patchCanvasSelection(plugin: Plugin): () => void {
  const uninstallers: Array<() => void> = [];
  let attached = false;

  const attach = () => {
    if (attached) return;
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (leaves.length === 0) return;
    const view = (leaves[0] as any).view;
    if (!view?.canvas) return;
    const proto = Object.getPrototypeOf(view.canvas);
    attached = true;

    const wrap = (old: Function, methodName: string) =>
      function (this: any, ...args: any[]) {
        const ret = old.apply(this, args);
        try {
          plugin.app.workspace.trigger(
            SELECTION_CHANGED_EVENT as any,
            this
          );
        } catch (e) {
          console.error("[canvas-plus] trigger selection-changed failed", e);
        }
        return ret;
      };

    const un = around(proto, {
      updateSelection(old: Function) {
        return wrap(old, "updateSelection");
      },
      selectOnly(old: Function) {
        return wrap(old, "selectOnly");
      },
      deselectAll(old: Function) {
        return wrap(old, "deselectAll");
      },
      select(old: Function) {
        return wrap(old, "select");
      },
    });
    uninstallers.push(un);
    console.log("[canvas-plus] selection patch attached");
  };

  // layout ready 后尝试挂载；之后每次 layout-change 再尝试（处理新打开的画布）
  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);

  return () => {
    uninstallers.forEach((u) => u());
    plugin.app.workspace.offref(layoutRef);
  };
}
