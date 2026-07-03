"use strict";

// =====================================================================
// 試合の進行を管理する Game クラス
//
//  状態遷移:
//    freeze   - キックオフ・リスタート直前の静止 (バナー表示)
//    playing  - プレー中
//    goal     - ゴール直後の演出 → キックオフへ
//    halftime - 前半終了 (UI 側で「後半開始」を待つ)
//    fulltime - 試合終了 (UI 側でリザルト表示)
//
//  操作キャラの決定:
//    - 味方がボール保持中 → 保持者を操作 (GK 保持中を除く)
//    - 敵ボール・ルーズボール → ボールに最も近い味方へ自動切替。
//      ただしヒステリシス (SWITCH_CONF) でチャタリングを防止する。
// =====================================================================

class Game {
  constructor(settings) {
    this.halfLength = settings.halfLengthMin * 60;
    this.diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    this.normalDiff = DIFFICULTY.normal;   // ユーザーチームの AI は常に normal

    this.userTeam = new Team(0, "BLUES", true, +1,
      { main: "#2f6fe0", dark: "#173e8f", gk: "#2fb96e" });
    this.cpuTeam = new Team(1, "REDS", false, -1,
      { main: "#e04a3a", dark: "#8f231a", gk: "#c9a227" });
    this.teams = [this.userTeam, this.cpuTeam];

    this.ball = new Ball();
    this.score = [0, 0];
    this.half = 1;
    this.time = 0;

    this.state = "freeze";
    this.freezeTimer = 0;
    this.banner = null;
    this.bannerTimer = 0;

    this.controlled = null;     // ユーザーが操作中の選手
    this.switchLock = 0;        // 自動切替のロック残り時間
    this.shootCharge = -1;      // シュート溜め (0〜1 / -1 = 溜めていない)
    this.pendingKickoffTeam = null;

    this.setupKickoff(this.userTeam, "キックオフ");
  }

  // ---------------- 汎用ヘルパー ----------------

  otherTeam(t) { return t === this.userTeam ? this.cpuTeam : this.userTeam; }
  diffFor(team) { return team.isUser ? this.normalDiff : this.diff; }
  allPlayers() { return this.userTeam.players.concat(this.cpuTeam.players); }
  opponentsOf(team) { return this.otherTeam(team).players; }

  nearestOpponent(p) {
    let best = null, bd = Infinity;
    for (const o of this.opponentsOf(p.team)) {
      const d = dist(p.pos, o.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  nearestOpponentDist(p) {
    const o = this.nearestOpponent(p);
    return o ? dist(p.pos, o.pos) : Infinity;
  }

  // pos が team の自陣ペナルティエリア内か
  inPenaltyBox(pos, team) {
    const goalX = -team.attackDir * PITCH.HALF_LEN;
    return Math.abs(pos.x - goalX) <= PITCH.PENALTY_DEPTH &&
           Math.abs(pos.x) <= PITCH.HALF_LEN &&
           Math.abs(pos.y) <= PITCH.PENALTY_HALF_WIDTH;
  }

  showBanner(text, t) { this.banner = text; this.bannerTimer = t; }

  setFreeze(t, text) {
    this.state = "freeze";
    this.freezeTimer = t;
    this.shootCharge = -1;
    if (text) this.showBanner(text, Math.max(t, 1.2));
  }

  givePossession(p) {
    this.ball.setOwner(p);
    if (p.isGK) p.holdTimer = 1.3;
    if (p.team.isUser && !p.isGK) this.controlled = p;
  }

  // ---------------- キックオフ・前後半 ----------------

  setupKickoff(kickTeam, text) {
    for (const t of this.teams) t.resetToFormation();
    this.ball.reset({ x: 0, y: 0 });
    const striker = kickTeam.players[kickTeam.players.length - 1]; // FW
    striker.pos = { x: -kickTeam.attackDir * 1.2, y: 0 };
    striker.facing = { x: kickTeam.attackDir, y: 0 };
    this.givePossession(striker);
    if (!this.controlled) this.controlled = this.userTeam.players[4]; // 中央MF
    this.setFreeze(1.4, text);
  }

  startSecondHalf() {
    this.half = 2;
    this.time = 0;
    for (const t of this.teams) t.attackDir *= -1;
    this.setupKickoff(this.cpuTeam, "後半キックオフ");
  }

  // 表示用: 試合開始からの通算時間
  displayTime() {
    return (this.half - 1) * this.halfLength + Math.min(this.time, this.halfLength);
  }

  // ---------------- メイン更新 ----------------

  update(dt, input) {
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner = null;
    this.switchLock = Math.max(0, this.switchLock - dt);

    switch (this.state) {
      case "freeze":
        this.freezeTimer -= dt;
        if (this.freezeTimer <= 0) this.state = "playing";
        break;
      case "goal":
        this.freezeTimer -= dt;
        if (this.freezeTimer <= 0) {
          this.setupKickoff(this.pendingKickoffTeam, "キックオフ");
        }
        break;
      case "playing":
        this.time += dt;
        if (this.time >= this.halfLength) {
          this.state = this.half === 1 ? "halftime" : "fulltime";
          return;
        }
        this.updatePlay(dt, input);
        break;
      // halftime / fulltime は UI 側 (main.js) が処理する
    }
  }

  updatePlay(dt, input) {
    this.updateSwitching(input);
    this.userTeam.assignChasers(this);
    this.cpuTeam.assignChasers(this);

    for (const p of this.allPlayers()) {
      if (p === this.controlled) this.updateUserControl(p, input, dt);
      else p.updateAI(this, dt);
      p.update(this, dt);
    }

    this.resolveCollisions();
    this.ball.update(dt);
    if (!this.ball.owner) this.tryPickups();
    this.checkGoalAndOut();
  }

  // ---------------- 操作キャラの自動切替 ----------------

  updateSwitching(input) {
    const ball = this.ball;
    const owner = ball.owner;

    // 味方の保持者 (GK 以外) は常に操作対象
    if (owner && owner.team === this.userTeam && !owner.isGK) {
      this.controlled = owner;
      return;
    }

    // 守備・ルーズボール時: ボールの予測位置に最も近い味方を候補にする
    const pred = { x: ball.pos.x + ball.vel.x * 0.4, y: ball.pos.y + ball.vel.y * 0.4 };
    const cands = this.userTeam.outfield()
      .filter((p) => p.state !== "getup" && p.state !== "stumble");
    if (cands.length === 0) return;

    let best = null, bestD = Infinity;
    for (const p of cands) {
      const d = dist(p.pos, pred);
      if (d < bestD) { bestD = d; best = p; }
    }

    const cur = this.controlled;
    if (!cur || cur.isGK) {
      this.controlled = best;
      this.switchLock = SWITCH_CONF.LOCK_TIME;
      return;
    }

    // Space で手動切替 (ロックを無視して即切替)
    if (input.wasPressed("Space")) {
      if (best !== cur) {
        this.controlled = best;
        this.switchLock = SWITCH_CONF.LOCK_TIME;
      }
      return;
    }

    if (best === cur) return;
    const curD = dist(cur.pos, pred);
    // ヒステリシス: ロック解除後、かつ十分な差があるときだけ切替える
    if (this.switchLock <= 0 &&
        (bestD < curD * SWITCH_CONF.RATIO || curD - bestD > SWITCH_CONF.ABS_GAP)) {
      this.controlled = best;
      this.switchLock = SWITCH_CONF.LOCK_TIME;
    }
  }

  // ---------------- ユーザー操作 ----------------

  updateUserControl(p, input, dt) {
    const ball = this.ball;
    const hasBall = ball.owner === p;

    if (p.busy) {
      if (this.shootCharge >= 0) this.shootCharge = -1;
      return;
    }

    const ax = input.axis();
    const charging = this.shootCharge >= 0;
    const dash = input.isDown("ShiftLeft") || input.isDown("ShiftRight") ||
                 (hasBall && input.isDown("KeyC"));

    let speed;
    if (hasBall) speed = dash ? PLAYER_CONF.DASH_DRIBBLE_SPEED : PLAYER_CONF.DRIBBLE_SPEED;
    else speed = dash ? PLAYER_CONF.DASH_SPEED : PLAYER_CONF.RUN_SPEED;
    if (charging) speed *= 0.4;   // シュートを溜めている間は減速

    if (ax) {
      p.moveTarget = { x: p.pos.x + ax.x * 10, y: p.pos.y + ax.y * 10 };
      p.moveSpeed = speed;
      p.facing = { x: ax.x, y: ax.y };
    } else {
      p.moveTarget = null;
    }

    if (hasBall) {
      // ---- 攻撃時: Z = パス / X = シュート (長押しで強く) ----
      if (input.wasPressed("KeyZ")) {
        const dir = ax || { x: p.facing.x, y: p.facing.y };
        const target = this.pickPassTarget(p, dir, false);
        if (target) {
          this.pass(p, target);
          this.controlled = target;       // パスと同時に受け手へ操作を移す
          this.switchLock = 0.4;
        }
        return;
      }
      if (input.wasPressed("KeyX")) this.shootCharge = 0;
      if (this.shootCharge >= 0) {
        this.shootCharge = Math.min(1, this.shootCharge + dt / ACTION_CONF.SHOOT_CHARGE_TIME);
        if (input.wasReleased("KeyX") || this.shootCharge >= 1) {
          const aimY = ax ? ax.y * 2.6 : 0;   // 上下入力でコースを打ち分け
          this.shoot(p, aimY, this.shootCharge);
          this.shootCharge = -1;
        }
      }
    } else {
      // ---- 守備時: Z = カット / X = スライディング / C = 体当たり ----
      if (this.shootCharge >= 0) this.shootCharge = -1;
      if (input.wasPressed("KeyZ")) p.tryTackle(this);
      else if (input.wasPressed("KeyX")) p.trySlide(this);
      else if (input.wasPressed("KeyC")) p.tryCharge(this);
    }
  }

  // ---------------- キック (パス・シュート) ----------------

  pass(from, to, powerMul = 1) {
    const d = dist(from.pos, to.pos);
    const speed = clamp(9 + d * 0.85,
      ACTION_CONF.PASS_SPEED_MIN, ACTION_CONF.PASS_SPEED_MAX) * powerMul;
    // 受け手の移動を先読みして少し前へ出す
    const t = d / speed;
    const lead = { x: to.pos.x + to.vel.x * t * 0.8, y: to.pos.y + to.vel.y * t * 0.8 };
    this.ball.kick(from, normTo(from.pos, lead), speed);
    from.thinkTimer = 0.3;
  }

  shoot(p, aimY, power) {
    const goalX = PITCH.HALF_LEN * p.team.attackDir;
    const dGoal = Math.hypot(goalX - p.pos.x, p.pos.y);
    // 強打・遠距離ほどブレる
    const err = (Math.random() - 0.5) * (1.2 + power * 2.2 + dGoal * 0.08);
    const targetY = clamp(aimY, -(PITCH.GOAL_HALF - 0.5), PITCH.GOAL_HALF - 0.5) + err;
    const speed = ACTION_CONF.SHOOT_SPEED_MIN +
      power * (ACTION_CONF.SHOOT_SPEED_MAX - ACTION_CONF.SHOOT_SPEED_MIN);
    this.ball.kick(p, normTo(p.pos, { x: goalX, y: targetY }), speed);
  }

  // パス先の選択: 入力方向との一致度・距離・パスコース上の敵で採点する
  // aiMode = true のときは前進するパスを優先する
  pickPassTarget(p, dir, aiMode) {
    let best = null, bestScore = -Infinity;
    for (const mate of p.team.players) {
      if (mate === p) continue;
      const d = dist(p.pos, mate.pos);
      if (d < 3 || d > 45) continue;
      const n = normTo(p.pos, mate.pos);
      const align = dot(n, dir);
      if (align < -0.3) continue;   // 真後ろへのパスは選ばない

      let score = align * 24 - Math.abs(d - 14) * 0.5;
      if (mate.isGK) score -= 30;
      if (mate.busy) score -= 15;
      // パスコース上に敵が居たら減点
      for (const opp of this.opponentsOf(p.team)) {
        if (pointSegDist(opp.pos, p.pos, mate.pos) < 1.4) score -= 18;
      }
      if (aiMode) {
        score += (mate.pos.x - p.pos.x) * p.team.attackDir * 0.4;
      }
      if (score > bestScore) { bestScore = score; best = mate; }
    }
    return best;
  }

  // ---------------- ボール処理 ----------------

  // フリーのボールを近くの選手がトラップする
  tryPickups() {
    const ball = this.ball;
    const speed = vlen(ball.vel);
    const players = this.allPlayers()
      .slice()
      .sort((a, b) => dist(a.pos, ball.pos) - dist(b.pos, ball.pos));

    for (const p of players) {
      const d = dist(p.pos, ball.pos);
      if (d > 3) break;   // 距離順なのでこれ以上は誰も届かない
      if (p.state !== "normal") continue;
      if (ball.shieldTimer > 0 && ball.shieldPlayer === p) continue;

      const gkCatch = p.isGK && this.inPenaltyBox(ball.pos, p.team);
      const radius = gkCatch ? 1.6 : BALL_CONF.CONTROL_RADIUS;
      const maxSpeed = gkCatch ? 34 : BALL_CONF.CONTROL_MAX_SPEED;
      if (d > radius) continue;

      if (speed <= maxSpeed) {
        this.givePossession(p);
        return;
      }
      // 速すぎるボールは体に当たって勢いを失う
      if (d < 0.7) {
        ball.vel.x *= 0.3;
        ball.vel.y *= 0.3;
        ball.lastTouchTeam = p.team;
        return;
      }
    }
  }

  // 選手同士の重なりを解消する
  resolveCollisions() {
    const ps = this.allPlayers();
    const minD = PLAYER_CONF.RADIUS * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const d = dist(a.pos, b.pos);
        if (d < minD && d > 1e-4) {
          const n = normTo(a.pos, b.pos);
          const push = (minD - d) / 2;
          a.pos.x -= n.x * push; a.pos.y -= n.y * push;
          b.pos.x += n.x * push; b.pos.y += n.y * push;
        }
      }
    }
  }

  // ---------------- ゴール・アウトオブプレー ----------------

  checkGoalAndOut() {
    const b = this.ball.pos;

    // ゴール判定 (ドリブルで押し込んだ場合も含む)
    if (Math.abs(b.x) > PITCH.HALF_LEN + 0.2 && Math.abs(b.y) <= PITCH.GOAL_HALF) {
      const scorer = this.teams.find((t) => t.attackDir === Math.sign(b.x));
      this.onGoal(scorer);
      return;
    }

    if (this.ball.owner) return;   // 保持中は選手ごとクランプされるためアウトなし

    // タッチライン → キックイン
    if (Math.abs(b.y) > PITCH.HALF_WID + 0.5) {
      const team = this.otherTeam(this.ball.lastTouchTeam || this.cpuTeam);
      const pos = {
        x: clamp(b.x, -(PITCH.HALF_LEN - 1.5), PITCH.HALF_LEN - 1.5),
        y: Math.sign(b.y) * (PITCH.HALF_WID - 0.9),
      };
      this.doRestart("キックイン", team, pos);
      return;
    }

    // ゴールライン → コーナーキック or ゴールキック
    if (Math.abs(b.x) > PITCH.HALF_LEN + 0.5) {
      const side = Math.sign(b.x);
      const defTeam = this.teams.find((t) => t.attackDir === -side); // このサイドが自陣のチーム
      if (this.ball.lastTouchTeam === defTeam) {
        const atkTeam = this.otherTeam(defTeam);
        const pos = {
          x: side * (PITCH.HALF_LEN - 1),
          y: Math.sign(b.y || 1) * (PITCH.HALF_WID - 1),
        };
        this.doRestart("コーナーキック", atkTeam, pos);
      } else {
        this.doRestart("ゴールキック", defTeam, { x: side * (PITCH.HALF_LEN - 6), y: 0 }, true);
      }
    }
  }

  onGoal(team) {
    this.score[team.id]++;
    this.state = "goal";
    this.freezeTimer = 2.5;
    this.showBanner("GOAL!!  " + team.name, 2.4);
    this.pendingKickoffTeam = this.otherTeam(team);
  }

  // アウトオブプレー後のリスタート (キックイン / コーナー / ゴールキック)
  doRestart(label, team, pos, useGK = false) {
    this.ball.reset(pos);

    let taker;
    if (useGK) {
      taker = team.gk;
    } else {
      taker = team.outfield()
        .slice()
        .sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0];
    }
    taker.pos = { x: pos.x, y: pos.y };
    taker.vel = { x: 0, y: 0 };
    taker.state = "normal";
    taker.stateTimer = 0;
    taker.facing = norm(-pos.x, -pos.y);   // フィールド中央方向を向く

    // 相手選手はスポットから距離を取らせる
    for (const opp of this.opponentsOf(team)) {
      if (dist(opp.pos, pos) < 6) {
        const away = normTo(pos, opp.pos);
        opp.pos = {
          x: clamp(pos.x + away.x * 7, -(PITCH.HALF_LEN - 1), PITCH.HALF_LEN - 1),
          y: clamp(pos.y + away.y * 7, -(PITCH.HALF_WID - 1), PITCH.HALF_WID - 1),
        };
      }
    }

    this.givePossession(taker);
    this.setFreeze(1.1, label);
  }
}
