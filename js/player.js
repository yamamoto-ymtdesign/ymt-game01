"use strict";

// =====================================================================
// 選手
//  状態 (state):
//    normal  - 通常。移動・アクションが可能
//    tackle  - 脚を出している最中 (短時間の硬直)
//    slide   - スライディング中 (滑走しながらボール・相手に作用)
//    getup   - スライディング後の起き上がり (行動不能)
//    stumble - 相手に転ばされた・よろけた (行動不能)
//    charge  - 体当たりのモーション中
//
//  操作キャラ以外は毎フレーム updateAI() で行動を決め、
//  update() で物理的に移動する。
// =====================================================================

class Player {
  constructor(team, slot, num) {
    this.team = team;
    this.slot = slot;             // フォーメーション上の定位置 (正規化座標)
    this.role = slot.role;
    this.isGK = slot.role === "GK";
    this.num = num;

    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.facing = { x: team.attackDir, y: 0 };

    this.state = "normal";
    this.stateTimer = 0;
    this.cooldown = 0;            // アクションを再使用できるまでの時間
    this.holdTimer = 0;           // GK がキャッチ後にボールを保持する時間

    this.moveTarget = null;       // このフレームの移動先
    this.moveSpeed = 0;
    this.slideDir = null;
    this.slideHit = false;

    this.thinkTimer = Math.random() * 0.3;  // AI の意思決定タイマー
    this.plan = null;             // AI の現在の行動プラン
    this.isChaser = false;        // 守備時にボールを追う担当か
  }

  get busy() { return this.state !== "normal"; }
  canAct() { return this.state === "normal" && this.cooldown <= 0; }

  // ------------------------------------------------------------------
  // 物理更新 (毎フレーム、AI/ユーザー操作の後に呼ぶ)
  // ------------------------------------------------------------------
  update(game, dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.state !== "normal") {
      this.stateTimer -= dt;
      if (this.state === "slide") {
        // 滑走: 残り時間に応じて減速しながら直進し、接触判定を行う
        const k = Math.max(0.15, this.stateTimer / ACTION_CONF.SLIDE_TIME);
        this.vel.x = this.slideDir.x * ACTION_CONF.SLIDE_SPEED * k;
        this.vel.y = this.slideDir.y * ACTION_CONF.SLIDE_SPEED * k;
        this.slideContact(game);
      } else {
        // 転倒・硬直中はほぼ停止
        const damp = Math.pow(0.02, dt);
        this.vel.x *= damp;
        this.vel.y *= damp;
      }
      if (this.stateTimer <= 0) {
        if (this.state === "slide") {
          this.state = "getup";
          this.stateTimer = ACTION_CONF.GETUP_TIME;
        } else {
          this.state = "normal";
        }
      }
    } else {
      // moveTarget に向かって加速する
      let desired = { x: 0, y: 0 };
      if (this.moveTarget) {
        const d = dist(this.pos, this.moveTarget);
        if (d > 0.15) {
          const n = normTo(this.pos, this.moveTarget);
          const arrive = Math.min(1, d / 1.5);   // 目標付近では減速
          desired = { x: n.x * this.moveSpeed * arrive, y: n.y * this.moveSpeed * arrive };
        }
      }
      const a = PLAYER_CONF.ACCEL * dt;
      this.vel.x += clamp(desired.x - this.vel.x, -a, a);
      this.vel.y += clamp(desired.y - this.vel.y, -a, a);
      if (vlen(this.vel) > 0.6) this.facing = norm(this.vel.x, this.vel.y);
    }

    this.pos.x = clamp(this.pos.x + this.vel.x * dt,
      -(PITCH.HALF_LEN - PITCH.MARGIN), PITCH.HALF_LEN - PITCH.MARGIN);
    this.pos.y = clamp(this.pos.y + this.vel.y * dt,
      -(PITCH.HALF_WID - PITCH.MARGIN), PITCH.HALF_WID - PITCH.MARGIN);
  }

  stumble(t) {
    if (this.state === "slide" || this.state === "getup") return;
    this.state = "stumble";
    this.stateTimer = t;
  }

  // ------------------------------------------------------------------
  // 守備アクション: 脚を出す (カット)
  // ------------------------------------------------------------------
  tryTackle(game) {
    if (!this.canAct()) return;
    this.state = "tackle";
    this.stateTimer = ACTION_CONF.TACKLE_TIME;
    this.cooldown = ACTION_CONF.TACKLE_COOLDOWN;

    const ball = game.ball;
    if (dist(this.pos, ball.pos) > ACTION_CONF.TACKLE_RANGE) return;
    // 前方 (約100度) のボールにしか届かない
    if (dot(normTo(this.pos, ball.pos), this.facing) < 0.1) return;

    const owner = ball.owner;
    if (!owner) {
      // ルーズボールはそのまま拾う
      if (vlen(ball.vel) <= BALL_CONF.CONTROL_MAX_SPEED + 6) game.givePossession(this);
      return;
    }
    if (owner.team === this.team) return;
    if (owner.isGK && owner.holdTimer > 0) return;  // GK キャッチ中は奪えない

    const prob = (game.controlled === this)
      ? 0.8
      : 0.6 * game.diffFor(this.team).aiTackleProb;
    if (Math.random() < Math.min(0.95, prob)) {
      if (Math.random() < 0.5) {
        game.givePossession(this);       // きれいに奪う
      } else {
        // 前方へ弾く (ルーズボールになる)
        const d = norm(this.facing.x + rand(-0.5, 0.5), this.facing.y + rand(-0.5, 0.5));
        ball.kick(this, d, 7);
      }
    }
  }

  // ------------------------------------------------------------------
  // 守備アクション: スライディング
  // ------------------------------------------------------------------
  trySlide(game) {
    if (!this.canAct()) return;
    this.state = "slide";
    this.stateTimer = ACTION_CONF.SLIDE_TIME;
    this.cooldown = 1.2;
    this.slideDir = { x: this.facing.x, y: this.facing.y };
    this.slideHit = false;
  }

  // スライディング滑走中の接触処理 (update から毎フレーム呼ばれる)
  slideContact(game) {
    const ball = game.ball;
    const owner = ball.owner;

    if (!this.slideHit && dist(this.pos, ball.pos) < ACTION_CONF.SLIDE_RANGE) {
      const protectedBall =
        owner && (owner.team === this.team || (owner.isGK && owner.holdTimer > 0));
      if (!protectedBall) {
        this.slideHit = true;
        if (owner) owner.stumble(0.6);
        // 大きく蹴り出す
        const d = norm(this.slideDir.x + rand(-0.35, 0.35), this.slideDir.y + rand(-0.35, 0.35));
        ball.kick(this, d, 11);
      }
    }
    // 巻き込んだ相手は転倒する
    for (const opp of game.opponentsOf(this.team)) {
      if (opp.state === "normal" && dist(this.pos, opp.pos) < 0.9) {
        opp.stumble(ACTION_CONF.STUMBLE_TIME);
      }
    }
  }

  // ------------------------------------------------------------------
  // 守備アクション: 体をぶつける (ショルダーチャージ)
  // ------------------------------------------------------------------
  tryCharge(game) {
    if (!this.canAct()) return;
    this.state = "charge";
    this.stateTimer = ACTION_CONF.CHARGE_TIME;
    this.cooldown = ACTION_CONF.CHARGE_COOLDOWN;

    let best = null, bestD = ACTION_CONF.CHARGE_RANGE;
    for (const opp of game.opponentsOf(this.team)) {
      const d = dist(this.pos, opp.pos);
      if (d < bestD && dot(normTo(this.pos, opp.pos), this.facing) > -0.2) {
        best = opp;
        bestD = d;
      }
    }
    if (!best) return;

    const n = normTo(this.pos, best.pos);
    best.vel.x += n.x * 7;
    best.vel.y += n.y * 7;
    best.stumble(0.55);
    this.vel.x += n.x * 3;   // 自分も少し前へ踏み込む
    this.vel.y += n.y * 3;

    const ball = game.ball;
    if (ball.owner === best && !(best.isGK && best.holdTimer > 0)) {
      const d = norm(n.x + rand(-0.6, 0.6), n.y + rand(-0.6, 0.6));
      ball.kick(best, d, 6);
      ball.lastTouchTeam = best.team;
    }
  }

  // ------------------------------------------------------------------
  // AI (操作キャラ以外の全選手 + 敵チーム全員)
  // ------------------------------------------------------------------
  updateAI(game, dt) {
    this.moveTarget = null;
    if (this.busy) return;

    if (this.isGK) { this.aiGoalkeeper(game, dt); return; }

    const owner = game.ball.owner;
    if (owner === this) { this.aiWithBall(game, dt); return; }
    if (owner && owner.team === this.team) this.aiSupport(game, dt);
    else this.aiDefend(game, dt);
  }

  // ボールを持っている AI: シュート / パス / ドリブル を選ぶ
  aiWithBall(game, dt) {
    const diff = game.diffFor(this.team);
    const goal = { x: PITCH.HALF_LEN * this.team.attackDir, y: 0 };
    this.thinkTimer -= dt;

    if (this.thinkTimer <= 0) {
      this.thinkTimer = diff.aiThink + Math.random() * 0.25;
      const dGoal = dist(this.pos, goal);
      const pressure = game.nearestOpponentDist(this);

      // シュート: ゴールに近く角度もあるなら狙う
      if (dGoal < 21 && Math.abs(this.pos.y) < 16 &&
          Math.random() < 0.35 + (21 - dGoal) * 0.05) {
        const aimY = rand(-1, 1) * (PITCH.GOAL_HALF - 0.8) * diff.shootErr;
        game.shoot(this, aimY, rand(0.55, 1.0));
        return;
      }
      // パス: プレッシャーを受けているとき
      if (pressure < 3.5 && Math.random() < 0.75) {
        const target = game.pickPassTarget(this, normTo(this.pos, goal), true);
        if (target) { game.pass(this, target); return; }
      }
      // ドリブル: ゴールへ向かいつつ最寄りの敵を避ける
      let dir = normTo(this.pos, goal);
      const opp = game.nearestOpponent(this);
      if (opp && dist(this.pos, opp.pos) < 4.5) {
        const away = normTo(opp.pos, this.pos);
        dir = norm(dir.x + away.x * 0.8, dir.y + away.y * 0.8);
      }
      this.plan = { type: "dribble", dir };
    }

    if (this.plan && this.plan.type === "dribble") {
      this.moveSpeed = PLAYER_CONF.DRIBBLE_SPEED * diff.aiSpeed;
      this.moveTarget = {
        x: this.pos.x + this.plan.dir.x * 8,
        y: this.pos.y + this.plan.dir.y * 8,
      };
    }
  }

  // 味方がボールを持っているとき: フォーメーション位置を保ちつつ前へ
  aiSupport(game, dt) {
    const diff = game.diffFor(this.team);
    const t = this.formationTarget(game, 7);
    // FW はゴール方向へ裏抜けを狙う
    if (this.role === "FW") {
      t.x = clamp(t.x + this.team.attackDir * 6, -(PITCH.HALF_LEN - 3), PITCH.HALF_LEN - 3);
    }
    this.applySpacing(t, game);
    this.moveSpeed = PLAYER_CONF.RUN_SPEED * 0.88 * diff.aiSpeed;
    this.moveTarget = t;
  }

  // 敵ボール・ルーズボール時: チェイサーは追い、他は帰陣する
  aiDefend(game, dt) {
    const diff = game.diffFor(this.team);
    const ball = game.ball;

    if (this.isChaser) {
      const target = ball.owner
        ? { x: ball.owner.pos.x, y: ball.owner.pos.y }
        : { x: ball.pos.x + ball.vel.x * 0.3, y: ball.pos.y + ball.vel.y * 0.3 };
      this.moveSpeed = PLAYER_CONF.RUN_SPEED * diff.aiSpeed;
      this.moveTarget = target;

      // 近づいたら確率的にタックルを仕掛ける
      if (ball.owner && ball.owner.team !== this.team &&
          dist(this.pos, ball.pos) < ACTION_CONF.TACKLE_RANGE * 0.95 &&
          Math.random() < dt * 1.5 * diff.aiTackleProb) {
        this.tryTackle(game);
      }
    } else {
      const t = this.formationTarget(game, -7);
      this.applySpacing(t, game);
      this.moveSpeed = PLAYER_CONF.RUN_SPEED * 0.85 * diff.aiSpeed;
      this.moveTarget = t;
    }
  }

  // GK: ゴール前でボールに正対し、ペナルティエリア内ではキャッチを狙う
  aiGoalkeeper(game, dt) {
    const ball = game.ball;
    const dir = this.team.attackDir;
    const goalX = -dir * PITCH.HALF_LEN;

    // キャッチ後: 少し保持してから味方へフィードする
    if (ball.owner === this) {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) {
        const target = game.pickPassTarget(this, { x: dir, y: 0 }, true)
          || this.team.outfield()[0];
        if (target) game.pass(this, target, 1.15);
      }
      return;
    }

    const dangerous = game.inPenaltyBox(ball.pos, this.team) &&
      (!ball.owner || ball.owner.team !== this.team);
    if (dangerous) {
      // 飛び出してボールへ
      this.moveSpeed = PLAYER_CONF.GK_SPEED;
      this.moveTarget = { x: ball.pos.x, y: ball.pos.y };
    } else {
      // ゴールライン少し前でボールの高さに合わせて構える
      const ty = clamp(ball.pos.y * 0.35, -(PITCH.GOAL_HALF - 0.4), PITCH.GOAL_HALF - 0.4);
      this.moveSpeed = PLAYER_CONF.GK_SPEED;
      this.moveTarget = { x: goalX + dir * 1.4, y: ty };
    }
  }

  // ボール位置に応じてスライドさせたフォーメーション上の目標位置
  // bias: 攻撃時は + (前寄り) / 守備時は - (自陣寄り)
  formationTarget(game, bias) {
    const dir = this.team.attackDir;
    const ballX = game.ball.pos.x * dir;   // チーム座標 (+ = 敵陣側)
    const shift = clamp(ballX * 0.4, -16, 16) + bias;

    let tx = this.slot.x * PITCH.HALF_LEN * 0.8 + shift;
    tx = clamp(tx, -(PITCH.HALF_LEN - 2), PITCH.HALF_LEN - 2);

    let ty = this.slot.y * PITCH.HALF_WID * 0.8;
    ty += (game.ball.pos.y - ty) * 0.25;   // ボールサイドへ少し寄る

    return { x: tx * dir, y: clamp(ty, -(PITCH.HALF_WID - 2), PITCH.HALF_WID - 2) };
  }

  // 味方と近すぎるときは目標位置を離す (団子状態の防止)
  applySpacing(target, game) {
    for (const mate of this.team.players) {
      if (mate === this || mate.isGK) continue;
      const d = dist(this.pos, mate.pos);
      if (d < 5 && d > 1e-4) {
        const away = normTo(mate.pos, this.pos);
        target.x += away.x * (5 - d) * 0.8;
        target.y += away.y * (5 - d) * 0.8;
      }
    }
  }
}
