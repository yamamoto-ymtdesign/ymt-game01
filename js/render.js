"use strict";

// =====================================================================
// 描画: ボール追従カメラ + ピッチ / 選手 / ボール / HUD / ミニマップ
// =====================================================================

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
  }

  draw(game) {
    const ctx = this.ctx;
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

  // ---------------- 選手 ----------------

  drawPlayer(p, game) {
    const ctx = this.ctx, cam = this.cam, s = cam.scale;
    const x = cam.sx(p.pos.x), y = cam.sy(p.pos.y);
    const r = PLAYER_CONF.RADIUS * s * 1.15;
    const color = p.isGK ? p.team.colors.gk : p.team.colors.main;

    // 影
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.45, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.state === "slide") {
      // スライディング: 進行方向に伸びた姿勢で描く
      const ang = Math.atan2(p.slideDir.y, p.slideDir.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.7, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.team.colors.dark;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else {
      const fallen = p.state === "stumble" || p.state === "getup";
      ctx.globalAlpha = fallen ? 0.75 : 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (fallen) ctx.ellipse(x, y, r * 1.3, r * 0.7, 0, 0, Math.PI * 2);
      else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.team.colors.dark;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 向きを示すくちばし
      if (!fallen) {
        ctx.fillStyle = p.team.colors.dark;
        ctx.beginPath();
        ctx.arc(x + p.facing.x * r * 0.75, y + p.facing.y * r * 0.75, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 背番号
      ctx.fillStyle = "#fff";
      ctx.font = "bold " + Math.round(r) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(p.num), x, y);
    }

    // 操作中マーカー
    if (p === game.controlled) {
      ctx.strokeStyle = "#ffe14d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffe14d";
      ctx.beginPath();
      ctx.moveTo(x, y - r - 16);
      ctx.lineTo(x - 7, y - r - 26);
      ctx.lineTo(x + 7, y - r - 26);
      ctx.closePath();
      ctx.fill();

      // シュートの溜めゲージ
      if (game.shootCharge >= 0) {
        const w = 44, h = 7;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x - w / 2, y - r - 40, w, h);
        ctx.fillStyle = game.shootCharge < 0.7 ? "#7ee36a" : "#ff8b3d";
        ctx.fillRect(x - w / 2 + 1, y - r - 39, (w - 2) * game.shootCharge, h - 2);
      }
    }
  }

  // ---------------- ボール ----------------

  drawBall(game) {
    const ctx = this.ctx, cam = this.cam;
    const b = game.ball;
    const x = cam.sx(b.pos.x), y = cam.sy(b.pos.y);
    const r = Math.max(4, BALL_CONF.RADIUS * cam.scale * 1.4);

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
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

    // 操作ガイド (状況に応じて切替)
    const hasBall = game.ball.owner && game.ball.owner.team === game.userTeam;
    const guide = hasBall
      ? "矢印: ドリブル   Z: パス   X(長押し): シュート   C/Shift: ダッシュ"
      : "矢印: 移動   Z: 脚を出す   X: スライディング   C: 体当たり   Space: 選手切替   Shift: ダッシュ";
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
