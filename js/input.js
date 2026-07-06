"use strict";

// =====================================================================
// 入力管理 (キーボード + タッチ)
//  - isDown:      押しっぱなし判定
//  - wasPressed:  このフレームで押された瞬間の判定
//  - wasReleased: このフレームで離された瞬間の判定
//  - axis():      移動方向。タッチジョイスティックが有効ならそちらを優先し、
//                  無ければ矢印キーの組み合わせ (8方向) から computed する
//
// タッチ操作 (js/touch.js) は buttonDown/buttonUp/setTouchAxis を呼ぶだけで、
// キーボードと全く同じ down/pressed/released を共有するため、
// ゲーム側のロジック (match.js など) は入力元を意識しなくてよい。
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
    this.touchAxis = null;   // タッチジョイスティックのベクトル (null = 無効)

    window.addEventListener("keydown", (e) => {
      if (HANDLED_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this._press(e.code);
    });
    window.addEventListener("keyup", (e) => {
      if (HANDLED_KEYS.has(e.code)) e.preventDefault();
      this._release(e.code);
    });
    // フォーカスを失ったら押しっぱなし状態を解除 (キーが張り付くのを防ぐ)
    window.addEventListener("blur", () => {
      this.down.clear();
      this.touchAxis = null;
    });
  }

  _press(code) {
    if (!this.down.has(code)) {
      this.down.add(code);
      this.pressed.add(code);
    }
  }

  _release(code) {
    this.down.delete(code);
    this.released.add(code);
  }

  // ---- タッチ操作 (js/touch.js) から呼ばれる公開API ----
  buttonDown(code) { this._press(code); }
  buttonUp(code) { this._release(code); }
  // vec: {x,y} の単位〜非単位ベクトル。null で解除 (キーボード判定に戻す)
  setTouchAxis(vec) { this.touchAxis = vec; }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }

  // 移動方向の単位ベクトルを得る。入力が無ければ null
  axis() {
    if (this.touchAxis) return this.touchAxis;
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
