/**
 * 输入内容检测器（纯函数，不依赖 Obsidian / DOM，可单测）
 *
 * 判定顺序：表格 → 公式 → 代码。返回 null 表示"保持纯文本"。
 */
import hljs from "highlight.js/lib/common";
import { serializeTable } from "./table-text";

export type DetectKind =
  | { kind: "table"; text: string }
  | { kind: "formula"; text: string }
  | { kind: "code"; lang: string };

/**
 * 表格识别（严格版）：至少 2 行 2 列，每行都含 Tab 或都含英文逗号，
 * 且每行分隔出的列数完全一致（防止散文里的逗号误判）。
 */
export function detectTable(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;

  let rows: string[][] | null = null;
  if (lines.every((l) => l.includes("\t"))) rows = lines.map((l) => l.split("\t"));
  else if (lines.every((l) => l.includes(","))) rows = lines.map((l) => l.split(","));
  if (!rows) return null;

  const colCount = Math.max(...rows.map((r) => r.length));
  if (colCount < 2) return null;
  if (!rows.every((r) => r.length === colCount)) return null;
  return serializeTable(rows);
}

/** 常见代码关键字：命中则不按公式处理 */
const CODE_KEYWORDS =
  /\b(const|let|var|int|float|double|char|void|bool|return|if|else|for|while|do|switch|case|break|continue|function|class|struct|enum|import|from|def|print|echo|public|private|protected|static|new|this|null|fn|func|package|namespace|using|std|cout|cin|printf|scanf|include|SELECT|INSERT|UPDATE|DELETE|CREATE|local)\b/;

/** 英文停用词：命中说明更像句子，不按公式处理（单字母 a 除外——它更常是变量） */
const PROSE_WORDS =
  /\b(the|an|is|are|was|were|with|very|normal|sentence|sign|inside|and|or|of|to|in|on|we|you|they|this|that|these|those|there|here|what|when|where|which|who|how|why|please|thanks|hello|world)\b/i;

/** 数学式字符集（含常用数学符号，不含中文和英文句子标点） */
const MATH_CHARSET = /^[A-Za-z0-9\s+\-*/=^_{}().,%!<>|;:'"°²³√π∑∫∞≤≥≠±×÷·∂∇\[\]]+$/;

/** 公式识别：LaTeX 命令 或 纯数学字符 + 含 = ^ _ + 不像句子 */
export function detectFormula(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 600) return false;
  if (CODE_KEYWORDS.test(t)) return false;
  if (/:\/\//.test(t)) return false; // URL
  if (/\\[a-zA-Z]+/.test(t)) return true; // LaTeX 命令（\frac \sum \alpha ...）
  if (PROSE_WORDS.test(t)) return false; // 像英文句子
  if (!MATH_CHARSET.test(t)) return false;
  if (!/[=^_]/.test(t) || !/[A-Za-z]/.test(t)) return false;
  if (/[;{}]|=>|==|&&|\|\||\/\/|#/.test(t)) return false; // 代码特征
  // 长单词太多 = 句子，不是式子（sin/cos/sqrt 这类不算长词）
  const longWords = t.match(/[A-Za-z]{3,}/g) ?? [];
  const mathFns = new Set(["sin", "cos", "tan", "sqrt", "log", "ln", "exp", "abs", "min", "max", "det", "arg", "deg", "lim"]);
  if (longWords.filter((w) => !mathFns.has(w.toLowerCase())).length > 2) return false;
  return true;
}

/** hljs 语言名 → 围栏标识（Obsidian/Prism 习惯用短名） */
const LANG_MAP: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  xml: "html",
  shell: "bash",
  "objective-c": "objectivec",
};

/** 这些"语言"多半是散文误判，不作为代码 */
const IGNORE_LANGS = new Set(["markdown", "plaintext", "ini", "properties"]);

/** auto-detect 限定语言集：缩小候选面，大幅降低误判 */
const LANG_SUBSET = [
  "c", "cpp", "csharp", "css", "java", "javascript", "typescript",
  "python", "rust", "go", "bash", "sql", "lua", "json", "yaml",
  "xml", "php", "ruby", "swift", "kotlin", "scss", "less", "diff",
  "r", "perl", "objectivec", "makefile",
];

/** 代码特征信号（用于单行/弱相关时的兜底确认） */
const CODE_SIGNAL =
  /([;{}]\s*$)|(\b(?:int|float|double|char|void|bool|long|short|unsigned)\s+\w+\s*[=;(])|(^\s*(#include|import\s+[\w"']|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+|function\s*\w*\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|public\s|private\s|fn\s+\w+|func\s+\w+|package\s+\w+|using\s+\w+|SELECT\s|INSERT\s|CREATE\s|local\s+\w+\s*=))|=>|^\s*\/\//m;

/**
 * 关键字强提示识别语言（高精度，优先于 hljs 统计）。
 * 命中即返回，不再看相关性——明确的语言特征比打分可靠。
 */
export function detectLangByHint(text: string): string | null {
  const t = text;
  // 图形方向（hljs 没有 glsl/hlsl，必须靠关键字）
  if (/\b(gl_Position|gl_FragColor|gl_FragCoord|gl_PointSize|texture2D|textureCube|varying|attribute)\b/.test(t)) return "glsl";
  if (/\b(cbuffer|SV_POSITION|SV_Target|float4x4|register\s*\(\s*b\d|tex2D\s*\()/i.test(t)) return "hlsl";
  if (/\buniform\s+(sampler|vec|mat|float|int)\b/.test(t)) return "glsl";
  // C / C++
  if (/^\s*#\s*include\s*[<"]/m.test(t)) return /\bstd::|\bcout\b|\bcin\b|\bnamespace\b/.test(t) ? "cpp" : "c";
  if (/\bstd::|\bcout\b|\bcin\b/.test(t)) return "cpp";
  // Python
  if (/^\s*def\s+\w+\s*\(/m.test(t)) return "python";
  if (/^\s*from\s+\w+\s+import\s/m.test(t)) return "python";
  if (/^\s*import\s+[\w.]+$/m.test(t) && !/from\s*['"]/.test(t)) return "python";
  if (/^\s*print\s*\(/m.test(t) && !/[{;]/.test(t)) return "python";
  // Python
  if (/^\s*def\s+\w+\s*\(/m.test(t)) return "python";
  if (/^\s*from\s+\w+\s+import\s/m.test(t)) return "python";
  if (/^\s*import\s+[\w.]+$/m.test(t) && !/from\s*['"]/.test(t)) return "python";
  if (/^\s*print\s*\(/m.test(t) && !/[{;]/.test(t)) return "python";
  // Rust / Go / Java / C#（在 C 家族泛型规则之前，避免被 void main( 抢走）
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|\bprintln!\s*\(|\bmatch\s+\w+\s*\{/.test(t)) return "rust";
  if (/^\s*package\s+\w+/m.test(t) || /\bfunc\s+\w+\s*\(|\bfmt\.Print/.test(t)) return "go";
  if (/\bpublic\s+(static\s+)?(class|void)\b|\bSystem\.out\.print/.test(t)) return "java";
  if (/\bnamespace\s+\w+\s*\{|\busing\s+System\b/.test(t)) return "csharp";
  // SQL / HTML / Shell / Lua（Lua 在 JS function 规则之前）
  if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|DATABASE))\b/i.test(t)) return "sql";
  if (/<\/?(html|div|span|p|a|img|head|body|ul|ol|li|table|script|style|section|h[1-6])\b[^>]*>/i.test(t)) return "html";
  if (/^\s*(#!\/|echo\s+['"]|cd\s+~|ls\s+-|mkdir\s+-|sudo\s+\w+|npm\s+(install|run)|git\s+(add|commit|push|pull|clone))/m.test(t)) return "bash";
  if (/^\s*local\s+\w+\s*=|\bfunction\s*\(\s*\.\.\.\s*\)|\bend\s*$/.test(t)) return "lua";
  // JS / TS
  if (/\bconsole\.log\b|=>|\brequire\s*\(|\bmodule\.exports\b/.test(t)) return /:\s*(string|number|boolean|any)\b/.test(t) ? "ts" : "js";
  if (/^\s*(export\s+)?(async\s+)?function\s*\w*\s*\(/m.test(t)) return "js";
  if (/^\s*(const|let|var)\s+\w+\s*=/m.test(t)) return /:\s*(string|number|boolean|any)\b/.test(t) ? "ts" : "js";
  // 类型声明（C 家族，兜底）：int x = ... / void foo(
  if (/\b(?:int|float|double|char|void|bool|long|short|unsigned)\s+\w+\s*\(/.test(t)) return "c";
  if (/\b(?:int|float|double|char|void|bool|long|short|unsigned)\s+\w+\s*=/.test(t)) return "cpp";
  return null;
}

/**
 * 代码识别：先关键字强提示，再 highlight.js auto-detect（限定语言集）。
 * 返回围栏语言标识，不像代码返回 null。
 */
export function detectCode(text: string): string | null {
  const t = text.trim();
  if (t.length < 6) return null;

  // 1. 强提示直接定语言
  const hint = detectLangByHint(t);
  if (hint) return hint;

  // 2. hljs 统计识别
  let result: ReturnType<typeof hljs.highlightAuto>;
  try {
    result = hljs.highlightAuto(t, LANG_SUBSET);
  } catch {
    return null;
  }
  const lang = result.language;
  const relevance = result.relevance ?? 0;
  if (!lang || IGNORE_LANGS.has(lang)) return null;
  if (lang === "xml" && !/</.test(t)) return null;

  const lineCount = t.split("\n").filter((l) => l.trim() !== "").length;
  // 单行需要更强的证据
  if (lineCount < 2) {
    if (relevance >= 10) return LANG_MAP[lang] ?? lang;
    if (relevance >= 4 && CODE_SIGNAL.test(t)) return LANG_MAP[lang] ?? lang;
    return null;
  }
  // 多行：相关性达标，或弱相关但有明显代码信号
  if (relevance >= 6) return LANG_MAP[lang] ?? lang;
  if (relevance >= 3 && CODE_SIGNAL.test(t)) return LANG_MAP[lang] ?? lang;
  return null;
}

/** 综合判定：表格 → 公式 → 代码；都不是返回 null */
export function detectContent(text: string): DetectKind | null {
  const t = text.trim();
  if (t.length < 2) return null;
  const table = detectTable(t);
  if (table) return { kind: "table", text: table };
  if (detectFormula(t)) return { kind: "formula", text: `$$\n${t}\n$$` };
  const lang = detectCode(t);
  if (lang) return { kind: "code", lang };
  return null;
}
