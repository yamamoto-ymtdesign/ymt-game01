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
  // PK: GKが横っ跳びでダイブする際専用。長軸を左右 (足=左端/手=右端) に
  // 取って描いてあり、ダイブ方向へ回転させると手から飛び込むように見える
  // (slide は長軸が上下のため、そのまま流用すると足から飛ぶ見た目になる)
  dive: [
    "................",
    "................",
    "................",
    "................",
    "................",
    ".........HHHH...",
    "........HHHHHHSS",
    "........SSSSSSSS",
    "....JJJJJJJJJJJJ",
    "....JJJJJJJJJJJJ",
    "..PPPPPPPPPP....",
    "LLLLLLLL........",
    "BBBB............",
    "................",
    "................",
    "................",
  ],
};

const SPRITE_SIZE = 16;
// チームカラー以外の共通パレット (H=髪 は好調フラグにより差し替えるため別定数)
const SPRITE_BASE_COLORS = {
  S: "#f0c493",
  P: "#f5f5f5",
  B: "#1e1e1e",
};
const HAIR_NORMAL = "#2b1f14";
// 「絶好調」の選手は髪を青に。小さいスプライトでも肌色 (S) と混同しない
// よう、はっきり異なる色相を選んでいる
const HAIR_GOOD_FORM = "#2ec4ff";

class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.pos = { x: 0, y: 0 };
    this.scale = FX_CONF.ZOOM_BASE;   // 1m あたりのピクセル数
    this.shakeX = 0;
    this.shakeY = 0;
  }

  // どちらかのゴールに近いほど寄る (ゴール前の緊張感を出す)
  targetScale(game) {
    const b = game.ball.pos;
    const dGoal = Math.min(
      Math.hypot(PITCH.HALF_LEN - b.x, b.y),
      Math.hypot(-PITCH.HALF_LEN - b.x, b.y));
    const t = clamp((FX_CONF.ZOOM_FAR - dGoal) / (FX_CONF.ZOOM_FAR - FX_CONF.ZOOM_NEAR), 0, 1);
    return FX_CONF.ZOOM_BASE + (FX_CONF.ZOOM_MAX - FX_CONF.ZOOM_BASE) * t;
  }

  update(dt, game) {
    const b = game.ball;
    // ボールの少し先を映す
    const target = { x: b.pos.x + b.vel.x * 0.25, y: b.pos.y + b.vel.y * 0.25 };
    const k = 1 - Math.exp(-4 * dt);
    this.pos.x += (target.x - this.pos.x) * k;
    this.pos.y += (target.y - this.pos.y) * k;

    // ズームを滑らかに追従させる
    const zk = 1 - Math.exp(-FX_CONF.ZOOM_LERP * dt);
    this.scale += (this.targetScale(game) - this.scale) * zk;

    // 画面シェイク: 強度に応じてランダムなオフセットを毎フレーム作る
    const s = game.shake || 0;
    this.shakeX = s > 0.1 ? rand(-s, s) : 0;
    this.shakeY = s > 0.1 ? rand(-s, s) : 0;

    // ピッチ外を映しすぎないようにクランプ
    const hw = this.canvas.width / 2 / this.scale;
    const hh = this.canvas.height / 2 / this.scale;
    const mx = Math.max(0, PITCH.HALF_LEN + 5 - hw);
    const my = Math.max(0, PITCH.HALF_WID + 5 - hh);
    this.pos.x = clamp(this.pos.x, -mx, mx);
    this.pos.y = clamp(this.pos.y, -my, my);
  }

  sx(x) { return (x - this.pos.x) * this.scale + this.canvas.width / 2 + this.shakeX; }
  sy(y) { return (y - this.pos.y) * this.scale + this.canvas.height / 2 + this.shakeY; }
}

class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = camera;
    this.spriteCache = new Map();   // "jersey|dark" → { stand: canvas, ... }
    this.now = 0;
  }

  // チームカラー(+髪色)ごとにスプライト一式をオフスクリーン生成してキャッシュする
  getSprites(jersey, dark, hair) {
    const key = jersey + "|" + dark + "|" + hair;
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
          c.fillStyle = ch === "J" ? jersey : ch === "L" ? dark : ch === "H" ? hair
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
    if (!game) { this.drawPitch(); return; }

    // PK戦のコース選択〜演出中は、通常のピッチ俯瞰の代わりに
    // 1人称視点のゴール正面ビューを描く (配置直後の setup フェーズだけは
    // 通常のピッチで選手の並びを見せる)
    const duel = this.activeDuel(game);
    if (duel) {
      this.drawDuelView(game, duel);
    } else {
      this.drawPitch();
      if (game.offsideFlash) this.drawOffsideLine(game.offsideFlash);
      this.drawPassMarker(game);   // 選手より下に敷いて視界を邪魔しない
      // 奥行き感を出すため y 順に描画
      const players = game.allPlayers().slice().sort((a, b) => a.pos.y - b.pos.y);
      for (const p of players) this.drawPlayer(p, game);
      this.drawBall(game);
      this.drawZoneOverlay(game);
    }
    this.drawHud(game);
  }

  // 今 1人称ビューで描くべき読み合い (PK) を返す。無ければ null
  activeDuel(game) {
    if (game.state === "pk_done") return game.pk;
    if (game.state === "pk" && game.pk && game.pk.phase !== "setup") return game.pk;
    return null;
  }

  // ゾーン発動中は画面の縁をチームカラーで光らせる
  drawZoneOverlay(game) {
    const team = game.teams.find((t) => t.inZone);
    if (!team) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const pulse = 0.55 + 0.45 * Math.sin(this.now / 180);
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, team.colors.main);
    ctx.save();
    ctx.globalAlpha = 0.3 * pulse;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // オフサイドが取られた瞬間、その位置に縦の点線を一瞬表示する演出
  drawOffsideLine(flash) {
    const ctx = this.ctx, cam = this.cam;
    const x = cam.sx(flash.x);
    ctx.save();
    ctx.strokeStyle = "rgba(255,225,77,0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(x, cam.sy(-PITCH.HALF_WID));
    ctx.lineTo(x, cam.sy(PITCH.HALF_WID));
    ctx.stroke();
    ctx.restore();
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
    const hair = p.goodForm ? HAIR_GOOD_FORM : HAIR_NORMAL;
    const sprites = this.getSprites(jersey, p.team.colors.dark, hair);

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
      } else if (game.crossCharge >= 0) {
        const gw = 44, gh = 7;
        const ratio = clamp(game.crossCharge / CROSS_CONF.HOLD_TIME, 0, 1);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x - gw / 2, y - h - 30, gw, gh);
        ctx.fillStyle = "#4fc3f7";
        ctx.fillRect(x - gw / 2 + 1, y - h - 29, (gw - 2) * ratio, gh - 2);
      } else if (game.passCharge >= 0) {
        // スルーパスの長押しゲージ (満タンでスルーパスが出る)
        const gw = 44, gh = 7;
        const ratio = clamp(game.passCharge / THROUGH_CONF.HOLD_TIME, 0, 1);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x - gw / 2, y - h - 30, gw, gh);
        ctx.fillStyle = "#b98bff";
        ctx.fillRect(x - gw / 2 + 1, y - h - 29, (gw - 2) * ratio, gh - 2);
      }

      // スタミナゲージ (足元のリングの下)。スプリント中は枠を光らせる
      const staminaRatio = p.stamina / STAMINA_CONF.MAX;
      const sw = 30, sh = 4, sy = y + cell * 2 + 9;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x - sw / 2, sy, sw, sh);
      ctx.fillStyle = staminaRatio > 0.5 ? "#7ee36a" : staminaRatio > 0.25 ? "#ff8b3d" : "#e04a3a";
      ctx.fillRect(x - sw / 2 + 1, sy + 1, (sw - 2) * clamp(staminaRatio, 0, 1), sh - 2);
      if (p.sprinting) {
        ctx.strokeStyle = "#ffe14d";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - sw / 2 - 1, sy - 1, sw + 2, sh + 2);
      }
    }

    // スプリント中は足元に砂煙 (誰でも。加速しているのが一目で分かる)
    if (p.sprinting && vlen(p.vel) > 2) {
      const back = norm(-p.vel.x, -p.vel.y);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      for (let i = 1; i <= 2; i++) {
        const d = cell * 3 * i;
        ctx.beginPath();
        ctx.arc(x + back.x * d, y + cell * 2 + back.y * d, cell * (2.2 - i * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 今 Z を押したらパスが行く味方を指すマーカー。長押し中は
  // スルーパスの落とし所まで矢印を伸ばして予告する
  drawPassMarker(game) {
    const target = game.passTarget;
    if (!target || !game.controlled) return;
    const ctx = this.ctx, cam = this.cam, s = cam.scale;
    const tx = cam.sx(target.pos.x), ty = cam.sy(target.pos.y);
    const charging = game.passCharge >= 0;
    const ratio = charging ? clamp(game.passCharge / THROUGH_CONF.HOLD_TIME, 0, 1) : 0;
    const color = charging ? "#b98bff" : "#ffe14d";

    // 受け手の足元のリング
    const pulse = 0.6 + 0.4 * Math.sin(this.now / 160);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = charging ? 1 : 0.55 + 0.35 * pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(tx, ty + s * 0.25, s * 0.62, s * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 長押し中: スルーパスの落とし所へ伸びる矢印 (溜まるほど伸びる)
    if (charging) {
      const spot = game.throughSpot(game.controlled, target);
      const sx2 = cam.sx(spot.x), sy2 = cam.sy(spot.y);
      const ex = tx + (sx2 - tx) * ratio, ey = ty + (sy2 - ty) * ratio;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      if (ratio > 0.15) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------- PK戦: 1人称視点ビュー ----------------
  // 自チームが蹴る番なら「キッカー視点 (ゴール正面)」、相手が蹴る番なら
  // 「キーパー視点 (相手キッカーを正面に見る)」を出し分ける

  // ゾーン (col:0-2 左/中央/右, row:0-1 上/下) の中心をゴール枠内の
  // スクリーン座標で返す
  pkZoneCenter(rect, col, row) {
    const cw = rect.w / PK_AIM_CONF.COLS, ch = rect.h / PK_AIM_CONF.ROWS;
    return { x: rect.left + cw * (col + 0.5), y: rect.top + ch * (row + 0.5) };
  }

  // PK戦の1人称ビュー。duel は phase/choice/shooter/gk を持つ
  drawDuelView(game, duel) {
    if (duel.keeperIsUser) this.drawPKKeeperView(game, duel);
    else this.drawPKKickerView(game, duel);
  }

  // PK: GK がコース選択に応じてジャンプ/ダイブするときの位置・姿勢・回転を
  // 計算する (キッカー視点の相手GK・キーパー視点の自分、共通で使う)。
  // start/target はスクリーン座標
  computePKGKPose(pk, start, target, diveT) {
    const midCol = Math.floor(PK_AIM_CONF.COLS / 2);
    const isMidLow = pk.keeperChoice.col === midCol && pk.keeperChoice.row === PK_AIM_CONF.ROWS - 1;
    const isMidHigh = pk.keeperChoice.col === midCol && pk.keeperChoice.row === 0;
    if (isMidLow) {
      // 真ん中下段: 飛ばずに立ったまま止める
      return { x: start.x, y: start.y, pose: "stand", rot: null };
    }
    if (isMidHigh) {
      // 真ん中上段: その場で垂直にジャンプ
      return { x: start.x, y: lerp(start.y, target.y, diveT), pose: "slide", rot: 0 };
    }
    // それ以外: 狙われた方向へ手を伸ばしてダイブする。
    // dive スプライトは長軸が (足=左端 / 手=右端) の左右方向なので、
    // そのままダイブ方向へ回転させれば手から飛び込むように見える
    return {
      x: lerp(start.x, target.x, diveT),
      y: lerp(start.y, target.y, diveT),
      pose: "dive",
      rot: Math.atan2(target.y - start.y, target.x - start.x),
    };
  }

  // PK: GK のスプライトを (x, y) を基準に描く (rot が null なら直立、
  // それ以外は rot 分だけ回転させて描く)
  drawPKGKSprite(x, y, rot, pose, jersey, dark, cell) {
    const ctx = this.ctx;
    const sprites = this.getSprites(jersey, dark, HAIR_NORMAL);
    const w = SPRITE_SIZE * cell, h = SPRITE_SIZE * cell;
    const img = pose === "stand" ? sprites.stand
      : pose === "dive" ? sprites.dive
      : sprites.slide;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (rot !== null) {
      ctx.rotate(rot);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(img, -w / 2, -h + cell * 2, w, h);
    }
    ctx.restore();
  }

  // ゴール枠 (ネット・ポスト・3x2ゾーンの区切り線) を描く。rect のサイズで
  // キッカー視点の大きなゴールにもキーパー視点の小さな図解にも使う
  drawPKGoalFrame(rect) {
    const ctx = this.ctx;
    const goalLineY = rect.top + rect.h;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.w, rect.h);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    for (let gx = rect.left - rect.h; gx < rect.left + rect.w + rect.h; gx += 16) {
      ctx.beginPath();
      ctx.moveTo(gx, rect.top);
      ctx.lineTo(gx + rect.h, goalLineY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gx, goalLineY);
      ctx.lineTo(gx + rect.h, rect.top);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = rect.w > 400 ? 7 : 4;
    ctx.strokeRect(rect.left, rect.top, rect.w, rect.h);

    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    for (let c = 1; c < PK_AIM_CONF.COLS; c++) {
      const x = rect.left + (rect.w / PK_AIM_CONF.COLS) * c;
      ctx.beginPath(); ctx.moveTo(x, rect.top); ctx.lineTo(x, goalLineY); ctx.stroke();
    }
    for (let r = 1; r < PK_AIM_CONF.ROWS; r++) {
      const y = rect.top + (rect.h / PK_AIM_CONF.ROWS) * r;
      ctx.beginPath(); ctx.moveTo(rect.left, y); ctx.lineTo(rect.left + rect.w, y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 残り時間バー (aim フェーズ中だけ表示)
  drawPKTimer(duel, x, y, w) {
    const ctx = this.ctx;
    if (duel.phase !== "aim") return;
    const ratio = clamp(duel.timer / (duel.aimTotal || PK_AIM_CONF.AIM_TIME), 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = ratio < 0.3 ? "#ff8b3d" : "#7ee36a";
    ctx.fillRect(x + 1, y + 1, (w - 2) * ratio, 6);
  }

  // ---- キッカー視点: ゴール正面から相手GKと対峙する ----
  drawPKKickerView(game, pk) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#274b6b");
    sky.addColorStop(1, "#1a3348");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2e7d3a";
    ctx.fillRect(0, H * 0.62, W, H * 0.38);

    const rect = { left: W / 2 - 240, top: 78, w: 480, h: 190 };
    const goalLineY = rect.top + rect.h;
    this.drawPKGoalFrame(rect);

    // 自分 (キッカー) が選択中のコースをハイライト。相手 (キーパー) の選択は見せない
    if (pk.phase === "aim") {
      const pulse = 0.5 + 0.5 * Math.sin(this.now / 130);
      if (!pk.kickerConfirmed) {
        this.drawPKCursor(rect, pk.kickerChoice, `rgba(255,225,77,${0.35 + 0.25 * pulse})`, "#ffe14d");
      } else {
        this.drawPKCursor(rect, pk.kickerChoice, "rgba(255,225,77,0.18)", "rgba(255,225,77,0.6)");
      }
      this.drawPKTimer(pk, W / 2 - 90, rect.top - 22, 180);
    }

    // シュート/セーブのアニメーション (anim/result フェーズで進行度 1 まで進む)
    const animT = pk.phase === "anim"
      ? clamp(1 - pk.timer / (pk.animTotal || PK_AIM_CONF.ANIM_TIME), 0, 1)
      : (pk.phase === "result" ? 1 : 0);
    const ease = animT * (2 - animT);

    const kickerStart = { x: W / 2, y: goalLineY + 150 };
    const ballTarget = this.pkZoneCenter(rect, pk.kickerChoice.col, pk.kickerChoice.row);
    const ballX = lerp(kickerStart.x, ballTarget.x, ease);
    const ballY = lerp(kickerStart.y, ballTarget.y, ease);

    // GK はニュートラルなポジション (ゴール中央) に常に立っており、
    // aim フェーズ中はまだダイブしない (ease が 0 のため自然と中央に留まる)
    const gkStart = { x: W / 2, y: goalLineY - 14 };
    const gkTarget = this.pkZoneCenter(rect, pk.keeperChoice.col, pk.keeperChoice.row);
    const diveT = animT >= 1 ? ease : ease * 0.92;
    const gkPoseInfo = this.computePKGKPose(pk, gkStart, gkTarget, diveT);
    const gkX = gkPoseInfo.x, gkY = gkPoseInfo.y;

    // 相手GK (実際のスプライトを表示。チームのメインカラーで敵味方が分かる。
    // ゴールの大きさに対して小さすぎないよう、キーパー視点の相手キッカーと
    // 同程度の見た目の大きさになるよう拡大してある)
    const gkJersey = pk.gk ? pk.gk.team.colors.main : "#e04a3a";
    const gkDark = pk.gk ? pk.gk.team.colors.dark : "#a03024";
    this.drawPKGKSprite(gkX, gkY, gkPoseInfo.rot, gkPoseInfo.pose, gkJersey, gkDark, 5.2);

    // ボール (一致 = セーブなら演出後半でGK位置に吸い寄せる)
    const bx = pk.matched && animT > 0.6 ? lerp(ballX, gkX, (animT - 0.6) / 0.4) : ballX;
    const by = pk.matched && animT > 0.6 ? lerp(ballY, gkY, (animT - 0.6) / 0.4) : ballY;
    this.drawPKBall(bx, by);

    if (pk.shooter) {
      ctx.fillStyle = pk.shooter.team.colors.main;
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(pk.shooter.team.name + " #" + pk.shooter.num + " のキック", W / 2, H - 46);
    }
  }

  // ---- キーパー視点: 相手キッカーを正面に見て、ダイブ方向を選ぶ ----
  drawPKKeeperView(game, pk) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#274b6b");
    sky.addColorStop(1, "#1a3348");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2e7d3a";
    ctx.fillRect(0, H * 0.4, W, H * 0.6);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - 260, H * 0.4, 520, H * 0.5);

    // 相手キッカー (実際のスプライトを流用し、大きめに表示して対峙感を出す)
    const shooter = pk.shooter;
    const kickerX = W / 2, kickerGroundY = H * 0.42 + 66;
    if (shooter) {
      const jersey = shooter.team.colors.main;
      const sprites = this.getSprites(jersey, shooter.team.colors.dark, HAIR_NORMAL);
      const cell = 4.6;
      const w = SPRITE_SIZE * cell, h = SPRITE_SIZE * cell;
      const img = (pk.phase === "anim" || pk.phase === "result") ? sprites.kick : sprites.stand;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(kickerX, kickerGroundY);
      ctx.drawImage(img, -w / 2, -h + cell * 2, w, h);
      ctx.restore();

      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = jersey;
      ctx.fillText(shooter.team.name + " #" + shooter.num + " のキック", W / 2, H * 0.4 - 12);
    }

    // 自分のゴール (簡易図解): ここでダイブ方向を選ぶ
    const rect = { left: W / 2 - 150, top: H - 168, w: 300, h: 108 };
    this.drawPKGoalFrame(rect);

    if (pk.phase === "aim") {
      const pulse = 0.5 + 0.5 * Math.sin(this.now / 130);
      if (!pk.keeperConfirmed) {
        this.drawPKCursor(rect, pk.keeperChoice, `rgba(79,195,247,${0.35 + 0.25 * pulse})`, "#4fc3f7");
      } else {
        this.drawPKCursor(rect, pk.keeperChoice, "rgba(79,195,247,0.18)", "rgba(79,195,247,0.6)");
      }
      this.drawPKTimer(pk, W / 2 - 90, rect.top - 22, 180);
    }

    const animT = pk.phase === "anim"
      ? clamp(1 - pk.timer / (pk.animTotal || PK_AIM_CONF.ANIM_TIME), 0, 1)
      : (pk.phase === "result" ? 1 : 0);
    const ease = animT * (2 - animT);

    // ボールはキッカーの足元から、自分のゴール (rect) 内の狙われたゾーンへ飛んでくる
    const ballStart = { x: kickerX, y: kickerGroundY + 6 };
    const ballTarget = this.pkZoneCenter(rect, pk.kickerChoice.col, pk.kickerChoice.row);
    const ballX = lerp(ballStart.x, ballTarget.x, ease);
    const ballY = lerp(ballStart.y, ballTarget.y, ease);

    // 自分 (キーパー) は rect 内でダイブ方向へ跳ぶ。相手GKと同じスプライト
    // 描画にして、丸印だけでなくキャラクターとして表示する
    const selfStart = { x: rect.left + rect.w / 2, y: rect.top + rect.h - 6 };
    const selfTarget = this.pkZoneCenter(rect, pk.keeperChoice.col, pk.keeperChoice.row);
    const selfT = animT >= 1 ? ease : ease * 0.92;
    const selfPoseInfo = this.computePKGKPose(pk, selfStart, selfTarget, selfT);
    const selfX = selfPoseInfo.x, selfY = selfPoseInfo.y;

    const selfJersey = pk.gk ? pk.gk.team.colors.main : "#2f6fe0";
    const selfDark = pk.gk ? pk.gk.team.colors.dark : "#1d4fa0";
    this.drawPKGKSprite(selfX, selfY, selfPoseInfo.rot, selfPoseInfo.pose, selfJersey, selfDark, 2.8);

    const bx = pk.matched && animT > 0.6 ? lerp(ballX, selfX, (animT - 0.6) / 0.4) : ballX;
    const by = pk.matched && animT > 0.6 ? lerp(ballY, selfY, (animT - 0.6) / 0.4) : ballY;
    this.drawPKBall(bx, by);
  }

  drawPKBall(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 選択ゾーンのハイライト枠を描く
  drawPKCursor(rect, choice, fill, stroke) {
    const ctx = this.ctx;
    const cw = rect.w / PK_AIM_CONF.COLS, ch = rect.h / PK_AIM_CONF.ROWS;
    const x = rect.left + cw * choice.col, y = rect.top + ch * choice.row;
    ctx.fillStyle = fill;
    ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
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

    // スコアボード (ロスタイム表示が入ると横に伸びるので、その分だけ広げる)
    const inPK = game.state === "pk" || game.state === "pk_done";
    const extra = game.stoppageElapsed();
    const wide = !inPK && extra > 0;
    const boxW = wide ? 430 : 350;
    const nameX = wide ? 155 : 110;
    const scoreX = wide ? -55 : -40;
    const infoX = wide ? 45 : 38;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    this.roundRect(ctx, W / 2 - boxW / 2, 10, boxW, 34, 8);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 17px sans-serif";
    ctx.fillStyle = game.userTeam.colors.main;
    ctx.fillText(game.userTeam.name, W / 2 - nameX, 27);
    ctx.fillStyle = game.cpuTeam.colors.main;
    ctx.fillText(game.cpuTeam.name, W / 2 + nameX, 27);
    ctx.fillStyle = "#fff";
    ctx.fillText(game.score[0] + " - " + game.score[1], W / 2 + scoreX, 27);
    ctx.fillStyle = "#ffe14d";
    ctx.font = "bold 15px sans-serif";
    if (inPK && game.pk) {
      ctx.fillText("PK " + game.pk.userScore + " - " + game.pk.cpuScore, W / 2 + infoX, 27);
    } else {
      const halfLabel = game.half === 1 ? "前半" : "後半";
      let timeText = halfLabel + " " + fmtTime(game.displayTime());
      // ロスタイム中は「+1:23」を追記して、まだ終わっていないことを示す
      if (extra > 0) timeText += "  +" + fmtTime(extra).replace(/^0/, "");
      ctx.fillText(timeText, W / 2 + infoX, 27);
    }

    this.drawMomentum(game);

    // トーナメントのラウンド表示 (トーナメントモードの試合中だけ)
    if (game.roundLabel) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      this.roundRect(ctx, W / 2 - 70, 46, 140, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#ffe14d";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(game.roundLabel, W / 2, 56);
    }

    // 操作ガイド (攻守フェーズに応じて切替)
    const gkHolding = game.ball.owner === game.controlled &&
      game.controlled && game.controlled.isGK;
    const userRestart = !gkHolding && game.restartPassOnly &&
      game.ball.owner === game.controlled;
    const inCrossZone = game.controlled && game.ball.owner === game.controlled &&
      game.isCrossZone(game.controlled);
    const headerMode = game.ball.airborne;
    const volleyHint = game.volley && (game.volley.active || game.volley.passActive)
      ? "★ " + [
          game.volley.active ? ("X: " + (headerMode ? "ヘディングシュート!!" : "ダイレクトシュート!!")) : null,
          game.volley.passActive ? "Z: ワンタッチパス!!" : null,
        ].filter(Boolean).join("   ")
      : null;
    // PK の読み合い中は、どちらの役かに応じたガイドを出す
    const duel = inPK ? game.pk : null;
    const duelLabel = "PK戦";
    const guide = duel
      ? (duel.phase === "aim"
          ? (duel.kickerIsUser && !duel.kickerConfirmed
              ? "矢印: コースを選ぶ (左右/上下)   X: 決定"
              : duel.keeperIsUser && !duel.keeperConfirmed
              ? "矢印: 飛ぶ方向を選ぶ (左右/上下)   X: 決定"
              : "コース決定を待っています…")
          : duelLabel)
      : volleyHint
      ? volleyHint
      : gkHolding
      ? "矢印: 移動   Z: 近くの味方へパス   X: ロングキック"
      : userRestart
      ? "矢印: 向き変更   Z: パス (リスタートはパスのみ)"
      : !game.userDefending()
      ? (inCrossZone
          ? "矢印: ドリブル   Shift: スプリント   Z長押し: クロス   X(長押し): シュート"
          : "矢印: ドリブル   Shift: スプリント   Z: パス / 長押し: スルーパス   X(長押し): シュート")
      : "矢印: 移動   Shift: スプリント   Z/X: スライディング   Space: 選手切替";
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

  // モメンタム (ノリ) ゲージ: 画面左上に両チーム分を縦に並べる。
  // ゾーン中はゲージ全体が脈打ち、残り時間バーに切り替わる
  drawMomentum(game) {
    const ctx = this.ctx;
    const gw = 150, gh = 11, ox = 12, oy = 12;
    game.teams.forEach((team, i) => {
      const y = oy + i * (gh + 7);
      const inZone = team.inZone;
      const ratio = inZone
        ? team.zoneTimer / MOMENTUM_CONF.ZONE_TIME
        : team.momentum / MOMENTUM_CONF.MAX;

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      this.roundRect(ctx, ox, y, gw, gh, 4);
      ctx.fill();

      if (inZone) {
        const pulse = 0.6 + 0.4 * Math.sin(this.now / 90);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = "#ffe14d";
        ctx.fillRect(ox + 1.5, y + 1.5, (gw - 3) * clamp(ratio, 0, 1), gh - 3);
        ctx.restore();
      } else {
        ctx.fillStyle = team.colors.main;
        ctx.fillRect(ox + 1.5, y + 1.5, (gw - 3) * clamp(ratio, 0, 1), gh - 3);
      }

      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = inZone ? "#ffe14d" : "rgba(255,255,255,0.9)";
      ctx.fillText(inZone ? "⚡ " + team.name + " ZONE" : team.name, ox + gw + 7, y + gh / 2);
    });
    ctx.textBaseline = "alphabetic";
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
