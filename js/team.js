"use strict";

// =====================================================================
// チーム: 7人の選手 (GK + フィールド6人) と攻撃方向を持つ
// =====================================================================

class Team {
  constructor(id, name, isUser, attackDir, colors) {
    this.id = id;               // 0 = ユーザー, 1 = CPU (スコア配列の添字)
    this.name = name;
    this.isUser = isUser;
    this.attackDir = attackDir; // +1 = 右へ攻める / -1 = 左へ攻める
    this.colors = colors;       // { main, dark, gk }
    this.players = FORMATION_7.map((slot, i) => new Player(this, slot, i + 1));
    this.gk = this.players[0];
  }

  outfield() {
    return this.players.filter((p) => !p.isGK);
  }

  // キックオフ用: 全員を自陣のフォーメーション位置に戻す
  resetToFormation() {
    for (const p of this.players) {
      // FW も含め全員自陣に収める
      const teamX = Math.min(p.slot.x, -0.08) * PITCH.HALF_LEN * 0.8;
      p.pos = {
        x: teamX * this.attackDir,
        y: p.slot.y * PITCH.HALF_WID * 0.8,
      };
      p.vel = { x: 0, y: 0 };
      p.facing = { x: this.attackDir, y: 0 };
      p.state = "normal";
      p.stateTimer = 0;
      p.cooldown = 0;
      p.holdTimer = 0;
      p.moveTarget = null;
      p.plan = null;
      p.thinkTimer = Math.random() * 0.3;
    }
  }

  // 守備時にボールを追いかける担当 (チェイサー) を2人選ぶ。
  // ユーザーチームでは操作中のキャラを除外する (追走はユーザーの役目)。
  assignChasers(game) {
    for (const p of this.players) p.isChaser = false;
    const cands = this.outfield()
      .filter((p) => !(this.isUser && p === game.controlled))
      .sort((a, b) => dist(a.pos, game.ball.pos) - dist(b.pos, game.ball.pos));
    for (const p of cands.slice(0, 2)) p.isChaser = true;
  }
}
