"use strict";

// =====================================================================
// ボール
//  - owner が居る間は保持者の前方に追従する (ドリブル)
//  - フリーの間は摩擦で減速しながら転がる
//  - shield: 蹴った直後の選手が即座に再トラップするのを防ぐ
// =====================================================================

class Ball {
  constructor() {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.owner = null;          // 保持している Player (null = フリー)
    this.shieldPlayer = null;   // 直前に蹴った選手
    this.shieldTimer = 0;
    this.lastTouchTeam = null;  // 最後に触れたチーム (アウトオブプレー判定用)
  }

  reset(pos) {
    this.pos = { x: pos.x, y: pos.y };
    this.vel = { x: 0, y: 0 };
    this.owner = null;
    this.shieldPlayer = null;
    this.shieldTimer = 0;
  }

  setOwner(player) {
    this.owner = player;
    this.vel = { x: 0, y: 0 };
    this.shieldPlayer = null;
    this.shieldTimer = 0;
    this.lastTouchTeam = player.team;
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

    const decay = Math.exp(-BALL_CONF.FRICTION * dt);
    this.vel.x *= decay;
    this.vel.y *= decay;
    if (vlen(this.vel) < 0.2) this.vel = { x: 0, y: 0 };
  }
}
