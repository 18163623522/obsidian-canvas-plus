/**
 * 代码语言选择浮层
 *
 * 自动识别为代码后弹出：检测结果已预选，点常用芯片或下拉即改，
 * 点别处/Esc 关闭并保持现状。只改围栏上的语言标识，不碰代码内容。
 */
import { CODE_LANGS } from "./slash-completions";

/** 常用语言芯片（一键点选） */
const HOT_LANGS = ["c", "cpp", "python", "js", "ts", "glsl", "hlsl", "java", "rust", "go"];

export function openCodeLangPicker(
  x: number,
  y: number,
  current: string,
  onPick: (lang: string) => void
): void {
  let done = false;
  const popup = document.body.createDiv({ cls: "cp-lang-picker" });
  popup.createDiv({ cls: "cp-lang-picker-label", text: `已识别为代码 · 语言：${current || "纯文本"}` });

  // 常用语言芯片
  const chips = popup.createDiv({ cls: "cp-lang-picker-chips" });
  for (const lang of HOT_LANGS) {
    const chip = chips.createEl("button", {
      cls: "cp-lang-chip" + (lang === current ? " is-current" : ""),
      text: lang,
    });
    chip.onclick = (e) => {
      e.stopPropagation();
      finish(lang);
    };
  }

  // 完整语言下拉
  const select = popup.createEl("select", { cls: "cp-lang-picker-select" });
  const known = CODE_LANGS.map((l) => l.lang);
  const options = ["", ...(known.includes(current) ? known : [current, ...known])];
  for (const l of options) {
    select.createEl("option", { value: l, text: l === "" ? "text（纯文本）" : l });
  }
  select.value = current;
  select.onchange = () => finish(select.value);

  // 定位（防出屏）
  const w = 220;
  popup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 120))}px`;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };
  const onDown = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node)) cancel();
  };
  setTimeout(() => {
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
  }, 0);

  function cleanup() {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    popup.remove();
  }
  function finish(lang: string) {
    if (done) return;
    done = true;
    cleanup();
    onPick(lang);
  }
  function cancel() {
    if (done) return;
    done = true;
    cleanup();
  }
}
