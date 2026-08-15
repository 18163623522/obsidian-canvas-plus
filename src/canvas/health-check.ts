/**
 * 一键体检：运行时逐项探测各子系统是否真正在工作。
 *
 * 背景：用户报告"全部功能失效"，但 onload 完整、window.onerror 零报错——
 * 说明失效都是静默的（API 不存在、选择器不匹配、事件没挂上等）。
 * 本命令把每个子系统的真实运行时状态写进 load.log，把"全坏了"
 * 变成"具体哪一项坏了"。
 */
import { Notice, Plugin } from "obsidian";
import { getActiveCanvas } from "./canvas-access";
import { isSelectionPatchAttached, SELECTION_CHANGED_EVENT } from "./selection-patch";

export interface HealthItem {
  name: string;
  ok: boolean | null; // null = 无法判定/跳过
  detail: string;
}

export function runHealthCheck(plugin: Plugin): HealthItem[] {
  const items: HealthItem[] = [];
  const add = (name: string, ok: boolean | null, detail: string) => {
    items.push({ name, ok, detail });
  };
  const app = plugin.app as any;
  const write = (plugin as any).__cpWriteLog as ((msg: string) => void) | undefined;

  // 1. 版本
  add("插件版本", true, plugin.manifest.version);

  // 2. 激活画布
  let canvas: any = null;
  try {
    const leaves = app.workspace.getLeavesOfType("canvas");
    const active = app.workspace.activeLeaf;
    add(
      "画布叶子",
      leaves.length > 0,
      `${leaves.length} 个；activeLeaf 类型=${active?.view?.getViewType?.() ?? "无"}`
    );
    canvas = leaves.length > 0 ? leaves[leaves.length - 1].view?.canvas : null;
    add("Canvas 实例", !!canvas, canvas ? `节点 ${canvas.nodes?.size ?? "?"} / 边 ${canvas.edges?.size ?? "?"}` : "取不到");
  } catch (e: any) {
    add("画布叶子", false, "异常：" + e?.message);
  }

  // 3. 原生 API 可用性（决定建节点/连线/布局是否真的能跑）
  if (canvas) {
    const apis = [
      "createTextNode", "createFileNode", "createLinkNode", "createGroupNode",
      "importData", "markMoved", "pushHistory", "zoomToFit", "posFromEvt", "posCenter", "requestSave",
    ];
    const missing = apis.filter((k) => typeof canvas[k] !== "function");
    add("Canvas 原生 API", missing.length === 0, missing.length ? `缺失：${missing.join(", ")}` : `全部 ${apis.length} 个可用`);

    // 4. 节点 API
    const firstNode = canvas.nodes?.values()?.next()?.value;
    if (firstNode) {
      const nodeApis = ["getData", "setData", "nodeEl", "canvas"];
      const nodeMissing = nodeApis.filter((k) => (firstNode as any)[k] === undefined && typeof (firstNode as any)[k] !== "function");
      add("节点 API", nodeMissing.length === 0, nodeMissing.length ? `缺失：${nodeMissing.join(", ")}` : "getData/setData/nodeEl 正常");
    } else {
      add("节点 API", null, "画布无节点，跳过");
    }

    // 5. 选区
    try {
      const selData = canvas.getSelectionData?.();
      add("选区", true, `选中 ${selData?.nodes?.length ?? 0} 节点 / ${selData?.edges?.length ?? 0} 边`);
    } catch (e: any) {
      add("选区", false, "getSelectionData 异常：" + e?.message);
    }

    // 6. 选区 patch（浮动工具栏的命脉）：静态检测 + 真实回环验证
    try {
      const attachedNow = isSelectionPatchAttached(canvas);
      // 回环：监听一次选区事件，主动触发 deselectAll，看事件是否真的派发
      // （副作用：会取消当前选中，体检可接受）
      let fired = false;
      const ref = app.workspace.on(SELECTION_CHANGED_EVENT as any, () => {
        fired = true;
      });
      try {
        canvas.deselectAll?.();
      } catch {}
      app.workspace.offref(ref);
      add(
        "选区事件 patch",
        attachedNow || fired,
        `静态检测=${attachedNow}，回环触发=${fired}（浮动工具栏依赖此事件）`
      );
    } catch (e: any) {
      add("选区事件 patch", false, "异常：" + e?.message);
    }

    // 7. Mindo 标记：数据 vs DOM 一致性
    try {
      let dataCount = 0;
      let domCount = 0;
      const sample: string[] = [];
      for (const node of canvas.nodes.values()) {
        const d = node.getData?.() ?? {};
        if ((d as any).styleAttributes?.mindo) {
          dataCount++;
          if (sample.length < 3) sample.push(`${(d as any).text?.slice(0, 12) ?? d.id}`);
        }
        const el = (node as any).nodeEl as HTMLElement | undefined;
        if (el?.dataset?.mindo) domCount++;
      }
      add(
        "Mindo 卡片标记",
        dataCount === 0 ? null : dataCount === domCount,
        `数据 ${dataCount} 个 / DOM ${domCount} 个${dataCount !== domCount ? "（不一致→皮肤会丢，轮询会自愈）" : ""}${sample.length ? `；样例：${sample.join("、")}` : ""}`
      );
    } catch (e: any) {
      add("Mindo 卡片标记", false, "异常：" + e?.message);
    }

    // 8. Mindo 创建 patch
    try {
      const proto = Object.getPrototypeOf(canvas);
      const src = String(proto.createTextNode ?? "");
      const patched = src.includes("styleAttributes") || src.includes("mindo");
      add("Mindo 创建 patch", patched, patched ? "createTextNode 已包装（新节点自动套卡片）" : "未包装（新节点不会自动套卡片——检查设置）");
    } catch {}

    // 9. 样式轮询效果：带 cp 标记的节点 class 是否已应用
    try {
      let flagged = 0;
      let applied = 0;
      for (const node of canvas.nodes.values()) {
        const d = node.getData?.() ?? {};
        const el = (node as any).nodeEl as HTMLElement | undefined;
        if ((d as any).cpStyle || (d as any).cpShape || (d as any).cpSticky || (d as any).cpHidden || (d as any).cpCollapsed) {
          flagged++;
          if (el?.className.includes("cp-")) applied++;
        }
      }
      add("样式轮询", flagged === 0 ? null : applied === flagged, `带标记节点 ${flagged} 个 / 已应用 ${applied} 个`);
    } catch {}

    // 10. 定时器 / iframe 标记节点
    try {
      let timers = 0;
      let iframes = 0;
      for (const node of canvas.nodes.values()) {
        const t: string = (node.getData?.() as any)?.text ?? "";
        if (t.includes("%%cp:countdown") || t.includes("%%cp:timer")) timers++;
        if (t.includes("%%cp:iframe:")) iframes++;
      }
      const timerWidgets = document.querySelectorAll(".cp-timer-widget").length;
      const iframeEls = document.querySelectorAll(".cp-iframe-node, iframe.cp-iframe").length;
      add("计时器/iframe 伪节点", timers + iframes === 0 ? null : true, `标记节点：计时 ${timers}（渲染 ${timerWidgets}）/ iframe ${iframes}（渲染 ${iframeEls}）`);
    } catch {}
  }

  // 11. DOM 层
  const ftb = document.querySelector("#cp-floating-toolbar");
  const tfb = document.querySelector(".cp-text-format-toolbar");
  add("浮动工具栏 DOM", null, ftb ? "已创建" : "尚未创建（选中节点后才出现，正常）");
  add("格式工具条 DOM", null, tfb ? "已创建" : "尚未创建（选中文字后才出现，正常）");
  add("画布容器", !!document.querySelector(".canvas-wrapper"), document.querySelector(".canvas-wrapper") ? "存在" : "不存在（右键菜单/拖放无从挂载！）");

  // 12. 设置
  try {
    const s = (plugin as any).settings;
    add("设置", true, JSON.stringify(s));
  } catch (e: any) {
    add("设置", false, "读不到：" + e?.message);
  }

  // 输出
  const lines = items.map(
    (it) => `[体检] ${it.ok === true ? "✓" : it.ok === false ? "✗" : "-"} ${it.name}：${it.detail}`
  );
  const text = lines.join("\n");
  console.log("[canvas-plus]\n" + text);
  write?.("=== 一键体检 ===\n" + lines.join("\n") + "\n=== 体检结束 ===");

  const bad = items.filter((i) => i.ok === false).length;
  new Notice(bad === 0 ? `体检完成：${items.length} 项检查，无异常（详见 load.log）` : `体检完成：发现 ${bad} 项异常，详情已写入 load.log`, 8000);
  return items;
}
