"use strict";

// =====================================================================
// タッチ操作: 仮想ジョイスティック + アクションボタン
//
// Input クラスの setTouchAxis / buttonDown / buttonUp を呼ぶだけで、
// キーボードと全く同じ down/pressed/released を共有する (js/input.js 参照)。
// マウス/トラックパッドのデスクトップでは要素が非表示 (CSS) になるだけで、
// イベント自体は張っても害はないため常時セットアップする。
// =====================================================================

function setupTouchControls(input) {
  const stickBase = document.getElementById("touch-stick-base");
  const stickKnob = document.getElementById("touch-stick-knob");
  if (!stickBase || !stickKnob) return;   // 要素が無ければ何もしない

  const STICK_RADIUS = 40;   // ノブが動ける半径 (px)
  const DEADZONE = 8;        // これ未満の移動は入力なし扱い

  let stickTouchId = null;
  let stickCenter = { x: 0, y: 0 };

  function stickMove(touch) {
    let dx = touch.clientX - stickCenter.x;
    let dy = touch.clientY - stickCenter.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {
      dx = (dx / d) * STICK_RADIUS;
      dy = (dy / d) * STICK_RADIUS;
    }
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.setTouchAxis(d < DEADZONE ? null : norm(dx, dy));
  }

  function stickEnd() {
    stickTouchId = null;
    stickKnob.style.transform = "translate(0, 0)";
    input.setTouchAxis(null);
  }

  stickBase.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (stickTouchId !== null) return;   // 既に別指で操作中なら無視
    const rect = stickBase.getBoundingClientRect();
    stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const touch = e.changedTouches[0];
    stickTouchId = touch.identifier;
    stickMove(touch);
  }, { passive: false });

  // ---- アクションボタン (Z/X/C/Space/Esc) ----
  const buttonTouches = new Map();   // touch identifier -> { el, code }

  for (const el of document.querySelectorAll(".touch-btn[data-code]")) {
    const code = el.dataset.code;
    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        buttonTouches.set(t.identifier, { el, code });
        el.classList.add("pressed");
        input.buttonDown(code);
      }
    }, { passive: false });
  }

  // ---- 共通の移動・終了処理 (window レベルで拾う) ----
  window.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) {
        e.preventDefault();
        stickMove(t);
      }
    }
  }, { passive: false });

  function handleTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) stickEnd();

      const btn = buttonTouches.get(t.identifier);
      if (btn) {
        btn.el.classList.remove("pressed");
        input.buttonUp(btn.code);
        buttonTouches.delete(t.identifier);
      }
    }
  }
  window.addEventListener("touchend", handleTouchEnd, { passive: false });
  window.addEventListener("touchcancel", handleTouchEnd, { passive: false });
}
