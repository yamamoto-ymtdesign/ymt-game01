"use strict";

// =====================================================================
// ボール
//  - owner が居る間は保持者の前方に追従する (ドリブル)
//  - フリーの間は摩擦で減速しながら転がる
//  - shield: 蹴った直後の選手が即座に再トラップするのを防ぐ
//  - airborne: 浮き球 (GK のロングキックなど) の間、誰も (敵味方とも)
//    トラップ・タックルで触れられない。ハーフライン付近に到達するか
//    最大時間が経過すると着地し、通常通り誰でも触れるようになる
// =====================================================================

class Ball {
  constructor() {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.owner = null;          // 保持している Player (null = フリー)
    this.shieldPlayer = null;   // 直前に蹴った選手
    this.shieldTimer = 0;
    this.lastTouchTeam = null;  // 最後に触れたチーム (アウトオブプレー判定用)

    this.airborne = false;      // 浮き球かどうか
    this.airborneTimer = 0;     // 着地までの残り時間
    this.airborneTotal = 0;     // 浮き球の想定総時間 (描画の高さ計算に使用)
    this.landingSide = 0;       // 着地判定に使う攻撃方向 (+1/-1)
  }

  reset(pos) {
    this.pos = { x: pos.x, y: pos.y };
    this.vel = { x: 0, y: 0 };
    this.owner = null;
    this.shieldPlayer = null;
    this.shieldTimer = 0;
    this.airborne = false;
    this.airborneTimer = 0;
    this.landingSide = 0;
  }

  setOwner(player) {
    this.owner = player;
    this.vel = { x: 0, y: 0 };
    this.shieldPlayer = null;
    this.shieldTimer = 0;
    this.lastTouchTeam = player.team;
    this.airborne = false;
  }

  // 選手 player が dir 方向へ speed でボールを蹴り出す
  kick(player, dir, speed) {
    this.owner = null;
    this.vel = { x: dir.x * speed, y: dir.y * speed };
    this.shieldPlayer = player;
    this.shieldTimer = ACTION_CONF.KICK_SHIELD_TIME;
    this.lastTouchTeam = player.team;
    player.holdTimer = 0;
    player.kickAnim = 0.28;   // キックモーションを表示する
    this.airborne = false;
  }

  // GK のロングキックなど、浮き球として蹴り出す。
  // landingSide (通常はキッカーの攻撃方向) 側へハーフライン付近まで
  // 誰にも触れられずに飛んでいく
  launchLofted(player, dir, speed, landingSide) {
    this.kick(player, dir, speed);
    this.airborne = true;
    this.airborneTimer = BALL_CONF.LOFT_MAX_TIME;
    this.airborneTotal = BALL_CONF.LOFT_MAX_TIME;
    this.landingSide = landingSide;
  }

  // 現在の見かけの浮き上がり高さ (描画用。地上なら 0)
  loftHeight() {
    if (!this.airborne || this.airborneTotal <= 0) return 0;
    const progress = clamp(1 - this.airborneTimer / this.airborneTotal, 0, 1);
    return Math.sin(progress * Math.PI) * BALL_CONF.LOFT_PEAK_HEIGHT;
  }

  update(dt) {
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);

    if (this.owner) {
      // 保持者の向いている方向の少し前にボールを置く
      const o = this.owner;
      const tx = o.pos.x + o.facing.x * BALL_CONF.DRIBBLE_OFFSET;
      const ty = o.pos.y + o.facing.y * BALL_CONF.DRIBBLE_OFFSET;
      const k = Math.min(1, 14 * dt);
      this.pos.x += (tx - this.pos.x) * k;
      this.pos.y += (ty - this.pos.y) * k;
      this.vel = { x: o.vel.x, y: o.vel.y };
      return;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (this.airborne) {
      this.airborneTimer -= dt;
      const decay = Math.exp(-BALL_CONF.LOFT_FRICTION * dt);
      this.vel.x *= decay;
      this.vel.y *= decay;

      // 山なりの後半 (下降中) かつハーフライン付近まで来たら着地。
      // それ以外は最大時間経過で強制的に着地させる
      const progress = 1 - this.airborneTimer / this.airborneTotal;
      const descending = progress >= 0.5;
      const reachedZone = this.landingSide !== 0 &&
        this.pos.x * this.landingSide >= -BALL_CONF.LOFT_LANDING_MARGIN;
      if (this.airborneTimer <= 0 || (descending && reachedZone)) {
        this.airborne = false;
      }
      return;
    }

    const decay = Math.exp(-BALL_CONF.FRICTION * dt);
    this.vel.x *= decay;
    this.vel.y *= decay;
    if (vlen(this.vel) < 0.2) this.vel = { x: 0, y: 0 };
  }
}
