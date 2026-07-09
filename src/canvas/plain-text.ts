/**
 * 纯文字节点（向后兼容封装）
 *
 * 实际实现已迁移到 node-styles.ts（统一处理 纯文字/形状/便签/字号）。
 * 本文件保留导出，供已 import 它的模块（floating-toolbar.ts 等）使用。
 */
export {
  setupNodeStyles as setupPlainTextStyle,
  applyAllStyles as applyPlainStyles,
  createPlainTextNode,
  togglePlain,
  PLAIN_FLAG,
  PLAIN_VALUE,
} from "./node-styles";

// 这些常量在 node-styles 里叫别的名字，这里转译
import { FLAG_STYLE } from "./node-styles";
export const PLAIN_FLAG_REAL = FLAG_STYLE;
