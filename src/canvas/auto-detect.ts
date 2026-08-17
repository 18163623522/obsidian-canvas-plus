/**
 * 输入自动识别：写完就走，插件自己判断内容类型
 *
 * 在节点里直接写裸内容，编辑结束（点走 / Esc）时按 detect-core 的
 * 判定结果包上底层标记（代码围栏 / $$ / Markdown 表格）。
 *
 * 底层产物仍是原生 Markdown，格式零变化。
 * 防回绕：若用户手动拆掉标记恢复成原文，本次会话不再对同样内容自动包。
 *
 * 诊断：所有关键步骤写 console [cp-detect] + load.log，
 * 另有「诊断：自动识别链路」命令可干跑检测。
 */
import { App, Notice, Plugin } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { detectContent } from "./detect-core";
import { openCodeLangPicker } from "./code-lang-picker";

/** 各节点上一次的编辑状态（在编辑中 = true） */
const editingState = new Map<string, boolean>();
/** 我们自动包过的节点：id → 当时的原文 */
const lastWrappedPlain = new Map<string, string>();
/** 用户手动拆掉标记的节点：id → 被拆后的原文（本次会话不再包） */
const suppressedPlain = new Map<string, string>();

function log(plugin: Plugin, msg: string) {
  console.log("[cp-detect] " + msg);
  try {
    (plugin as any).__cpWriteLog?.("[cp-detect] " + msg);
  } catch {}
}

export function setupAutoDetect(plugin: Plugin): () => void {
  const apply = () => {
    try {
      poll(plugin);
    } catch (e) {
      console.warn("[canvas-plus] auto-detect failed", e);
    }
  };
  const timer = setInterval(apply, 400);
  plugin.app.workspace.onLayoutReady(apply);
  const layoutRef = plugin.app.workspace.on("layout-change", apply);
  log(plugin, "setup ok (v2, DOM 编辑检测)");
  return () => {
    clearInterval(timer);
    plugin.app.workspace.offref(layoutRef);
    editingState.clear();
    lastWrappedPlain.clear();
    suppressedPlain.clear();
  };
}

/** 节点是否处于编辑中：DOM 里有 .cm-editor 为准，editMode 路径兜底 */
function isEditing(node: CanvasNode): boolean {
  const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
  if (nodeEl?.querySelector?.(".cm-editor")) return true;
  return !!(node as any).child?.editMode?.cm;
}

function poll(plugin: Plugin) {
  const leaves = plugin.app.workspace.getLeavesOfType("canvas");
  for (const leaf of leaves) {
    const canvas = (leaf as any).view?.canvas as Canvas | undefined | null;
    if (!canvas?.nodes) continue;
    for (const node of canvas.nodes.values()) {
      const data = node.getData() as any;
      if (!data || data.type !== "text" || !data.id) continue;
      const editing = isEditing(node);
      const was = editingState.get(data.id) ?? false;
      editingState.set(data.id, editing);
      if (was && !editing) {
        log(plugin, `编辑结束 ${data.id}`);
        onEditEnd(plugin, node);
      }
    }
  }
}

function onEditEnd(plugin: Plugin, node: CanvasNode) {
  // 设置项在 CanvasPlusPlugin 上，基类 Plugin 没有类型；显式 false 才关
  if ((plugin as any).settings?.autoDetect === false) return;
  const data = node.getData() as any;
  const id: string = data.id;
  const text: string = (data.text ?? "").trim();
  if (text.length < 2) return;

  // 用户拆掉标记恢复原文 → 本次会话尊重，不再自动包
  if (suppressedPlain.get(id) === text) return;
  if (lastWrappedPlain.get(id) === text) {
    suppressedPlain.set(id, text);
    return;
  }

  // 已有结构的内容不动：围栏/公式/表格/标题/列表/引用/插件标记
  if (/^(```|\$\$|\||%%cp:|#|>|\s*[-*] |[-*] \[|\d+\.)/.test(text)) return;
  if (text.includes("```") || text.includes("$$")) return;

  const hit = detectContent(text);
  log(plugin, `判定 ${id}: ${hit ? hit.kind + (hit.kind === "code" ? "/" + hit.lang : "") : "null"} ← "${text.slice(0, 40)}"`);
  if (!hit) return;

  wrapNode(plugin, node, hit.kind === "code" ? "```" + hit.lang + "\n" + text + "\n```" : hit.text);
  lastWrappedPlain.set(id, text);

  if (hit.kind === "code") {
    // 弹出语言选择浮层：检测结果已预选，可一键改语言；点别处保持现状
    const lang = hit.lang;
    setTimeout(() => {
      const nodeEl = (node as any).nodeEl as HTMLElement | undefined;
      if (!nodeEl || !document.contains(nodeEl)) return;
      const r = nodeEl.getBoundingClientRect();
      openCodeLangPicker(r.right - 220, r.bottom + 6, lang, (picked) => {
        if (picked === lang) return;
        const cur = node.getData() as any;
        if (typeof cur?.text !== "string") return;
        const newText = (cur.text as string).replace(/^```[A-Za-z0-9#+.-]*/, "```" + picked);
        (node as any).setData?.({ ...cur, text: newText });
        (node as any).canvas?.requestSave?.();
      });
    }, 60);
    new Notice(`已自动识别为代码（${lang}）`);
    return;
  }
  new Notice(hit.kind === "formula" ? "已自动识别为公式" : "已自动识别为表格");
}

function wrapNode(_plugin: Plugin, node: CanvasNode, wrapped: string) {
  const cur = node.getData() as any;
  (node as any).setData?.({ ...cur, text: wrapped });
  (node as any).canvas?.requestSave?.();
}

// ============================================================
//  手动触发 + 诊断（命令用）
// ============================================================

/** 手动对选中节点跑识别（跳过防回绕抑制，保留结构守卫）。返回结果描述。 */
export function detectNodeNow(plugin: Plugin, node: CanvasNode): string {
  const data = node.getData() as any;
  if (!data || data.type !== "text") return "不是文本节点";
  const text: string = (data.text ?? "").trim();
  if (text.length < 2) return "内容为空";
  if (/^(```|\$\$|\||%%cp:|#)/.test(text)) return "已是结构化内容（围栏/公式/表格/标题）";
  const hit = detectContent(text);
  log(plugin, `手动判定 ${data.id}: ${hit ? hit.kind : "null"} ← "${text.slice(0, 40)}"`);
  if (!hit) return "未识别（保持纯文本）";
  wrapNode(plugin, node, hit.kind === "code" ? "```" + hit.lang + "\n" + text + "\n```" : hit.text);
  lastWrappedPlain.set(data.id, text);
  return hit.kind === "code" ? `已识别为代码（${hit.lang}）` : hit.kind === "formula" ? "已识别为公式" : "已识别为表格";
}

/** 诊断：打印链路各环节状态 + 对选中节点干跑检测（不写入） */
export function diagnoseAutoDetect(plugin: Plugin): string {
  const lines: string[] = [];
  const push = (s: string) => {
    lines.push(s);
    log(plugin, s);
  };

  const leaves = plugin.app.workspace.getLeavesOfType("canvas");
  push(`① canvas 叶子数: ${leaves.length}`);
  if (!leaves.length) return lines.join("\n");

  const canvas = (leaves[leaves.length - 1] as any).view?.canvas;
  push(`② canvas 实例: ${!!canvas}, 节点数: ${canvas?.nodes?.size ?? 0}`);
  if (!canvas?.nodes) return lines.join("\n");

  const setting = (plugin as any).settings?.autoDetect;
  push(`③ autoDetect 设置: ${setting}（false=关闭）`);

  let editingCount = 0;
  for (const node of canvas.nodes.values()) {
    if (isEditing(node)) editingCount++;
  }
  push(`④ 当前编辑中的节点数: ${editingCount}（编辑一个节点时应 ≥1）`);

  // 选中节点干跑
  const sel = Array.from(canvas.selection.values()).filter((n: any) => n?.getData?.()?.type === "text");
  if (sel.length === 0) {
    push(`⑤ 未选中文本节点 → 选中一个再跑可看干跑结果`);
  } else {
    for (const node of sel.slice(0, 3)) {
      const data = (node as any).getData();
      const text: string = (data.text ?? "").trim();
      const hit = detectContent(text);
      push(
        `⑤ 节点 ${data.id} 干跑: ${hit ? hit.kind + (hit.kind === "code" ? "/" + hit.lang : "") : "null"}` +
        ` ← "${text.slice(0, 30).replace(/\n/g, "\\n")}"`
      );
    }
  }
  return lines.join("\n");
}
