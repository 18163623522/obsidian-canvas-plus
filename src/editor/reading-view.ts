/**
 * Reading view 的字号标记处理
 *
 * Live Preview 由 CM6 ViewPlugin 负责；Reading view 是渲染后的 DOM，
 * 需要用 MarkdownPostProcessor 找到 <!--cp:size:NN--> 注释并给后续块套样式。
 *
 * Obsidian 把 HTML 注释渲染成隐藏的 <span> 或直接丢弃，行为不稳定。
 * 更可靠的做法：在渲染前用 registerMarkdownPostProcessor 找到含注释文本的节点。
 *
 * 简化方案：扫描所有文本节点，若发现 <!--cp:size:NN--> 则给后续兄弟节点套
 * 内联 font-size，直到下一个空段或下一个标记。
 */
import { MarkdownPostProcessorContext } from "obsidian";

const MARKER_RE = /<!--cp:size:(\d+)-->/;

export function readingViewFontsizeProcessor(
  el: HTMLElement,
  _ctx: MarkdownPostProcessorContext
): void {
  // 遍历直接子元素（段落、标题等块级元素）
  const children = Array.from(el.children);
  let currentSize = 0;
  for (const child of children) {
    const text = child.textContent ?? "";
    const m = text.match(MARKER_RE);
    if (m) {
      currentSize = parseInt(m[1], 10);
      // 标记节点本身隐藏（注释通常不渲染，但保险）
      (child as HTMLElement).style.display = "none";
      continue;
    }
    if (currentSize > 0) {
      (child as HTMLElement).style.fontSize = `${currentSize}%`;
    }
    // 空段重置
    if (text.trim() === "") currentSize = 0;
  }
}
