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
  const statsLine = document.getElementById("stats-line");
  const resultText = document.getElementById("result-text");
  const resultScore = document.getElementById("result-score");
  const touchControls = document.getElementById("touch-controls");
  const touchBtnZ = document.getElementById("touch-btn-z");
  const touchBtnX = document.getElementById("touch-btn-x");

  // 味方 GK がボールを保持している間だけ、Z/X ボタンの表示を
  // 「ショート/ロング」キックに切替える (それ以外は常にパス・シュート/スラ表記)。
  // PK戦のコース選択中は Z を使わないので隠し、X は「決定」表記にする
  function updateTouchLabels() {
    if (!touchBtnZ || !touchBtnX || !game) return;
    if (game.state === "pk" && game.pk && game.pk.phase === "aim") {
      touchBtnZ.textContent = "-";
      touchBtnX.textContent = "決定";
      return;
    }
    const gkHolding = game.ball.owner === game.controlled &&
      game.controlled && game.controlled.isGK;
    touchBtnZ.textContent = gkHolding ? "ショート" : "パス/スラ";
    touchBtnX.textContent = gkHolding ? "ロング" : "シュート/スラ";
  }

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
    updateStatsLine();
    showScreen("menu");
  }

  // 通算成績をタイトル画面に表示する (試合が1度も無ければ何も表示しない)
  function updateStatsLine() {
    if (!statsLine) return;
    const r = Settings.data.record;
    const total = r.wins + r.losses + r.draws;
    if (total === 0) {
      statsLine.textContent = "";
      return;
    }
    let text = `通算成績 ${r.wins}勝 ${r.losses}敗 ${r.draws}分`;
    if (r.streak > 0) text += `　現在 ${r.streak}連勝`;
    if (r.bestStreak > 1) text += ` (最高 ${r.bestStreak}連勝)`;
    statsLine.textContent = text;
  }

  // 試合結果を通算成績に反映する (完走した試合だけが対象。途中でタイトルへ
  // 戻った場合はここを通らないのでカウントされない)
  function updateRecord(won, lost) {
    const r = Settings.data.record;
    if (won) {
      r.wins++;
      r.streak++;
      r.bestStreak = Math.max(r.bestStreak, r.streak);
    } else if (lost) {
      r.losses++;
      r.streak = 0;
    } else {
      r.draws++;
      r.streak = 0;
    }
    Settings.save();
  }

  // タッチ操作端末では、ブラウザのアドレスバー等に画面を圧迫されないよう
  // 試合開始と同時に全画面表示を試みる (対応していない/拒否された場合は無視)
  function requestFullscreenIfTouch() {
    if (!matchMedia("(pointer: coarse)").matches) return;
    if (document.fullscreenElement) return;   // 既に全画面なら何もしない
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return;
    const result = fn.call(el);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  // 手動での全画面トグル (タイトル画面からでも使える固定ボタン)
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      (document.exitFullscreen || (() => {})).call(document);
      return;
    }
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return;
    const result = fn.call(el);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }
  const touchFullscreenBtn = document.getElementById("touch-fullscreen");
  if (touchFullscreenBtn) touchFullscreenBtn.addEventListener("click", toggleFullscreen);

  function startMatch() {
    requestFullscreenIfTouch();
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
    let resultLine = game.userTeam.name + "  " + us + " - " + them + "  " + game.cpuTeam.name;
    let won, lost;
    if (game.pk) {
      resultLine += `  (PK ${game.pk.userScore}-${game.pk.cpuScore})`;
      won = game.pk.userScore > game.pk.cpuScore;
      lost = game.pk.cpuScore > game.pk.userScore;
    } else {
      won = us > them;
      lost = us < them;
    }
    resultScore.textContent = resultLine;
    resultText.textContent = won ? (game.pk ? "PK勝利！" : "勝利！")
      : lost ? (game.pk ? "PK敗退…" : "敗北…") : "引き分け";
    updateRecord(won, lost);
    showScreen("result");
  }

  // ---------------- ボタン ----------------

  document.getElementById("btn-start").addEventListener("click", startMatch);
  document.getElementById("btn-resume").addEventListener("click", () => {
    requestFullscreenIfTouch();
    paused = false;
    showScreen(null);
  });
  document.getElementById("btn-quit").addEventListener("click", showTitle);
  document.getElementById("btn-secondhalf").addEventListener("click", () => {
    requestFullscreenIfTouch();
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
      updateTouchLabels();
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
