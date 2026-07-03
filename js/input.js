"use strict";

// =====================================================================
// キーボード入力管理
//  - isDown:      押しっぱなし判定
//  - wasPressed:  このフレームで押された瞬間の判定
//  - wasReleased: このフレームで離された瞬間の判定
// =====================================================================

const HANDLED_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "KeyZ", "KeyX", "KeyC",
  "ShiftLeft", "ShiftRight", "Enter", "Escape",
]);

class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();

    window.addEventListener("keydown", (e) => {
      if (HANDLED_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat && !this.down.has(e.code)) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (HANDLED_KEYS.has(e.code)) e.preventDefault();
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    // フォーカスを失ったら押しっぱなし状態を解除 (キーが張り付くのを防ぐ)
    window.addEventListener("blur", () => this.down.clear());
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }

  // 矢印キーから移動方向の単位ベクトルを得る。入力が無ければ null
  axis() {
    const x = (this.isDown("ArrowRight") ? 1 : 0) - (this.isDown("ArrowLeft") ? 1 : 0);
    const y = (this.isDown("ArrowDown") ? 1 : 0) - (this.isDown("ArrowUp") ? 1 : 0);
    if (x === 0 && y === 0) return null;
    return norm(x, y);
  }

  // 毎フレームの最後に呼び、エッジ判定をリセットする
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
