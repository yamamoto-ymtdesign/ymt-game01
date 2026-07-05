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
    this.volley = null;         // ダイレクトシュートの状態 {active, failed}
    this.restartPassOnly = false; // リスタート(キックイン等)はパス以外禁止
    this.restartTaker = null;     // リスタートの出し手

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

  // ユーザーチームが守備状態か。
  // 相手がボールを保持しているか、相手が最後に触ったルーズボールのときだけ true。
  // 味方が保持してから相手が触るまで (パスの飛行中を含む) は攻撃状態のままにする。
  userDefending() {
    const owner = this.ball.owner;
    if (owner) return owner.team !== this.userTeam;
    return this.ball.lastTouchTeam !== this.userTeam;
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
    // 味方GKが保持した場合も操作キャラにする (ロングキック/パスを選べるようにする)
    if (p.team.isUser) this.controlled = p;
  }

  // ---------------- キックオフ・前後半 ----------------

  setupKickoff(kickTeam, text) {
    for (const t of this.teams) t.resetToFormation();
    this.ball.reset({ x: 0, y: 0 });
    const striker = kickTeam.players[kickTeam.players.length - 1]; // FW
    striker.pos = { x: -kickTeam.attackDir * 1.2, y: 0 };
    striker.facing = { x: kickTeam.attackDir, y: 0 };
    this.givePossession(striker);
    if (!this.controlled) this.controlled = this.userTeam.players[5]; // 中央MF
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
    // リスタートの出し手がボールを手放したら「パスのみ」制限を解除
    if (this.restartPassOnly && this.ball.owner !== this.restartTaker) {
      this.restartPassOnly = false;
      this.restartTaker = null;
    }
    this.updateSwitching(input);
    this.updateVolleyState();
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

    // 味方の保持者は常に操作対象 (GK 保持中も含む)
    if (owner && owner.team === this.userTeam) {
      this.controlled = owner;
      return;
    }

    // 守備・ルーズボール時: 「ボールと自ゴールを結ぶ直線」の近くに居て
    // ボールに近い味方を優先する (ボールより敵ゴール側の選手では守備できないため)
    const pred = { x: ball.pos.x + ball.vel.x * 0.4, y: ball.pos.y + ball.vel.y * 0.4 };
    const cands = this.userTeam.outfield()
      .filter((p) => p.state !== "getup" && p.state !== "stumble");
    if (cands.length === 0) return;

    // 守備時はゴールサイド優先の採点、味方パスの飛行中は単純にボールへの近さ
    const score = this.userDefending()
      ? (p) => this.defensiveScore(p, pred)
      : (p) => dist(p.pos, pred);

    let best = null, bestS = Infinity;
    for (const p of cands) {
      const sc = score(p);
      if (sc < bestS) { bestS = sc; best = p; }
    }

    const cur = this.controlled;
    if (!cur || cur.isGK) {
      this.controlled = best;
      this.switchLock = SWITCH_CONF.LOCK_TIME;
      return;
    }

    // Space で手動切替: 守備優先度の高い順に巡回する
    // (押すたびに次の候補へ。自動切替より長めにロック)
    if (input.wasPressed("Space")) {
      const sorted = cands.slice().sort((a, b) => score(a) - score(b));
      const idx = sorted.indexOf(cur);
      this.controlled = sorted[(idx + 1) % sorted.length];
      this.switchLock = SWITCH_CONF.MANUAL_LOCK_TIME;
      return;
    }

    if (best === cur) return;
    const curS = score(cur);
    // ヒステリシス: ロック解除後、かつ十分な差があるときだけ切替える
    if (this.switchLock <= 0 &&
        (bestS < curS * SWITCH_CONF.RATIO || curS - bestS > SWITCH_CONF.ABS_GAP)) {
      this.controlled = best;
      this.switchLock = SWITCH_CONF.LOCK_TIME;
    }
  }

  // 守備時の切替優先度 (小さいほど優先)。
  // 「ボール → 自ゴール」を結ぶ線分への距離と、ボールまでの距離で採点し、
  // ボールより敵ゴール側 (ゴールサイドでない) の選手には大きなペナルティを課す。
  defensiveScore(p, ballPos) {
    const ownGoal = { x: -this.userTeam.attackDir * PITCH.HALF_LEN, y: 0 };
    const dBall = dist(p.pos, ballPos);
    const lineDist = pointSegDist(p.pos, ballPos, ownGoal);
    const toGoal = normTo(ballPos, ownGoal);
    const rel = { x: p.pos.x - ballPos.x, y: p.pos.y - ballPos.y };
    const goalSide = dot(rel, toGoal) > -2;   // 2m までは許容
    return dBall + lineDist * 1.2 + (goalSide ? 0 : 25);
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
    // C は攻守共通でダッシュ
    const dash = input.isDown("ShiftLeft") || input.isDown("ShiftRight") ||
                 input.isDown("KeyC");

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

    if (hasBall && p.isGK) {
      // ---- 味方GKが保持: Z = ロングキック / X = 近くの味方へショートパス ----
      // (ゴールキックのリスタートもここで処理するため restartPassOnly より先に判定)
      if (input.wasPressed("KeyZ")) {
        this.gkLongKick(p, ax);
        return;
      }
      if (input.wasPressed("KeyX")) {
        const target = this.pickNearestTeammate(p, ax);
        if (target) {
          this.pass(p, target);
          this.controlled = target;
          this.switchLock = 0.4;
        } else {
          this.gkLongKick(p, ax);   // 近くに味方が居なければロングキックで逃がす
        }
      }
      return;
    }

    if (hasBall && this.restartPassOnly) {
      // ---- リスタート (キックイン等): パスのみ。移動せず向きだけ変えられる ----
      p.moveTarget = null;
      if (ax) p.facing = { x: ax.x, y: ax.y };
      if (input.wasPressed("KeyZ")) {
        const dir = ax || { x: p.facing.x, y: p.facing.y };
        const target = this.pickPassTarget(p, dir, false);
        if (target) {
          this.pass(p, target);
          this.controlled = target;
          this.switchLock = 0.4;
        } else {
          // 万一パス相手が見つからなければ向いている方向へ蹴り出す
          this.ball.kick(p, dir, 12);
        }
      }
      return;
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
      if (this.shootCharge >= 0) this.shootCharge = -1;
      if (this.userDefending()) {
        // ---- 守備時: Z / X = スライディング ----
        // 味方保持中・味方パスの飛行中は守備状態にならないため発動しない
        // (パスを出した同一フレームで受け手に操作が移り、押したままの
        //  キーで受け手がスライディングしてしまう誤爆の防止)
        if (input.wasPressed("KeyZ") || input.wasPressed("KeyX")) {
          p.trySlide(this);
        }
      } else if (this.volley) {
        // ---- 味方パスの飛行中: X = ダイレクトシュート / Z = ワンタッチパス ----
        // 受け手が光っている間 (VOLLEY_CONF.WINDOW 秒) だけ成立。
        // 窓の外で押すと、そのパスでの権利を失う (連打対策)。X/Z は独立に判定
        if (input.wasPressed("KeyX")) {
          if (this.volley.active) this.doVolley(p, ax);
          else this.volley.failed = true;
        }
        if (input.wasPressed("KeyZ")) {
          if (this.volley.passActive) this.doOneTouchPass(p, ax);
          else this.volley.passFailed = true;
        }
      }
    }
  }

  // ---------------- キック (パス・シュート) ----------------

  pass(from, to, powerMul = 1) {
    this.passFrom(from, from.pos, to, powerMul);
  }

  // origin からパスを出す (通常のパスとワンタッチパスで共用)
  passFrom(from, origin, to, powerMul = 1) {
    const d = dist(origin, to.pos);
    const speed = clamp(9 + d * 0.85,
      ACTION_CONF.PASS_SPEED_MIN, ACTION_CONF.PASS_SPEED_MAX) * powerMul;
    // 受け手の移動を先読みして少し前へ出す
    const t = d / speed;
    const lead = { x: to.pos.x + to.vel.x * t * 0.8, y: to.pos.y + to.vel.y * t * 0.8 };
    this.ball.kick(from, normTo(origin, lead), speed);
    from.thinkTimer = 0.3;
  }

  // GK のロングキック: 前方の味方 (居なければ入力方向) へ強く蹴り出す
  gkLongKick(gk, ax) {
    const dir = ax || { x: gk.team.attackDir, y: 0 };
    const speed = ACTION_CONF.GK_LONG_KICK_SPEED;
    const target = this.pickPassTarget(gk, dir, true, false, ACTION_CONF.GK_LONG_KICK_RANGE);
    let outDir;
    if (target) {
      const t = dist(gk.pos, target.pos) / speed;
      const lead = {
        x: target.pos.x + target.vel.x * t * 0.7,
        y: target.pos.y + target.vel.y * t * 0.7,
      };
      outDir = normTo(gk.pos, lead);
    } else {
      outDir = norm(dir.x, dir.y);
    }
    this.ball.kick(gk, outDir, speed);
    gk.thinkTimer = 0.3;
  }

  // GK のショートパス相手を選ぶ: 純粋に「近さ」優先 (通常パスの中距離優先とは別基準)
  pickNearestTeammate(p, dir) {
    let best = null, bestScore = -Infinity;
    for (const mate of p.team.players) {
      if (mate === p) continue;
      const d = dist(p.pos, mate.pos);
      if (d < 2.5 || d > 30) continue;
      const align = dir ? dot(normTo(p.pos, mate.pos), dir) : 0;
      if (dir && align < -0.3) continue;
      let score = -d + align * 6;
      if (mate.busy) score -= 10;
      for (const opp of this.opponentsOf(p.team)) {
        if (pointSegDist(opp.pos, p.pos, mate.pos) < 1.4) score -= 15;
      }
      if (score > bestScore) { bestScore = score; best = mate; }
    }
    return best;
  }

  shoot(p, aimY, power) {
    this.shootFrom(p, p.pos, aimY, power);
  }

  // origin の位置からゴールへ向けて蹴る (通常シュートとダイレクトシュートで共用)
  shootFrom(p, origin, aimY, power) {
    const goalX = PITCH.HALF_LEN * p.team.attackDir;
    const dGoal = Math.hypot(goalX - origin.x, origin.y);
    // 近距離ほど正確。強打の精度ペナルティは控えめにして溜める価値を出す
    const err = (Math.random() - 0.5) * (0.8 + power * 1.0 + dGoal * 0.1);
    const targetY = clamp(aimY, -(PITCH.GOAL_HALF - 0.5), PITCH.GOAL_HALF - 0.5) + err;
    const speed = ACTION_CONF.SHOOT_SPEED_MIN +
      power * (ACTION_CONF.SHOOT_SPEED_MAX - ACTION_CONF.SHOOT_SPEED_MIN);
    const dir = normTo(origin, { x: goalX, y: targetY });
    this.ball.kick(p, dir, speed);
  }

  // ---------------- ワンタッチアクション (ダイレクトシュート / ワンタッチパス) ----------------

  // 毎フレーム、受け手が「光る窓」の中に居るかを判定する。
  // 条件: 味方が蹴ったボールが飛行中 / ボールが操作キャラ(=受け手)へ向かっていて、
  //       トラップ圏に入るまで WINDOW 秒以内。
  // ダイレクトシュート(X)は相手ゴールから ZONE 以内でのみ成立し、
  // ワンタッチパス(Z)はピッチのどこでも成立する。成否 (failed/passFailed) は独立管理。
  updateVolleyState() {
    const ball = this.ball;
    if (ball.owner || ball.lastTouchTeam !== this.userTeam) {
      this.volley = null;
      return;
    }
    if (!this.volley) {
      this.volley = { active: false, failed: false, passActive: false, passFailed: false };
    }

    const r = this.controlled;
    const speed = vlen(ball.vel);
    let windowOpen = false;
    if (r && !r.busy && speed >= VOLLEY_CONF.MIN_BALL_SPEED) {
      const approaching = dot(ball.vel, { x: r.pos.x - ball.pos.x, y: r.pos.y - ball.pos.y }) > 0;
      // トラップ圏 (CONTROL_RADIUS) に入るまでの残り時間で判定する。
      // トラップされた瞬間に窓は閉じるので、光る時間はほぼ WINDOW 秒になる
      const tArrive = Math.max(0, dist(ball.pos, r.pos) - BALL_CONF.CONTROL_RADIUS) / speed;
      windowOpen = approaching && tArrive <= VOLLEY_CONF.WINDOW;
    }
    const goalX = r ? PITCH.HALF_LEN * this.userTeam.attackDir : 0;
    const dGoal = r ? Math.hypot(goalX - r.pos.x, r.pos.y) : Infinity;
    this.volley.active = windowOpen && !this.volley.failed && dGoal < VOLLEY_CONF.ZONE;
    this.volley.passActive = windowOpen && !this.volley.passFailed;
  }

  // ダイレクトシュートの実行: トラップせずボールの現在位置から直接ゴールへ
  doVolley(p, ax) {
    const aimY = ax ? ax.y * 2.6 : 0;   // 通常シュートと同じく上下でコース調整
    this.shootFrom(p, this.ball.pos, aimY, VOLLEY_CONF.POWER);
    p.kickAnim = 0.28;
    this.volley = null;
  }

  // ワンタッチパスの実行 (ワンツーなど): トラップせずボールの現在位置から
  // 別の味方へ即座に繋ぐ。入力方向に居なければ通常パスと同じ基準で選ぶ
  doOneTouchPass(p, ax) {
    const dir = ax || { x: p.facing.x, y: p.facing.y };
    const target = this.pickPassTarget(p, dir, false);
    if (!target) return;   // 見つからなければ通常通りトラップさせる (窓はまだ開いたまま)
    this.passFrom(p, this.ball.pos, target);
    this.controlled = target;
    this.switchLock = 0.4;
    this.volley = null;
  }

  // パス先の選択: 入力方向との一致度・距離・パスコース上の敵で採点する
  // aiMode = true のときは前進するパスを優先する
  // relax = true のときは方向の制限を外す (入力方向に誰も居ないときの再検索)
  // maxDist: 候補とする距離の上限 (GK のロングキックでは通常より広く取る)
  pickPassTarget(p, dir, aiMode, relax = false, maxDist = 45) {
    let best = null, bestScore = -Infinity;
    for (const mate of p.team.players) {
      if (mate === p) continue;
      const d = dist(p.pos, mate.pos);
      if (d < 3 || d > maxDist) continue;
      const n = normTo(p.pos, mate.pos);
      const align = dot(n, dir);
      if (!relax && align < -0.3) continue;   // 真後ろへのパスは選ばない

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
    // 入力方向に候補が居なければ、方向制限なしで探し直す (パスの不発防止)
    if (!best && !relax) return this.pickPassTarget(p, dir, aiMode, true, maxDist);
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
      // 強シュートほどGKの届く範囲は狭くなる
      const radius = gkCatch
        ? (speed > ACTION_CONF.GK_CATCH_MAX_SPEED ? 1.3 : 1.6)
        : BALL_CONF.CONTROL_RADIUS;
      if (d > radius) continue;

      if (speed <= BALL_CONF.CONTROL_MAX_SPEED) {
        this.givePossession(p);
        return;
      }
      if (gkCatch) {
        this.gkHandleShot(p);
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

  // GKがシュートに対応する: キャッチ / 弾く(パリー) / 反応できず抜かれる
  gkHandleShot(gk) {
    const ball = this.ball;
    const speed = vlen(ball.vel);

    // 十分遅ければキャッチ
    if (speed <= ACTION_CONF.GK_CATCH_MAX_SPEED) {
      this.givePossession(gk);
      return;
    }

    // 強シュート: 至近距離ほどGKが反応しきれず正面でも抜ける
    const goalX = -gk.team.attackDir * PITCH.HALF_LEN;
    const dGoal = Math.hypot(ball.pos.x - goalX, ball.pos.y);
    const breakProb = clamp((speed - 27) / 15, 0, 0.45) *
                      clamp((14 - dGoal) / 14, 0, 1);
    if (Math.random() < breakProb) {
      // 飛びつくが触れずに抜かれる
      gk.stumble(0.6);
      ball.vel.x *= 0.92;
      ball.vel.y *= 0.92;
      ball.shieldPlayer = gk;
      ball.shieldTimer = 0.5;
      return;
    }

    // パリー: 横〜手前に弾き、GKはしばらく倒れて動けない (こぼれ球チャンス)
    const inDir = norm(ball.vel.x, ball.vel.y);
    const side = ball.pos.y >= gk.pos.y ? 1 : -1;
    const perp = { x: -inDir.y * side, y: inDir.x * side };
    const out = norm(perp.x - inDir.x * 0.35, perp.y - inDir.y * 0.35);
    const outSpeed = Math.max(7, speed * ACTION_CONF.GK_PARRY_REBOUND);
    ball.vel = { x: out.x * outSpeed, y: out.y * outSpeed };
    ball.lastTouchTeam = gk.team;
    ball.shieldPlayer = gk;
    ball.shieldTimer = 0.5;
    gk.stumble(ACTION_CONF.GK_PARRY_TIME);
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
    // リスタートは必ずパスから始める (ドリブル・シュート禁止)
    this.restartPassOnly = true;
    this.restartTaker = taker;
    this.setFreeze(1.1, label);
  }
}
