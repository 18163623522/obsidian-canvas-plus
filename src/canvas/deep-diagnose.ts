/**
 * 白板增强技术地基深度诊断
 *
 * 探测四个关键点（决定后面所有功能能否实现）：
 * 1. canvas:selection-menu 官方事件能否监听
 * 2. node.child.editMode.cm 是不是 CM6 EditorView（能否注入扩展）
 * 3. Canvas DOM 选择器（.canvas-node / .canvas-wrapper）是否如预期
 * 4. updateSelection / selectOnly 能否被 monkey-patch
 *
 * 结果写到 Notice（10秒）和 Console。
 */
import { App, Notice } from "obsidian";

export function deepDiagnose(app: App): void {
  const log: string[] = [];
  const push = (s: string) => {
    log.push(s);
    console.log("[cp-diag] " + s);
  };

  push("===== 白板增强技术地基诊断 =====");

  // 1. 找到 canvas 视图
  const leaves = app.workspace.getLeavesOfType("canvas");
  push(`\n[1] canvas 叶子数: ${leaves.length}`);
  if (leaves.length === 0) {
    push("  ❌ 请先打开一个 .canvas 白板再运行此诊断");
    new Notice(log.join("\n"), 10000);
    return;
  }
  const view = (leaves[0] as any).view;
  const canvas = view?.canvas;
  push(`  view 类型: ${view?.getViewType?.()}`);
  push(`  canvas 存在: ${!!canvas}`);

  // 2. DOM 选择器探测
  push("\n[2] Canvas DOM 结构探测:");
  const wrapperEl = canvas?.wrapperEl as HTMLElement | undefined;
  const canvasEl = canvas?.canvasEl as HTMLElement | undefined;
  push(`  canvas.wrapperEl: ${wrapperEl?.tagName} .${wrapperEl?.className}`);
  push(`  canvas.canvasEl: ${canvasEl?.tagName} .${canvasEl?.className}`);

  // 用 querySelector 探测实际 DOM
  if (wrapperEl) {
    const nodes = wrapperEl.querySelectorAll(".canvas-node");
    push(`  .canvas-node 数量: ${nodes.length}`);
    const edges = wrapperEl.querySelectorAll(".canvas-edge");
    push(`  .canvas-edge 数量: ${edges.length}`);
    if (nodes.length > 0) {
      const firstNode = nodes[0] as HTMLElement;
      push(`  首个 node 的 dataset: ${JSON.stringify(firstNode.dataset)}`);
      push(`  首个 node className 片段: ${firstNode.className.slice(0, 80)}`);
    }
  }

  // 3. 节点对象探测（含 child.editMode.cm）
  push("\n[3] CanvasNode 对象探测（child.editMode.cm 关键！）:");
  const nodeMap = canvas?.nodes as Map<string, any>;
  push(`  canvas.nodes Map size: ${nodeMap?.size}`);
  if (nodeMap && nodeMap.size > 0) {
    const firstNode = nodeMap.values().next().value;
    push(`  node.id: ${firstNode?.id}`);
    push(`  node.nodeEl 存在: ${!!firstNode?.nodeEl}`);
    push(`  node.child 存在: ${!!firstNode?.child}`);
    push(`  node.child.editMode 存在: ${!!firstNode?.child?.editMode}`);
    const cm = firstNode?.child?.editMode?.cm;
    push(`  node.child.editMode.cm 存在: ${!!cm}`);
    if (cm) {
      push(`  cm.constructor.name: ${cm.constructor?.name}`);
      push(`  cm.dom 存在: ${!!cm.dom}（CM6 EditorView 特征）`);
      push(`  cm.state 存在: ${!!cm.state}（CM6 EditorView 特征）`);
      push(`  cm.dispatch 是函数: ${typeof cm.dispatch === "function"}`);
      push(`  👉 结论: ${cm.state && cm.dispatch ? "✓ 是 CM6 EditorView，可注入扩展" : "❌ 不是标准 CM6 EditorView"}`);
    }
    // 文本节点的 child 可能在进入编辑态后才创建
    if (!cm && firstNode?.text !== undefined) {
      push("  ⚠ 文本节点的 cm 尚未创建——需进入编辑态（双击节点）后再诊断");
    }
  }

  // 4. 关键方法是否存在（patch 前提）
  push("\n[4] Canvas 方法探测（monkey-patch 前提）:");
  const methods = ["updateSelection", "selectOnly", "deselectAll", "select", "addNode", "removeNode", "requestSave", "getData", "setData"];
  for (const m of methods) {
    push(`  canvas.${m}: ${typeof (canvas as any)[m]}`);
  }

  // 5. 选中状态
  push("\n[5] 当前选中:");
  const sel = canvas?.selection;
  push(`  canvas.selection: ${sel?.constructor?.name}, size=${sel?.size}`);
  if (sel && sel.size > 0) {
    const first = sel.values().next().value;
    push(`  选中元素类型: ${first?.constructor?.name}`);
    push(`  选中元素有 nodeEl: ${!!first?.nodeEl}`);
  }

  // 6. 测试 selection-menu 事件能否挂载（不触发，只检查 API）
  push("\n[6] canvas:* 事件测试:");
  try {
    const ref = app.workspace.on("canvas:selection-menu" as any, () => {});
    push(`  ✓ workspace.on("canvas:selection-menu") 成功挂载，ref=${ref}`);
    app.workspace.offref(ref);
  } catch (e: any) {
    push(`  ❌ canvas:selection-menu 挂载失败: ${e?.message}`);
  }

  push("\n===== 诊断完成 =====");
  push("提示：双击一个文本节点进入编辑态，再运行一次本诊断，能看到 cm 详情");

  new Notice(log.join("\n"), 10000);
  console.log("[cp-diag] 完整日志已输出，可在 Console 查看");
}

/**
 * 专项诊断：dump createTextNode / createFileNode 等方法的真实源码 + 实测调用
 * 这是定位"插入节点没反应"的关键——直接看 API 真实形态
 */
export function diagnoseNodeCreation(app: App): void {
  const log: string[] = [];
  const push = (s: string) => {
    log.push(s);
    console.log("[cp-create] " + s);
  };

  push("===== 节点创建 API 诊断 =====");
  const leaves = app.workspace.getLeavesOfType("canvas");
  if (leaves.length === 0) {
    push("❌ 请先打开一个 .canvas 白板");
    new Notice(log.join("\n"), 10000);
    return;
  }
  const canvas = (leaves[0] as any).view?.canvas;
  if (!canvas) {
    push("❌ view.canvas 不存在");
    new Notice(log.join("\n"), 10000);
    return;
  }

  // 1. dump 工厂方法是否存在 + 源码
  push("\n[1] 工厂方法源码 dump:");
  for (const m of ["createTextNode", "createFileNode", "createGroupNode", "createLinkNode", "addNode", "requestSave"]) {
    const fn = (canvas as any)[m];
    if (typeof fn !== "function") {
      push(`  ${m}: ❌ 不是函数 (${typeof fn})`);
      continue;
    }
    const src = fn.toString();
    push(`  ${m}: ✓ 存在，源码前 300 字符:`);
    push(`    ${src.slice(0, 300)}`);
  }

  // 2. posCenter 源码
  push("\n[2] posCenter 源码:");
  push(`    ${(canvas.posCenter?.toString?.() ?? "不存在").slice(0, 200)}`);

  // 3. 实测：用数据快照模式创建节点（验证过的可靠方式）
  push("\n[3] 实测 数据快照创建节点（getData/setData）:");
  try {
    const c = canvas.posCenter?.() ?? { x: 0, y: 0 };
    push(`  posCenter() = ${JSON.stringify(c)}`);
    const before = canvas.getData().nodes.length;
    const data = canvas.getData();
    data.nodes = [...data.nodes, {
      id: "diag-test-" + Date.now(),
      type: "text",
      x: c.x,
      y: c.y,
      width: 250,
      height: 120,
      text: "# 诊断测试节点\n\n如果看到我，说明数据快照模式可用",
    }];
    canvas.setData(data);
    canvas.requestSave();
    const after = canvas.getData().nodes.length;
    push(`  节点数: ${before} → ${after}（+${after - before}）`);
    push(`  canvas.nodes Map size: ${canvas.nodes?.size}`);
    if (after > before) {
      push(`  ✓ 数据快照创建成功！请看白板是否出现测试节点`);
      try { canvas.zoomToSelection?.(); } catch {}
    } else {
      push(`  ❌ setData 后节点数没增加`);
    }
  } catch (e: any) {
    push(`  ❌ 调用抛错: ${e?.message ?? e}`);
    push(`  stack: ${e?.stack?.slice(0, 300)}`);
  }

  // 4. dump createTextNode 接收参数的方式：用一个 Proxy 观察
  push("\n[4] 观察参数:（已在第3步传入，看上方源码确认参数名）");

  push("\n===== 诊断完成，请把 Console [cp-create] 日志发我 =====");
  new Notice(log.join("\n"), 10000);
}
