/**
 * 编辑器扩展汇总
 *
 * 把所有 CM6 扩展聚合成一个数组，供 main.ts 的 registerEditorExtension 使用。
 * 阶段 1B：目前只有 block-fontsize；后续会加 slash-menu / selection-toolbar / block-drag。
 */
import { blockFontsizeExtension } from "./block-fontsize";
import type { Extension } from "@codemirror/state";

export const editorExtensions: Extension[] = [blockFontsizeExtension];
