"use strict";

// =====================================================================
// エントリポイント: 画面 (タイトル / ポーズ / ハーフタイム / リザルト) の
// 切替とメインループを管理する
// =====================================================================

// PWA: オフラインでも起動できるよう Service Worker を登録する
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* file:// 直開きなど登録できない環境では黙って諦める */
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game");
  const input = new Input();
  setupTouchControls(input);
  window.__input = input;   // デバッグ/動作確認用に入力状態を公開
  const camera = new Camera(canvas);
  const renderer = new Renderer(canvas, camera);

  const screens = {
    menu: document.getElementById("screen-menu"),
    pause: document.getElementById("screen-pause"),
    halftime: document.getElementById("screen-halftime"),
    result: document.getElementById("screen-result"),
  };
  const selHalf = document.getElementById("sel-half");
  const selDiff = document.getElementById("sel-diff");
  const resultText = document.getElementById("result-text");
  const resultScore = document.getElementById("result-score");
  const touchControls = document.getElementById("touch-controls");

  let game = null;
  let paused = false;

  // ---------------- 画面切替 ----------------

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle("visible", key === name);
    }
    // タイトル/ポーズ/ハーフタイム/リザルト画面ではタッチ操作を隠す
    // (プレー中 = showScreen(null) のときだけ表示する)
    if (touchControls) touchControls.classList.toggle("hide-touch", name !== null);
  }

  function showTitle() {
    game = null;
    paused = false;
    Settings.load();
    selHalf.value = String(Settings.data.halfLengthMin);
    selDiff.value = Settings.data.difficulty;
    showScreen("menu");
  }

  function startMatch() {
    Settings.data.halfLengthMin = Number(selHalf.value);
    Settings.data.difficulty = selDiff.value;
    Settings.save();
    game = new Game(Settings.data);
    paused = false;
    camera.pos = { x: 0, y: 0 };
    showScreen(null);
    window.__game = game;   // デバッグ/動作確認用に現在の試合状態を公開
  }

  function showResult() {
    const [us, them] = game.score;
    resultScore.textContent =
      game.userTeam.name + "  " + us + " - " + them + "  " + game.cpuTeam.name;
    resultText.textContent = us > them ? "勝利！" : us < them ? "敗北…" : "引き分け";
    showScreen("result");
  }

  // ---------------- ボタン ----------------

  document.getElementById("btn-start").addEventListener("click", startMatch);
  document.getElementById("btn-resume").addEventListener("click", () => {
    paused = false;
    showScreen(null);
  });
  document.getElementById("btn-quit").addEventListener("click", showTitle);
  document.getElementById("btn-secondhalf").addEventListener("click", () => {
    game.startSecondHalf();
    showScreen(null);
  });
  document.getElementById("btn-result-title").addEventListener("click", showTitle);

  // ---------------- メインループ ----------------

  let lastTime = performance.now();

  function frame(now) {
    const dt = clamp((now - lastTime) / 1000, 0, 1 / 20);
    lastTime = now;

    if (game) {
      // Esc でポーズ切替 (ハーフタイム・試合終了画面では無効)
      if (input.wasPressed("Escape") &&
          game.state !== "halftime" && game.state !== "fulltime") {
        paused = !paused;
        showScreen(paused ? "pause" : null);
      }

      if (!paused) {
        const stateBefore = game.state;
        game.update(dt, input);

        if (game.state === "halftime" && stateBefore !== "halftime") {
          showScreen("halftime");
        } else if (game.state === "fulltime" && stateBefore !== "fulltime") {
          showResult();
        }
        // Enter でもハーフタイムから後半へ進める
        if (game.state === "halftime" && input.wasPressed("Enter")) {
          game.startSecondHalf();
          showScreen(null);
        }
      }
      camera.update(dt, game);
    } else if (input.wasPressed("Enter")) {
      startMatch();
    }

    renderer.draw(game);
    input.endFrame();
    requestAnimationFrame(frame);
  }

  showTitle();
  requestAnimationFrame(frame);
});
