/**
 * 插件设置
 */
import { App, PluginSettingTab, Setting } from "obsidian";
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
}

export const DEFAULT_SETTINGS: CanvasPlusSettings = {
  defaultLayout: "force",
  treeHorizontal: true,
  forceIterations: 300,
  dagRankdir: "LR",
  bulkLinkEdges: true,
  bulkLimit: 100,
  smartSnap: false,
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
  }
}
