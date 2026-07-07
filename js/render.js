"use strict";

// =====================================================================
// 描画: ボール追従カメラ + ピッチ / 選手(ドット絵) / ボール / HUD / ミニマップ
//
// 選手は 16x16 のピクセルスプライトで描画する。
// 状態に応じてポーズが切り替わる:
//   stand / walk1 / walk2 : 待機・走行 (2フレームアニメ)
//   kick   : パス・シュートの蹴り足 (kickAnim タイマー中)
//   tackle : 脚を出す (カット)
//   charge : 体をぶつける (肩から突進)
//   slide  : スライディング (進行方向に回転させて描く)
//   転倒 (stumble/getup) : slide スプライトを横倒しで流用
// =====================================================================

// ---- スプライト定義 ----
// 記号: H=髪 S=肌 J=ユニフォーム P=パンツ L=ソックス B=シューズ .=透過
// アクションポーズは「右向き」で描いてあり、左向きは左右反転する

const SPRITE_GRIDS = {
  stand: [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....SSSSSS.....",
    ".....SSSSSS.....",
    "......SSSS......",
    "....JJJJJJJJ....",
    "...JJJJJJJJJJ...",
    "...SJJJJJJJJS...",
    "...SJJJJJJJJS...",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    ".....LL..LL.....",
    ".....LL..LL.....",
    ".....LL..LL.....",
    ".....BB..BB.....",
  ],
  walk1: [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....SSSSSS.....",
    ".....SSSSSS.....",
    "......SSSS......",
    "....JJJJJJJJ....",
    "...JJJJJJJJJJ...",
    "...SJJJJJJJJS...",
    "...SJJJJJJJJS...",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    "....LL....LL....",
    "....LL....LL....",
    "...LL......LL...",
    "...BB......BB...",
  ],
  walk2: [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....SSSSSS.....",
    ".....SSSSSS.....",
    "......SSSS......",
    "....JJJJJJJJ....",
    "...JJJJJJJJJJ...",
    "...SJJJJJJJJS...",
    "...SJJJJJJJJS...",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    "......LLLL......",
    "......LLLL......",
    "......LLLL......",
    "......BBBB......",
  ],
  // パス・シュート: 蹴り足を前方 (右) へ振り抜く
  kick: [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....SSSSSS.....",
    ".....SSSSSS.....",
    "......SSSS......",
    "....JJJJJJJJ....",
    "...JJJJJJJJJJ...",
    "...SJJJJJJJJS...",
    "...SJJJJJJJJS...",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "....PPPPPPLLLL..",
    ".....LL....LLBB.",
    ".....LL.........",
    ".....LL.........",
    ".....BB.........",
  ],
  // 脚を出す (カット): 腰を落として足先を低く前へ伸ばす
  tackle: [
    "................",
    "................",
    "......HHHH......",
    ".....HHHHHH.....",
    ".....SSSSSS.....",
    ".....SSSSSS.....",
    "......SSSS......",
    "....JJJJJJJJ....",
    "...JJJJJJJJJJ...",
    "...SJJJJJJJJS...",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "....PPPPPPLL....",
    ".....LL....LLLL.",
    ".....LL......BB.",
    ".....BB.........",
  ],
  // 体をぶつける: 前傾して肩から当たる
  charge: [
    "................",
    ".......HHHH.....",
    "......HHHHHH....",
    "......SSSSSS....",
    ".......SSSS.....",
    "....JJJJJJJJJ...",
    "...JJJJJJJJJJS..",
    "...JJJJJJJJJJSS.",
    "...SJJJJJJJJJ...",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "...PPPPPPPP.....",
    "....LL...LL.....",
    "...LL....LL.....",
    "...LL.....LL....",
    "...BB.....BB....",
  ],
  // スライディング: 両腕を広げ脚を伸ばした姿勢。進行方向へ回転させて使う
  slide: [
    "......HHHH......",
    ".....HHHHHH.....",
    ".....SSSSSS.....",
    ".....SSSSSS.....",
    "......SSSS......",
    "....JJJJJJJJ....",
    "..JJJJJJJJJJJJ..",
    "..SSJJJJJJJJSS..",
    "..SS.JJJJJJ.SS..",
    "....JJJJJJJJ....",
    "....PPPPPPPP....",
    "....PPPPPPPP....",
    ".....LL..LL.....",
    ".....LL..LL.....",
    ".....LL..LL.....",
    ".....BB..BB.....",
  ],
};

const SPRITE_SIZE = 16;
// チームカラー以外の共通パレット
const SPRITE_BASE_COLORS = {
  H: "#2b1f14",
  S: "#f0c493",
  P: "#f5f5f5",
  B: "#1e1e1e",
};

class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.pos = { x: 0, y: 0 };
    this.scale = 12;   // 1m あたりのピクセル数 (960x540 → 80m x 45m を表示)
  }

  update(dt, game) {
    const b = game.ball;
    // ボールの少し先を映す
    const target = { x: b.pos.x + b.vel.x * 0.25, y: b.pos.y + b.vel.y * 0.25 };
    const k = 1 - Math.exp(-4 * dt);
    this.pos.x += (target.x - this.pos.x) * k;
    this.pos.y += (target.y - this.pos.y) * k;

    // ピッチ外を映しすぎないようにクランプ
    const hw = this.canvas.width / 2 / this.scale;
    const hh = this.canvas.height / 2 / this.scale;
    const mx = Math.max(0, PITCH.HALF_LEN + 5 - hw);
    const my = Math.max(0, PITCH.HALF_WID + 5 - hh);
    this.pos.x = clamp(this.pos.x, -mx, mx);
    this.pos.y = clamp(this.pos.y, -my, my);
  }

  sx(x) { return (x - this.pos.x) * this.scale + this.canvas.width / 2; }
  sy(y) { return (y - this.pos.y) * this.scale + this.canvas.height / 2; }
}

class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = camera;
    this.spriteCache = new Map();   // "jersey|dark" → { stand: canvas, ... }
    this.now = 0;
  }

  // チームカラーごとにスプライト一式をオフスクリーン生成してキャッシュする
  getSprites(jersey, dark) {
    const key = jersey + "|" + dark;
    let set = this.spriteCache.get(key);
    if (set) return set;

    set = {};
    for (const [name, grid] of Object.entries(SPRITE_GRIDS)) {
      const cv = document.createElement("canvas");
      cv.width = SPRITE_SIZE;
      cv.height = SPRITE_SIZE;
      const c = cv.getContext("2d");
      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[row].length; col++) {
          const ch = grid[row][col];
          if (ch === ".") continue;
          c.fillStyle = ch === "J" ? jersey : ch === "L" ? dark
            : SPRITE_BASE_COLORS[ch] || "#f0f";
          c.fillRect(col, row, 1, 1);
        }
      }
      set[name] = cv;
    }
    this.spriteCache.set(key, set);
    return set;
  }

  draw(game) {
    const ctx = this.ctx;
    this.now = performance.now();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawPitch();
    if (!game) return;

    // 奥行き感を出すため y 順に描画
    const players = game.allPlayers().slice().sort((a, b) => a.pos.y - b.pos.y);
    for (const p of players) this.drawPlayer(p, game);
    this.drawBall(game);
    this.drawHud(game);
  }

  // ---------------- ピッチ ----------------

  drawPitch() {
    const ctx = this.ctx, cam = this.cam, s = cam.scale;
    // ベースの芝
    ctx.fillStyle = "#2e7d3a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 縞模様 (world 座標で 7m 間隔)
    const leftW = cam.pos.x - this.canvas.width / 2 / s;
    const rightW = cam.pos.x + this.canvas.width / 2 / s;
    ctx.fillStyle = "#338a42";
    for (let bx = Math.floor(leftW / 7) * 7; bx < rightW; bx += 7) {
      if (((Math.round(bx / 7) % 2) + 2) % 2 === 0) {
        ctx.fillRect(cam.sx(bx), 0, 7 * s, this.canvas.height);
      }
    }

    // ライン
    const L = PITCH.HALF_LEN, W = PITCH.HALF_WID;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;

    ctx.strokeRect(cam.sx(-L), cam.sy(-W), PITCH.LENGTH * s, PITCH.WIDTH * s);
    // ハーフウェーライン・センターサークル
    ctx.beginPath();
    ctx.moveTo(cam.sx(0), cam.sy(-W));
    ctx.lineTo(cam.sx(0), cam.sy(W));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cam.sx(0), cam.sy(0), PITCH.CENTER_CIRCLE_R * s, 0, Math.PI * 2);
    ctx.stroke();

    for (const side of [-1, 1]) {
      const gx = side * L;
      // ペナルティエリア
      ctx.strokeRect(
        cam.sx(Math.min(gx, gx - side * PITCH.PENALTY_DEPTH)),
        cam.sy(-PITCH.PENALTY_HALF_WIDTH),
        PITCH.PENALTY_DEPTH * s, PITCH.PENALTY_HALF_WIDTH * 2 * s);
      // ゴールエリア
      ctx.strokeRect(
        cam.sx(Math.min(gx, gx - side * PITCH.GOAL_AREA_DEPTH)),
        cam.sy(-PITCH.GOAL_AREA_HALF_WIDTH),
        PITCH.GOAL_AREA_DEPTH * s, PITCH.GOAL_AREA_HALF_WIDTH * 2 * s);
      // ゴール (ラインの外側にネットを描く)
      const nx = cam.sx(Math.min(gx, gx + side * PITCH.GOAL_DEPTH));
      const ny = cam.sy(-PITCH.GOAL_HALF);
      ctx.fillStyle = "rgba(240,240,240,0.25)";
      ctx.fillRect(nx, ny, PITCH.GOAL_DEPTH * s, PITCH.GOAL_HALF * 2 * s);
      ctx.strokeStyle = "#f5f5f5";
      ctx.lineWidth = 3;
      ctx.strokeRect(nx, ny, PITCH.GOAL_DEPTH * s, PITCH.GOAL_HALF * 2 * s);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
    }

    // センタースポット
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cam.sx(0), cam.sy(0), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------- 選手 (ドット絵) ----------------

  drawPlayer(p, game) {
    const ctx = this.ctx, cam = this.cam, s = cam.scale;
    const x = cam.sx(p.pos.x), y = cam.sy(p.pos.y);
    const cell = s * 0.115;               // スプライト1ドットのピクセルサイズ
    const w = SPRITE_SIZE * cell, h = SPRITE_SIZE * cell;
    const jersey = p.isGK ? p.team.colors.gk : p.team.colors.main;
    const sprites = this.getSprites(jersey, p.team.colors.dark);

    // 影 (足元)
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + cell * 2, w * 0.32, cell * 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 操作中マーカー (足元のリング)
    if (p === game.controlled) {
      ctx.strokeStyle = "#ffe14d";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y + cell * 2, w * 0.42, cell * 2.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ダイレクトシュートの入力窓: 受け手を光らせる
    if (p === game.controlled && game.volley && game.volley.active) {
      const pulse = 0.65 + 0.35 * Math.sin(this.now / 28);
      const grad = ctx.createRadialGradient(x, y - h * 0.35, 2, x, y - h * 0.35, w * 0.9);
      grad.addColorStop(0, "rgba(255,250,170," + (0.55 * pulse) + ")");
      grad.addColorStop(1, "rgba(255,250,170,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y - h * 0.35, w * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,190," + pulse + ")";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y - h * 0.35, w * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 状態からスプライトと回転を決める
    let img, rot = null;
    if (p.state === "slide") {
      img = sprites.slide;
      // 足が進行方向を向くように回転させる
      const a = Math.atan2(p.slideDir.y, p.slideDir.x);
      rot = a - Math.PI / 2;
    } else if (p.state === "stumble" || p.state === "getup") {
      img = sprites.slide;   // 横倒し = 転倒
      rot = p.facing.x >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else if (p.state === "tackle") {
      img = sprites.tackle;
    } else if (p.state === "charge") {
      img = sprites.charge;
    } else if (p.kickAnim > 0) {
      img = sprites.kick;
    } else if (vlen(p.vel) > 1.5) {
      // 走行アニメ (選手ごとに位相をずらす)
      img = Math.floor(this.now / 140 + p.num * 7) % 2 === 0
        ? sprites.walk1 : sprites.walk2;
    } else {
      img = sprites.stand;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (rot !== null) {
      ctx.rotate(rot);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      if (p.facing.x < 0) ctx.scale(-1, 1);   // 左向きは反転
      ctx.drawImage(img, -w / 2, -h + cell * 2, w, h);
    }
    ctx.restore();

    // 背番号 (頭上)
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";   // 鋭角グリフ("4"など)のマイター突起を防ぐ
    ctx.strokeText(String(p.num), x, y - h + 1);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(p.num), x, y - h + 1);

    // 操作中マーカー (頭上の三角) とシュートゲージ
    if (p === game.controlled) {
      ctx.fillStyle = "#ffe14d";
      ctx.beginPath();
      ctx.moveTo(x, y - h - 6);
      ctx.lineTo(x - 6, y - h - 15);
      ctx.lineTo(x + 6, y - h - 15);
      ctx.closePath();
      ctx.fill();

      if (game.shootCharge >= 0) {
        const gw = 44, gh = 7;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x - gw / 2, y - h - 30, gw, gh);
        ctx.fillStyle = game.shootCharge < 0.7 ? "#7ee36a" : "#ff8b3d";
        ctx.fillRect(x - gw / 2 + 1, y - h - 29, (gw - 2) * game.shootCharge, gh - 2);
      }
    }
  }

  // ---------------- ボール ----------------

  drawBall(game) {
    const ctx = this.ctx, cam = this.cam;
    const b = game.ball;
    const groundX = cam.sx(b.pos.x), groundY = cam.sy(b.pos.y);
    const r = Math.max(4, BALL_CONF.RADIUS * cam.scale * 1.4);

    // 浮き球 (GK のロングキックなど): 高さぶんボールを持ち上げ、
    // 影は小さく薄く、ボール本体は少し大きく見せて高度感を出す
    const h = b.loftHeight();
    const liftPx = h * cam.scale * 0.55;
    const shadowScale = clamp(1 - h * 0.12, 0.5, 1);
    const ballR = r * (1 + Math.min(0.4, h * 0.1));
    const x = groundX, y = groundY - liftPx;

    ctx.fillStyle = `rgba(0,0,0,${(0.3 * shadowScale).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(groundX + 2, groundY + 3, r * shadowScale, r * 0.5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, ballR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---------------- HUD ----------------

  drawHud(game) {
    const ctx = this.ctx;
    const W = this.canvas.width;

    // スコアボード
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    this.roundRect(ctx, W / 2 - 175, 10, 350, 34, 8);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 17px sans-serif";
    ctx.fillStyle = game.userTeam.colors.main;
    ctx.fillText(game.userTeam.name, W / 2 - 110, 27);
    ctx.fillStyle = game.cpuTeam.colors.main;
    ctx.fillText(game.cpuTeam.name, W / 2 + 110, 27);
    ctx.fillStyle = "#fff";
    ctx.fillText(game.score[0] + " - " + game.score[1], W / 2 - 40, 27);
    ctx.fillStyle = "#ffe14d";
    ctx.font = "bold 15px sans-serif";
    const halfLabel = game.half === 1 ? "前半" : "後半";
    ctx.fillText(halfLabel + " " + fmtTime(game.displayTime()), W / 2 + 38, 27);

    // 操作ガイド (攻守フェーズに応じて切替)
    const gkHolding = game.ball.owner === game.controlled &&
      game.controlled && game.controlled.isGK;
    const userRestart = !gkHolding && game.restartPassOnly &&
      game.ball.owner === game.controlled;
    const volleyHint = game.volley && (game.volley.active || game.volley.passActive)
      ? "★ " + [
          game.volley.active ? "X: ダイレクトシュート!!" : null,
          game.volley.passActive ? "Z: ワンタッチパス!!" : null,
        ].filter(Boolean).join("   ")
      : null;
    const guide = volleyHint
      ? volleyHint
      : gkHolding
      ? "矢印: 移動   Z: ロングキック   X: 近くの味方へパス"
      : userRestart
      ? "矢印: 向き変更   Z: パス (リスタートはパスのみ)"
      : !game.userDefending()
      ? "矢印: ドリブル   Z: パス   X(長押し): シュート   C/Shift: ダッシュ"
      : "矢印: 移動   Z/X: スライディング   C/Shift: ダッシュ   Space: 選手切替";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    this.roundRect(ctx, 10, this.canvas.height - 34, 620, 24, 6);
    ctx.fill();
    ctx.fillStyle = "#eee";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(guide, 20, this.canvas.height - 22);

    this.drawMinimap(game);

    // バナー (キックオフ / GOAL!! など)
    if (game.banner) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, this.canvas.height / 2 - 40, W, 80);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 40px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(game.banner, W / 2, this.canvas.height / 2);
    }
  }

  // ミニマップ (右下): 全体の陣形が分かるレーダー
  drawMinimap(game) {
    const ctx = this.ctx;
    const mw = 170, mh = 112;
    const ox = this.canvas.width - mw - 10;
    const oy = this.canvas.height - mh - 10;
    const kx = (mw - 10) / PITCH.LENGTH;
    const ky = (mh - 10) / PITCH.WIDTH;
    const mx = (x) => ox + mw / 2 + x * kx;
    const my = (y) => oy + mh / 2 + y * ky;

    ctx.fillStyle = "rgba(10,40,16,0.75)";
    this.roundRect(ctx, ox, oy, mw, mh, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(-PITCH.HALF_LEN), my(-PITCH.HALF_WID),
      PITCH.LENGTH * kx, PITCH.WIDTH * ky);
    ctx.beginPath();
    ctx.moveTo(mx(0), my(-PITCH.HALF_WID));
    ctx.lineTo(mx(0), my(PITCH.HALF_WID));
    ctx.stroke();

    for (const p of game.allPlayers()) {
      ctx.fillStyle = p === game.controlled ? "#ffe14d" : p.team.colors.main;
      ctx.beginPath();
      ctx.arc(mx(p.pos.x), my(p.pos.y), p === game.controlled ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(mx(game.ball.pos.x), my(game.ball.pos.y), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
