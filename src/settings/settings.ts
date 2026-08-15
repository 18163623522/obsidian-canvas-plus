/**
 * 插件设置
 */
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type CanvasPlusPlugin from "../main";

export interface CanvasPlusSettings {
  /** 默认布局算法 */
  defaultLayout: "tree" | "radial" | "force" | "dag";
  /** 树形布局默认横向 */
  treeHorizontal: boolean;
  /** 力导向迭代次数 */
  forceIterations: number;
  /** DAG 方向 */
  dagRankdir: "TB" | "LR" | "BT" | "RL";
  /** 批量生成时是否自动建链接边 */
  bulkLinkEdges: boolean;
  /** 批量生成上限 */
  bulkLimit: number;
  /** 智能吸附辅助线开关 */
  smartSnap: boolean;
  /** 节点样式模版（颜色 + 字号 + 形状等完整样式） */
  styleTemplates: StyleTemplate[];
  // —— 与其他插件的冲突避让 ——
  /** 笔记内斜杠菜单（默认关：让位给 chinese-slash-format / slash-complete 等专门的斜杠插件） */
  enableNoteSlashMenu: boolean;
  /** 画布节点内斜杠菜单（画布内其他插件通常不覆盖，默认开） */
  enableCanvasSlashMenu: boolean;
  /** 选中文字的浮动格式工具条（色轮/色条/字号） */
  enableTextFormatToolbar: boolean;
  /** 表格粘贴识别（全局粘贴拦截，与粘贴增强类插件冲突时可关） */
  enableTablePaste: boolean;
  /** 节点工具栏位置：top=节点上方 bottom=节点下方 screen-top=屏幕顶部固定 */
  toolbarPosition: "top" | "bottom" | "screen-top";
  /** 工具栏色轮保存的颜色（调色板） */
  savedColors: string[];
  /** Mindo 卡片组件渲染（DOM 复刻）。关闭后卡片回落为 CSS 样式，
   * 用于排查组件是否干扰原生拖拽（连线/拉宽） */
  enableMindoCardWidget: boolean;
  // —— Mindo 思维导图（整合自 obsidian-mindo-canvas）——
  /** Mindo 新建节点默认颜色（色板索引 "1"-"6"，空串用白板默认） */
  mindoDefaultNodeColor: string;
  /** Mindo 新建节点自动套卡片样式 */
  mindoMarkNewNodes: boolean;
  /** Mindo 布局：父子水平间距 */
  mindoLayoutLevelGapX: number;
  /** Mindo 布局：同层垂直间距 */
  mindoLayoutSiblingGapY: number;
}

/** 节点样式模版：保存一组 cp* 标记 + 原生 color，可一键应用 */
export interface StyleTemplate {
  /** 模版名（用户起的） */
  name: string;
  /** 原生颜色（"1"-"6" 或 "#hex"） */
  color?: string;
  /** 字号缩放（如 1.2） */
  cpTextScale?: number;
  /** 纯文字标记 */
  cpStyle?: string;
  /** 形状 */
  cpShape?: string;
  /** 便签颜色 */
  cpSticky?: string;
}

export const DEFAULT_SETTINGS: CanvasPlusSettings = {
  defaultLayout: "force",
  treeHorizontal: true,
  forceIterations: 300,
  dagRankdir: "LR",
  bulkLinkEdges: true,
  bulkLimit: 100,
  smartSnap: false,
  styleTemplates: [],
  enableNoteSlashMenu: false,
  enableCanvasSlashMenu: true,
  enableTextFormatToolbar: true,
  enableTablePaste: true,
  toolbarPosition: "top",
  savedColors: [],
  enableMindoCardWidget: true,
  mindoDefaultNodeColor: "1",
  mindoMarkNewNodes: true,
  mindoLayoutLevelGapX: 350,
  mindoLayoutSiblingGapY: 40,
};

export class CanvasPlusSettingTab extends PluginSettingTab {
  plugin: CanvasPlusPlugin;

  constructor(app: App, plugin: CanvasPlusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h3", { text: "自动布局" });

    new Setting(containerEl)
      .setName("默认布局算法")
      .setDesc("生成画布 / 批量创建时默认使用的布局")
      .addDropdown((d) => {
        d.addOption("force", "力导向");
        d.addOption("tree", "树形");
        d.addOption("radial", "放射");
        d.addOption("dag", "流程图");
        d.setValue(this.plugin.settings.defaultLayout);
        d.onChange(async (v) => {
          this.plugin.settings.defaultLayout = v as any;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("树形横向")
      .setDesc("树形布局默认横向（根在左）")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.treeHorizontal);
        t.onChange(async (v) => {
          this.plugin.settings.treeHorizontal = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("力导向迭代次数")
      .setDesc("越大越精细，但越慢（推荐 200-500）")
      .addText((t) => {
        t.setValue(String(this.plugin.settings.forceIterations));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.forceIterations = n;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("流程图方向")
      .addDropdown((d) => {
        d.addOption("LR", "左→右");
        d.addOption("TB", "上→下");
        d.addOption("BT", "下→上");
        d.addOption("RL", "右→左");
        d.setValue(this.plugin.settings.dagRankdir);
        d.onChange(async (v) => {
          this.plugin.settings.dagRankdir = v as any;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "批量操作" });

    new Setting(containerEl)
      .setName("批量建链接边")
      .setDesc("批量创建节点时，根据真实笔记链接关系自动连边")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.bulkLinkEdges);
        t.onChange(async (v) => {
          this.plugin.settings.bulkLinkEdges = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("批量生成上限")
      .setDesc("防止一次拉太多节点")
      .addText((t) => {
        t.setValue(String(this.plugin.settings.bulkLimit));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.bulkLimit = n;
            await this.plugin.saveSettings();
          }
        });
      });


    // -- 交互 --
    containerEl.createEl("h3", { text: "交互" });

    new Setting(containerEl)
      .setName("智能吸附辅助线")
      .setDesc("拖动节点时显示对齐辅助线和间距数值。关闭后拖动更流畅。")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.smartSnap);
        t.onChange(async (v) => {
          this.plugin.settings.smartSnap = v;
          await this.plugin.saveSettings();
        });
      });

    // —— 与其他插件的冲突避让 ——
    containerEl.createEl("h3", { text: "与其他插件的冲突避让" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
    }).innerHTML =
      "本插件与 chinese-slash-format、slash-complete、editing-toolbar、advanced-canvas 等" +
      "插件功能有重叠。重叠处在这里开关（关闭的功能仍保留在代码里，随时可重新打开）。" +
      "改完后需禁用再启用本插件生效。";

    new Setting(containerEl)
      .setName("笔记内斜杠菜单")
      .setDesc("在普通笔记里输入 / 弹出的菜单。若与 chinese-slash-format / slash-complete 等斜杠插件冲突（菜单互相遮挡、回车选不中想要的项），保持关闭")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableNoteSlashMenu);
        t.onChange(async (v) => {
          this.plugin.settings.enableNoteSlashMenu = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("画布节点内斜杠菜单")
      .setDesc("在白板文字节点里输入 / 弹出的菜单（画布内通常没有其他插件覆盖）")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableCanvasSlashMenu);
        t.onChange(async (v) => {
          this.plugin.settings.enableCanvasSlashMenu = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("选中文字的格式工具条")
      .setDesc("选中文字时在选区下方弹出：加粗等基础格式 + 色轮/色条改色 + 字号无级调节。若与 editing-toolbar 等工具条插件冲突可关闭")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableTextFormatToolbar);
        t.onChange(async (v) => {
          this.plugin.settings.enableTextFormatToolbar = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("表格粘贴识别")
      .setDesc("粘贴 Excel/网页表格时自动转成 Markdown 表格（会拦截粘贴事件，与粘贴增强类插件冲突时可关）")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableTablePaste);
        t.onChange(async (v) => {
          this.plugin.settings.enableTablePaste = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("节点工具栏位置")
      .setDesc("选中节点时弹出的工具栏（颜色/字号/对齐）显示位置。挡到内容时可改成节点下方或固定在屏幕顶部")
      .addDropdown((d) => {
        d.addOption("top", "节点上方");
        d.addOption("bottom", "节点下方");
        d.addOption("screen-top", "屏幕顶部固定");
        d.setValue(this.plugin.settings.toolbarPosition);
        d.onChange(async (v) => {
          this.plugin.settings.toolbarPosition = v as any;
          await this.plugin.saveSettings();
          // 立即生效（下一次弹出按新位置）
          if ((this.plugin as any).toolbar) {
            (this.plugin as any).toolbar.positionMode = v;
          }
        });
      });

    new Setting(containerEl)
      .setName("保存的颜色（调色板）")
      .setDesc("工具栏色轮/色条选过的颜色会自动保存在这里（最多 10 个），点工具栏上的色块可一键套用")
      .addButton((b) => {
        b.setButtonText("清空");
        b.onClick(async () => {
          this.plugin.settings.savedColors = [];
          await this.plugin.saveSettings();
          new Notice("已清空保存的颜色");
        });
      });

    new Setting(containerEl)
      .setName("Mindo 卡片组件渲染")
      .setDesc("用 DOM 组件复刻 Mindo 卡片外观（标题头+正文）。若怀疑它干扰原生拖拽（拉连线/拉宽卡片），关闭后测试；改完需重载插件")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableMindoCardWidget);
        t.onChange(async (v) => {
          this.plugin.settings.enableMindoCardWidget = v;
          await this.plugin.saveSettings();
        });
      });

    // —— Mindo 思维导图（整合自 obsidian-mindo-canvas）——
    containerEl.createEl("h3", { text: "Mindo 思维导图" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
    }).innerHTML =
      "子/兄弟节点、思维导图自动布局、色带卡片样式、节点转笔记——" +
      "整合自 Mindo Canvas 插件（可停用原 mindo-canvas 插件避免重复菜单）。";

    new Setting(containerEl)
      .setName("新建节点默认颜色")
      .setDesc('色板索引 "1"-"6"（1=红 2=橙 3=黄 4=绿 5=青 6=紫）。留空用白板默认')
      .addText((t) => {
        t.setValue(this.plugin.settings.mindoDefaultNodeColor);
        t.onChange(async (v) => {
          this.plugin.settings.mindoDefaultNodeColor = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("新建节点自动套 Mindo 卡片样式")
      .setDesc("用命令或原生方式新建的文本节点（# 标题+正文卡片）自动应用色带卡片皮肤")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.mindoMarkNewNodes);
        t.onChange(async (v) => {
          this.plugin.settings.mindoMarkNewNodes = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("布局：父子水平间距")
      .setDesc("思维导图自动布局时父子节点之间的水平距离（px）")
      .addText((t) => {
        t.setValue(String(this.plugin.settings.mindoLayoutLevelGapX));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.mindoLayoutLevelGapX = n;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("布局：兄弟垂直间距")
      .setDesc("同一父节点下相邻兄弟之间的垂直距离（px）")
      .addText((t) => {
        t.setValue(String(this.plugin.settings.mindoLayoutSiblingGapY));
        t.onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.mindoLayoutSiblingGapY = n;
            await this.plugin.saveSettings();
          }
        });
      });

    // —— 字号与快捷键 ——
    containerEl.createEl("h3", { text: "字号调整" });

    const desc = containerEl.createEl("p", {
      cls: "setting-item-description",
    });
    desc.innerHTML =
      "光标放在某段，按快捷键即可调整该段字号（也可用命令面板搜「字号」）。" +
      "标记会以 HTML 注释形式保存在段落前，重开不丢失。<br><br>" +
      "<b>默认快捷键：</b><br>" +
      "Ctrl+Alt+1 = 90%　Ctrl+Alt+2 = 110%　Ctrl+Alt+3 = 125%<br>" +
      "Ctrl+Alt+4 = 150%　Ctrl+Alt+5 = 200%　Ctrl+Alt+0 = 清除<br><br>" +
      "<b>布局快捷键（需打开画布）：</b><br>" +
      "Ctrl+Shift+L = 力导向　Ctrl+Shift+T = 树形　Ctrl+Shift+D = 流程图";

    new Setting(containerEl)
      .setName("打开快捷键设置")
      .setDesc("在 Obsidian 设置中自定义所有 Canvas Plus 快捷键")
      .addButton((b) => {
        b.setButtonText("打开");
        b.onClick(() => {
          // 打开快捷键设置页（Obsidian 内部命令）
          (this.app as any).commands?.executeCommandById?.("setting:open-hotkeys");
        });
      });

    // —— 样式模版管理 ——
    containerEl.createEl("h3", { text: "样式模版" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "在白板里选中节点，用浮动工具条的「存为模版」保存样式。这里可查看和删除已保存的模版。",
    });

    this.renderTemplates();

    // —— 快捷颜色管理 ——
    containerEl.createEl("h3", { text: "快捷颜色" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "在白板浮动工具条的颜色组里点「+」保存常用颜色，这里可查看和删除。",
    });
    this.renderSavedColors();
  }

  /** 渲染模版列表（含删除按钮） */
  private renderTemplates(): void {
    const { containerEl } = this;
    const tpls = this.plugin.settings.styleTemplates || [];

    if (tpls.length === 0) {
      containerEl.createEl("p", {
        text: "（暂无模版。在白板里选中节点 → 浮动工具条 → 「存为模版」即可创建。）",
        cls: "setting-item-description",
      });
      return;
    }

    for (let i = 0; i < tpls.length; i++) {
      const tpl = tpls[i];
      const parts: string[] = [];
      if (tpl.color) parts.push(`颜色 ${tpl.color}`);
      if (tpl.cpTextScale) parts.push(`字号 ${tpl.cpTextScale}×`);
      if (tpl.cpShape) parts.push(`形状 ${tpl.cpShape}`);
      if (tpl.cpSticky) parts.push(`便签 ${tpl.cpSticky}`);
      if (tpl.cpStyle) parts.push(`纯文字`);

      new Setting(containerEl)
        .setName(tpl.name)
        .setDesc(parts.join(" · ") || "（空模版）")
        .addExtraButton((btn) => {
          btn.setIcon("trash")
            .setTooltip("删除")
            .onClick(async () => {
              this.plugin.settings.styleTemplates.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    }
  }

  /** 渲染快捷颜色列表（色块 + 删除） */
  private renderSavedColors(): void {
    const { containerEl } = this;
    const colors = this.plugin.settings.savedColors || [];

    if (colors.length === 0) {
      containerEl.createEl("p", {
        text: "（暂无。在白板工具条颜色组里点「+」即可保存当前颜色。）",
        cls: "setting-item-description",
      });
      return;
    }

    const row = containerEl.createDiv({ cls: "cp-saved-colors-row" });
    for (let i = 0; i < colors.length; i++) {
      const hex = colors[i];
      const wrap = row.createDiv({ cls: "cp-saved-color-item" });
      const swatch = wrap.createDiv({ cls: "cp-saved-color-swatch" });
      swatch.style.background = hex;
      swatch.title = `${hex}（点击删除）`;
      const label = wrap.createEl("span", { text: hex, cls: "cp-saved-color-label" });
      // 点击删除
      wrap.addEventListener("click", async () => {
        this.plugin.settings.savedColors.splice(i, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    }
  }
}
