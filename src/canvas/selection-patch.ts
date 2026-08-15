/**
 * 选中变化监听（monkey-patch）
 *
 * Obsidian 官方没有 canvas:selection-changed 事件。
 * 本模块 patch Canvas 的 updateSelection / selectOnly / deselectAll / select，
 * 在选中变化时派发自己的 "canvas-plus:selection-changed" 事件，
 * 供浮动工具条等功能订阅。
 *
 * 双保险：原型（一次，覆盖所有实例）+ 每个活实例的 own property
 * （每次 layout-change 补挂新开的画布）。若某环境里原型 patch 被其他
 * 插件还原、或方法不在原型上，实例级 patch 仍能触发事件。
 * 已是包装的方法不重复包（避免事件双发/多层嵌套）。
 * 每步写日志到 load.log，挂载失败可直接从日志定位环节。
 */
import type { Plugin } from "obsidian";
import { around } from "monkey-around";

export const SELECTION_CHANGED_EVENT = "canvas-plus:selection-changed";

const PATCHED_METHODS = ["updateSelection", "selectOnly", "deselectAll", "select"] as const;

/** 包装函数的标记属性（比源码字符串匹配可靠——源码里是常量名不是字面量） */
const PATCH_MARKER = "__cpSelectionPatch";

const fnIsOurs = (fn: any) => typeof fn === "function" && (fn as any)[PATCH_MARKER] === true;

/** 体检用：检测指定画布实例上选区 patch 是否生效（原型或实例任一命中即可） */
export function isSelectionPatchAttached(canvas: any): boolean {
  if (!canvas) return false;
  const proto = Object.getPrototypeOf(canvas) ?? (canvas as any).constructor?.prototype;
  for (const m of PATCHED_METHODS) {
    if (fnIsOurs(proto?.[m]) || fnIsOurs(canvas[m])) return true;
  }
  return false;
}

export function patchCanvasSelection(plugin: Plugin): () => void {
  const uninstallers: Array<() => void> = [];
  const write = (msg: string) => {
    try {
      (plugin as any).__cpWriteLog?.(msg);
    } catch {}
  };
  let protoPatched = false;
  /** 已做过实例级 patch 的画布集合（WeakSet 去重，卸载时按记录还原） */
  const instancePatches: Array<{ canvas: any; m: string; wrapped: any; orig: any }> = [];

  const makeWrapper = (old: any) => {
    const oldIsOurs = fnIsOurs(old);
    const wrapped = function (this: any, ...args: any[]) {
      const ret = typeof old === "function" ? old.apply(this, args) : undefined;
      // old 本身已是我们的包装（原型级）时事件已派发，跳过避免双发
      if (!oldIsOurs) {
        try {
          plugin.app.workspace.trigger(SELECTION_CHANGED_EVENT as any, this);
        } catch (e) {
          console.error("[canvas-plus] trigger selection-changed failed", e);
        }
      }
      return ret;
    };
    (wrapped as any)[PATCH_MARKER] = true;
    return wrapped;
  };

  /** 实例级 patch：给画布实例的四个方法加 own-property 包装 */
  const patchInstance = (canvas: any) => {
    try {
      for (const m of PATCHED_METHODS) {
        const current = canvas[m];
        if (typeof current !== "function") continue;
        if (fnIsOurs(current)) continue; // 已包装（含原型包装透出的情况）
        const wrapped = makeWrapper(current);
        canvas[m] = wrapped;
        instancePatches.push({ canvas, m, wrapped, orig: current });
      }
    } catch (e: any) {
      write(`[selection-patch] 实例 patch 失败：${e?.message}`);
    }
  };

  const attach = () => {
    const leaves = plugin.app.workspace.getLeavesOfType("canvas");
    if (leaves.length === 0) return;
    let firstCanvas: any = null;

    // —— 1) 原型级 patch（一次）——
    if (!protoPatched) {
      for (const leaf of leaves) {
        const c = (leaf as any).view?.canvas;
        if (!c) continue;
        firstCanvas = c;
        try {
          const proto = Object.getPrototypeOf(c) ?? c.constructor?.prototype;
          if (proto) {
            const patchObj: Record<string, (old: Function) => Function> = {};
            for (const m of PATCHED_METHODS) patchObj[m] = (old: Function) => makeWrapper(old);
            const un = around(proto, patchObj as any);
            uninstallers.push(un);
            protoPatched = true;
            write(
              `[selection-patch] 原型已 patch：updateSelection 存在=${typeof proto.updateSelection === "function"}，` +
                `包装后含标记=${fnIsOurs(proto.updateSelection)}`
            );
          }
        } catch (e: any) {
          write(`[selection-patch] 原型 patch 失败：${e?.message}`);
        }
        break;
      }
    }

    // —— 2) 实例级双保险（每次 layout-change 都补挂新开的画布）——
    for (const leaf of leaves) {
      const c = (leaf as any).view?.canvas;
      if (!c) continue;
      if (!firstCanvas) firstCanvas = c;
      const already = instancePatches.some((p) => p.canvas === c);
      if (!already) {
        patchInstance(c);
        write(`[selection-patch] 实例已 patch：生效=${isSelectionPatchAttached(c)}`);
      }
    }

    if (firstCanvas) console.log("[canvas-plus] selection patch attached");
  };

  // layout ready 后尝试挂载；之后每次 layout-change 再尝试（处理新打开的画布）
  plugin.app.workspace.onLayoutReady(attach);
  const layoutRef = plugin.app.workspace.on("layout-change", attach);
  // 兜底：万一 onLayoutReady/layout-change 都错过（如画布晚开），延迟再试
  setTimeout(() => attach(), 1000);
  setTimeout(() => attach(), 3000);

  return () => {
    uninstallers.forEach((u) => u());
    // 还原实例级 own-property（只还原仍是我们的包装的，避免覆盖后来者）
    for (const p of instancePatches) {
      if (p.canvas[p.m] === p.wrapped) p.canvas[p.m] = p.orig;
    }
    instancePatches.length = 0;
    plugin.app.workspace.offref(layoutRef);
  };
}
