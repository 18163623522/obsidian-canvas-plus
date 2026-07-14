/**
 * Canvas Plus 插件入口
 *
 * 阶段 1A：自动布局 / Markdown↔Canvas 互转 / 批量节点操作
 * 阶段 1B：每块字号调整 + 快捷键（slash 菜单 / 高亮块 / 拖拽后续）
 */
import { Plugin, Notice } from "obsidian";
import type { Modifier } from "obsidian";
import type { Canvas } from "./types/canvas-internal";
import { getActiveCanvas, targetNodes, diagnoseCanvas } from "./canvas/canvas-access";
import { applyLayout } from "./canvas/layout";
import { generateCanvasFromNote } from "./canvas/markdown-to-canvas";
import { exportCanvasToMarkdown } from "./canvas/canvas-to-markdown";
import { bulkCreate, BulkCreateModal } from "./canvas/bulk-ops";
import { editorExtensions } from "./editor/extension";
import { setBlockFontSize, FONT_SIZES } from "./editor/block-fontsize";
import { readingViewFontsizeProcessor } from "./editor/reading-view";
import { SlashMenuSuggest } from "./editor/slash-menu";
import { patchCanvasSelection, SELECTION_CHANGED_EVENT } from "./canvas/selection-patch";
import { FloatingToolbar } from "./canvas/floating-toolbar";
import { setupCanvasSlash } from "./canvas/canvas-slash";
import { deepDiagnose } from "./canvas/deep-diagnose";
import { diagnoseNodeCreation } from "./canvas/deep-diagnose";
import {
  setupPlainTextStyle,
  createPlainTextNode,
  togglePlain,
} from "./canvas/plain-text";
import { createStickyNode } from "./canvas/node-styles";
import { expandMindmap, mindmapFromNote } from "./canvas/mindmap";
import { expandOneDegree, expandTwoDegrees } from "./canvas/graph-expand";
import { createIframeNode, setupIframeNodes } from "./canvas/iframe-node";
import { toggleLock, toggleHide, bringToFront, sendToBack, applyLayerStyle } from "./canvas/layers";
import { setupTablePaste } from "./canvas/table-paste";
import {
  insertTable,
  tableAddRow,
  tableAddColumn,
  tableDeleteRow,
  tableDeleteColumn,
  tableAlign,
} from "./canvas/table-edit";
import { setupSmartSnap } from "./canvas/smart-snap";
import { TextFormatToolbar } from "./canvas/text-format-toolbar";
import {
  insertMathNode,
  insertMermaidNode,
  insertCodeNode,
  insertFileNode,
  insertUrlNode,
} from "./canvas/quick-insert";
import { setupDropHandler } from "./canvas/drop-image";
import {
  setupTimerNodes,
  createCountdownNode,
  createStopwatchNode,
  diagnoseTimers,
} from "./canvas/timer-node";
import { setupContextMenu } from "./canvas/context-menu";
import { setupTabConnect } from "./canvas/tab-connect";
import { searchInNode } from "./canvas/node-search";
import {
  CanvasPlusSettings,
  DEFAULT_SETTINGS,
  CanvasPlusSettingTab,
} from "./settings/settings";

export default class CanvasPlusPlugin extends Plugin {
  // Plugin 基类已有 settings（loadData/saveData 的承载对象），这里用 declare 收窄类型
  declare settings: CanvasPlusSettings;
  slashMenu!: SlashMenuSuggest;
  private toolbar!: FloatingToolbar;
  private uninstallSelectionPatch?: () => void;
  private uninstallCanvasSlash?: () => void;
  private uninstallPlainStyle?: () => void;
  private uninstallTablePaste?: () => void;
  private uninstallSmartSnap?: () => void;
  private uninstallDrop?: () => void;
  private uninstallTimers?: () => void;
  private uninstallContextMenu?: () => void;
  private uninstallIframe?: () => void;
  private uninstallTab?: () => void;
  private textFormatToolbar!: TextFormatToolbar;

  async onload() {
    // 启动日志写到文件，方便外部检查（不依赖 Console）
    try {
      const fs = require("node:fs");
      const path = require("node:path");
      const logPath = path.join((this.app.vault.adapter as any).getBasePath?.() ?? "", ".obsidian", "plugins", "canvas-plus", "load.log");
      const write = (msg: string) => {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        fs.appendFileSync(logPath, line);
      };
      write("=== onload start ===");
      (this as any).__cpWriteLog = write;

      await this.loadSettings();
      write("settings loaded");
      this.addSettingTab(new CanvasPlusSettingTab(this.app, this));
      write("setting tab added");

    // ——————————————————————————————————————————————
    //  编辑器扩展（字号等 CM6 扩展，作用于 MarkdownView）
    // ——————————————————————————————————————————————
    this.registerEditorExtension(editorExtensions);
    this.registerMarkdownPostProcessor(readingViewFontsizeProcessor);

    // ——————————————————————————————————————————————
    //  编辑器扩展（字号等 CM6 扩展，作用于 MarkdownView）
    // ——————————————————————————————————————————————
    this.registerEditorExtension(editorExtensions);
    this.registerMarkdownPostProcessor(readingViewFontsizeProcessor);

    // 斜杠菜单（笔记内，EditorSuggest）
    this.slashMenu = new SlashMenuSuggest(this.app);
    this.registerEditorSuggest(this.slashMenu);

    this.registerEditorFontsizeCommands();

    // ——————————————————————————————————————————————
    //  白板增强（直接作用于 Canvas，不依赖 MarkdownView）
    // ——————————————————————————————————————————————
    // 1. 选中变化监听（monkey-patch，派发自定义事件）
    this.uninstallSelectionPatch = patchCanvasSelection(this);
    // 2. 浮动工具条（选中节点时弹出）
    this.toolbar = new FloatingToolbar(this.app);
    this.registerEvent(
      this.app.workspace.on(SELECTION_CHANGED_EVENT as any, (canvas: any) => {
        this.toolbar.onSelectionChanged(canvas);
      })
    );
    // 切换画布/布局变化时隐藏工具条
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const leaves = this.app.workspace.getLeavesOfType("canvas");
        if (leaves.length === 0) this.toolbar.hide();
      })
    );
    // 3. 白板内 slash 菜单（注入到 node.child.editMode.cm）
    this.uninstallCanvasSlash = setupCanvasSlash(this);
    // 4. 纯文字节点样式轮询（给带 cpStyle=plain 标记的节点去边框）
    this.uninstallPlainStyle = setupPlainTextStyle(this);
    // 5. 表格粘贴识别（白板 + 笔记，外部表格自动转 Markdown）
    this.uninstallTablePaste = setupTablePaste(this);
    // 6. 智能吸附辅助线（拖动节点时显示对齐线）
    this.uninstallSmartSnap = setupSmartSnap(this);
    // 7. 富文本工具条（选中文本片段时弹出）
    this.textFormatToolbar = new TextFormatToolbar();
    this.register(() => this.textFormatToolbar.destroy());
    // 8. 图片拖拽入白板
    this.uninstallDrop = setupDropHandler(this);
    // 9. 倒计时/计时器伪节点渲染
    this.uninstallTimers = setupTimerNodes(this);
    // 10. 白板右键菜单（插入节点/布局/样式）
    this.uninstallContextMenu = setupContextMenu(this);
    // 11. 网页 iframe 嵌入伪节点
    this.uninstallIframe = setupIframeNodes(this);
    // 12. Tab 键补全连线
    this.uninstallTab = setupTabConnect(this);

    // ——————————————————————————————————————————————
    //  纯文字节点命令
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "create-plain-text",
      name: "创建纯文字（无边框）节点",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        // 在视口中心创建
        const center = canvas.posCenter?.() ?? { x: 0, y: 0 };
        createPlainTextNode(canvas, {
          x: center.x - 120,
          y: center.y - 30,
          text: "",
          width: 240,
          height: 60,
        });
        new Notice("已创建纯文字节点（双击编辑）");
      },
    });
    this.addCommand({
      id: "toggle-plain",
      name: "切换选中节点为纯文字 / 卡片",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        const nodes = targetNodes(canvas);
        if (nodes.length === 0) {
          if (!checking) new Notice("请先选中节点");
          return false;
        }
        for (const n of nodes) togglePlain(n);
      },
    });

    // ——————————————————————————————————————————————
    //  便签节点命令
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "create-sticky",
      name: "创建便签（黄色）",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        const center = canvas.posCenter?.() ?? { x: 0, y: 0 };
        createStickyNode(canvas, {
          x: center.x - 100,
          y: center.y - 100,
          text: "",
          color: "yellow",
        });
        new Notice("已创建便签");
      },
    });

    // ——————————————————————————————————————————————
    //  思维导图命令
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "mindmap-expand",
      name: "思维导图：展开选中节点",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        expandMindmap(this.app, canvas, { source: "auto", childStyle: "plain" });
      },
    });
    this.addCommand({
      id: "mindmap-from-note",
      name: "思维导图：从当前笔记生成",
      editorCheckCallback: (checking, _editor, view) => {
        const file = view.file;
        if (!file) return false;
        if (checking) return true;
        mindmapFromNote(this.app, file);
      },
    });

    // ----------------------------------------------
    //  知识图谱展开命令
    // ----------------------------------------------
    this.addCommand({
      id: "graph-expand-1",
      name: "知识图谱：展开选中节点 1 度链接",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        expandOneDegree(this.app, canvas);
      },
    });
    this.addCommand({
      id: "graph-expand-2",
      name: "知识图谱：展开选中节点 2 度链接",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        expandTwoDegrees(this.app, canvas);
      },
    });

    // ——————————————————————————————————————————————
    //  一键插入新节点（图片/PDF/视频/公式/Mermaid/代码/计时器）
    // ——————————————————————————————————————————————
    const insertCmd = (id: string, name: string, fn: (c: any) => void) => {
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const canvas = getActiveCanvas(this.app);
          if (!canvas) return false;
          if (checking) return true;
          fn(canvas);
        },
      });
    };
    insertCmd("insert-math", "插入：公式节点", (c) => insertMathNode(c));
    insertCmd("insert-mermaid", "插入：Mermaid 流程图节点", (c) => insertMermaidNode(c));
    insertCmd("insert-code", "插入：代码节点", (c) => insertCodeNode(c));
    insertCmd("insert-file", "插入：图片/PDF/视频节点", (c) => insertFileNode(c, this.app));
    insertCmd("insert-countdown", "插入：倒计时节点", (c) => {
      const target = window.prompt("倒计时目标时间\n格式：2026-12-31 或 2026-12-31T23:59:59", "2026-12-31T23:59:59");
      if (target) {
        const d = new Date(target);
        if (isNaN(d.getTime())) {
          new Notice("时间格式无效");
          return;
        }
        createCountdownNode(c, d.toISOString());
      }
    });
    insertCmd("insert-stopwatch", "插入：秒表节点", (c) => createStopwatchNode(c));
    insertCmd("insert-iframe", "插入：网页嵌入", (c) => {
      const url = window.prompt("输入网址（https://...）", "https://");
      if (url) createIframeNode(c, url);
    });
    this.addCommand({
      id: "diagnose-timers",
      name: "（诊断）倒计时节点渲染链路",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        diagnoseTimers(canvas);
        new Notice("已扫描，请看 Console (Ctrl+Shift+I) 里 [cp-timer] 日志");
      },
    });

    // ----------------------------------------------
    //  节点内嵌搜索命令
    // ----------------------------------------------
    this.addCommand({
      id: "node-search",
      name: "搜索节点内容",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        searchInNode(this.app, canvas);
      },
    });


    // ——————————————————————————————————————————————
    //  表格命令（笔记 + 白板通用，作用于当前编辑器）
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "table-insert",
      name: "表格：插入 3×3 表格",
      editorCallback: (editor) => insertTable(editor),
    });
    this.addCommand({
      id: "table-add-row",
      name: "表格：加行",
      editorCallback: (editor) => {
        if (!tableAddRow(editor)) new Notice("光标不在表格内");
      },
    });
    this.addCommand({
      id: "table-add-column",
      name: "表格：加列",
      editorCallback: (editor) => {
        if (!tableAddColumn(editor)) new Notice("光标不在表格内");
      },
    });
    this.addCommand({
      id: "table-delete-row",
      name: "表格：删行",
      editorCallback: (editor) => {
        if (!tableDeleteRow(editor)) new Notice("光标不在表格内");
      },
    });
    this.addCommand({
      id: "table-delete-column",
      name: "表格：删列",
      editorCallback: (editor) => {
        if (!tableDeleteColumn(editor)) new Notice("光标不在表格内");
      },
    });
    this.addCommand({
      id: "table-align-left",
      name: "表格：左对齐",
      editorCallback: (editor) => {
        if (!tableAlign(editor, "left")) new Notice("光标不在表格内");
      },
    });
    this.addCommand({
      id: "table-align-center",
      name: "表格：居中对齐",
      editorCallback: (editor) => {
        if (!tableAlign(editor, "center")) new Notice("光标不在表格内");
      },
    });
    this.addCommand({
      id: "table-align-right",
      name: "表格：右对齐",
      editorCallback: (editor) => {
        if (!tableAlign(editor, "right")) new Notice("光标不在表格内");
      },
    });

    // ——————————————————————————————————————————————
    //  自动布局
    // ——————————————————————————————————————————————
    const layoutTypes = ["tree", "radial", "force", "dag"] as const;
    for (const type of layoutTypes) {
      this.addCommand({
        id: `layout-${type}`,
        name: `自动布局：${this.layoutLabel(type)}`,
        checkCallback: (checking) => {
          const canvas = getActiveCanvas(this.app);
          if (!canvas) return false;
          if (checking) return true;
          this.runLayout(canvas, type);
        },
      });
    }

    // ——————————————————————————————————————————————
    //  Markdown ↔ Canvas 互转
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "note-to-canvas-new",
      name: "从当前笔记生成新画布",
      editorCheckCallback: (checking, _editor, view) => {
        const file = view.file;
        if (!file) return false;
        if (checking) return true;
        generateCanvasFromNote(this.app, file, {
          mode: "new",
          layout: this.settings.defaultLayout,
          includeLinks: true,
        });
      },
    });

    this.addCommand({
      id: "note-to-canvas-append",
      name: "把当前笔记结构追加到画布",
      editorCheckCallback: (checking, _editor, view) => {
        const file = view.file;
        if (!file) return false;
        if (checking) return true;
        generateCanvasFromNote(this.app, file, {
          mode: "append",
          layout: this.settings.defaultLayout,
          includeLinks: true,
        });
      },
    });

    this.addCommand({
      id: "canvas-to-markdown",
      name: "把画布导出为 Markdown 大纲",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        exportCanvasToMarkdown(this.app, canvas);
      },
    });

    // ——————————————————————————————————————————————
    //  批量节点操作
    // ——————————————————————————————————————————————
    for (const source of ["tag", "folder", "search"] as const) {
      this.addCommand({
        id: `bulk-${source}`,
        name: `批量创建：${this.sourceLabel(source)}`,
        checkCallback: (checking) => {
          const canvas = getActiveCanvas(this.app);
          if (!canvas) return false;
          if (checking) return true;
          new BulkCreateModal(this.app, source, async (opts) => {
            const c = getActiveCanvas(this.app);
            if (!c) return;
            await bulkCreate(this.app, c, {
              ...opts,
              linkEdges: this.settings.bulkLinkEdges,
              limit: this.settings.bulkLimit,
            });
          }).open();
        },
      });
    }

    // ——————————————————————————————————————————————
    //  通路自测命令
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "self-test",
      name: "（自测）在画布上创建测试节点",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        try {
          const c = canvas.posCenter?.() ?? { x: 100, y: 100 };
          const data = canvas.getData();
          const id = "test-" + Date.now();
          data.nodes = [...data.nodes, {
            id,
            type: "text",
            x: c.x - 150,
            y: c.y - 100,
            width: 300,
            height: 200,
            text: "# 测试节点\n\nCanvas Plus 已就绪 ✓",
          }];
          canvas.setData(data);
          canvas.requestSave();
          new Notice(`✓ 已创建节点 ${id}`);
        } catch (e: any) {
          console.error("[canvas-plus] self-test failed", e);
          new Notice(`❌ 创建失败: ${e?.message ?? e}\n请运行诊断命令查看详情`, 10000);
        }
      },
    });

    // ——————————————————————————————————————————————
    //  诊断命令（白板失效时用来定位问题）
    // ——————————————————————————————————————————————
    this.addCommand({
      id: "diagnose",
      name: "（诊断）打印 Canvas API 结构",
      callback: () => diagnoseCanvas(this.app),
    });
    this.addCommand({
      id: "diagnose-deep",
      name: "（诊断）白板增强技术地基深度探测",
      callback: () => deepDiagnose(this.app),
    });
    this.addCommand({
      id: "diagnose-create",
      name: "（诊断）节点创建 API 真实签名 + 实测",
      callback: () => diagnoseNodeCreation(this.app),
    });

    // 启动富文本工具条
    this.register(this.textFormatToolbar.setup(this));

    write("=== onload complete ===");
    console.log("[canvas-plus] loaded");
  } catch (e: any) {
    const msg = `onload CRASHED: ${e?.message ?? e}\n${e?.stack ?? ""}`;
    console.error("[canvas-plus] " + msg);
    try { (this as any).__cpWriteLog?.(msg); } catch {}
    try { new (require("obsidian").Notice)(`Canvas Plus 加载失败: ${e?.message ?? e}`, 15000); } catch {}
  }
  }

  onunload(): void {
    this.uninstallSelectionPatch?.();
    this.uninstallCanvasSlash?.();
    this.uninstallPlainStyle?.();
    this.uninstallTablePaste?.();
    this.uninstallSmartSnap?.();
    this.uninstallDrop?.();
    this.uninstallTimers?.();
    this.uninstallContextMenu?.();
    this.uninstallIframe?.();
    this.uninstallTab?.();
    this.toolbar?.destroy();
  }

  // ============================================================
  //  字号命令注册（含快捷键 Ctrl+Alt+0~6）
  // ============================================================
  private registerEditorFontsizeCommands() {
    // 各档位命令 + 快捷键
    const sizeKeys: Array<[string, string]> = [
      ["90", "Ctrl-Alt-1"],
      ["110", "Ctrl-Alt-2"],
      ["125", "Ctrl-Alt-3"],
      ["150", "Ctrl-Alt-4"],
      ["200", "Ctrl-Alt-5"],
    ];
    for (const [size, hotkey] of sizeKeys) {
      this.addCommand({
        id: `fontsize-${size}`,
        name: `字号：${FONT_SIZES[size].label}`,
        editorCallback: (editor) => {
          setBlockFontSize(editor, parseInt(size, 10));
        },
        hotkeys: [{ modifiers: this.parseHotkey(hotkey).modifiers, key: this.parseHotkey(hotkey).key }],
      });
    }
    // 清除字号
    this.addCommand({
      id: "fontsize-clear",
      name: "字号：清除（标准）",
      editorCallback: (editor) => {
        setBlockFontSize(editor, 0);
      },
      hotkeys: [{ modifiers: ["Ctrl", "Alt"], key: "0" }],
    });

    // 布局快捷键：Obsidian 的 addCommand 不支持事后给命令加默认快捷键，
    // 但布局命令已注册（上方），用户可在 设置→快捷键 搜 "canvas plus" 自行绑定。
    // 这里通过 hotkeys 字段在新注册的"组合命令"上提供默认绑定，
    // 让用户即使不手动绑定也能用 Ctrl+Shift+L 一键力导向。
    this.addCommand({
      id: "layout-quick-force",
      name: "快速布局：力导向",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        this.runLayout(canvas, "force");
      },
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "L" }],
    });
    this.addCommand({
      id: "layout-quick-tree",
      name: "快速布局：树形",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        this.runLayout(canvas, "tree");
      },
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "T" }],
    });
    this.addCommand({
      id: "layout-quick-dag",
      name: "快速布局：流程图",
      checkCallback: (checking) => {
        const canvas = getActiveCanvas(this.app);
        if (!canvas) return false;
        if (checking) return true;
        this.runLayout(canvas, "dag");
      },
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "D" }],
    });
  }

  /** 解析 "Ctrl-Alt-1" → { modifiers, key } */
  private parseHotkey(hotkey: string): { modifiers: Modifier[]; key: string } {
    const parts = hotkey.split("-");
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1).map((m) => {
      if (m === "Ctrl") return "Ctrl" as const;
      if (m === "Alt") return "Alt" as const;
      if (m === "Shift") return "Shift" as const;
      if (m === "Meta") return "Meta" as const;
      return "Mod" as const;
    });
    return { modifiers, key };
  }

  private layoutLabel(type: string): string {
    return { tree: "树形", radial: "放射", force: "力导向", dag: "流程图" }[type] ?? type;
  }

  private sourceLabel(s: string): string {
    return { tag: "从标签", folder: "从文件夹", search: "从搜索结果" }[s] ?? s;
  }

  private runLayout(canvas: Canvas, type: "tree" | "radial" | "force" | "dag") {
    const nodes = targetNodes(canvas);
    const edges = canvas.getData().edges;
    if (nodes.length === 0) {
      new Notice("画布上没有节点");
      return;
    }
    try {
      applyLayout(canvas, nodes, edges, {
        type,
        horizontal: this.settings.treeHorizontal,
        rankdir: this.settings.dagRankdir,
        iterations: this.settings.forceIterations,
      });
      new Notice(`已应用 ${this.layoutLabel(type)} 布局（${nodes.length} 个节点）`);
    } catch (e) {
      console.error("[canvas-plus] layout failed", e);
      new Notice(`布局失败：${(e as Error).message}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
