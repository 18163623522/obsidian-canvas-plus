/**
 * 表格格子选择器
 *
 * 弹出一个 8×6 的小网格，鼠标划过拖选行列，点击确认。
 * 只负责交互，产物由调用方用 tableMarkdown() 生成。
 */

export function openTableGridPicker(
  x: number,
  y: number,
  onPick: (cols: number, rows: number) => void
): void {
  const MAX_C = 8;
  const MAX_R = 6;
  let curC = 1;
  let curR = 1;
  let done = false;

  const popup = document.body.createDiv({ cls: "cp-grid-picker" });
  const label = popup.createDiv({ cls: "cp-grid-picker-label" });
  const grid = popup.createDiv({ cls: "cp-grid-picker-grid" });
  grid.style.gridTemplateColumns = `repeat(${MAX_C}, 18px)`;

  const cells: HTMLElement[] = [];
  for (let r = 1; r <= MAX_R; r++) {
    for (let c = 1; c <= MAX_C; c++) {
      const cell = grid.createDiv({ cls: "cp-grid-picker-cell" });
      cell.dataset.c = String(c);
      cell.dataset.r = String(r);
      cell.onmouseenter = () => {
        curC = c;
        curR = r;
        update();
      };
      cell.onclick = (e) => {
        e.stopPropagation();
        finish(c, r);
      };
      cells.push(cell);
    }
  }

  function update() {
    label.textContent = `${curC} 列 × ${curR} 行`;
    for (const cell of cells) {
      const c = Number(cell.dataset.c);
      const r = Number(cell.dataset.r);
      cell.classList.toggle("is-active", c <= curC && r <= curR);
    }
  }
  update();

  // 定位（防出屏）
  popup.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  popup.style.top = `${Math.min(y, window.innerHeight - 180)}px`;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };
  const onDown = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node)) cancel();
  };
  // 延迟挂全局监听，避免触发本次点击
  setTimeout(() => {
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
  }, 0);

  function cleanup() {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    popup.remove();
  }
  function finish(c: number, r: number) {
    if (done) return;
    done = true;
    cleanup();
    onPick(c, r);
  }
  function cancel() {
    if (done) return;
    done = true;
    cleanup();
  }
}
