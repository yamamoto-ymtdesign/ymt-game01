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

// PK戦: CPU が選ぶコース (キッカー/キーパーとも完全ランダム)
function randomPKZone() {
  return {
    col: Math.floor(Math.random() * PK_AIM_CONF.COLS),
    row: Math.floor(Math.random() * PK_AIM_CONF.ROWS),
  };
}

class Game {
  constructor(settings) {
    this.halfLength = settings.halfLengthMin * 60;
    const baseDiff = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    // トーナメントではラウンドが進むごとに敵AIを少し強くする (diffScale)。
    // 単発試合では settings.diffScale が渡されないので常に等倍のまま
    this.diff = this.scaleDifficulty(baseDiff, settings.diffScale || 1);
    this.normalDiff = DIFFICULTY.normal;   // ユーザーチームの AI は常に normal

    // トーナメントモードでは対戦相手のプリセット (名前・カラー) が渡される。
    // 単発試合では常に REDS 固定 (従来通り)
    const cpuPreset = settings.cpuPreset || TOURNAMENT_TEAMS[0];
    this.userTeam = new Team(0, "BLUES", true, +1,
      { main: "#2f6fe0", dark: "#173e8f", gk: "#2fb96e" });
    this.cpuTeam = new Team(1, cpuPreset.name, false, -1, cpuPreset.colors);
    this.teams = [this.userTeam, this.cpuTeam];

    // トーナメント進行中だけセットされる (HUD表示用)。単発試合では null
    this.roundLabel = settings.roundLabel || null;

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
    this.crossCharge = -1;      // クロス長押し (0〜HOLD_TIME / -1 = 長押ししていない)
    this.pendingKickoffTeam = null;
    this.volley = null;         // ダイレクトシュートの状態 {active, failed}
    this.restartPassOnly = false; // リスタート(キックイン等)はパス以外禁止
    this.restartTaker = null;     // リスタートの出し手
    this.inputIdleFrames = 0;     // ユーザーが無入力のまま経過したフレーム数
    this.pk = null;               // PK戦の状態 (試合が同点で終わったときだけ生成)
    this.offsideFlash = null;     // オフサイドライン表示演出 {x, timer}

    this.setupKickoff(this.userTeam, "キックオフ");
  }

  // 難易度プリセットを scale 倍だけ強く (弱く) した新しいオブジェクトを返す。
  // 元の DIFFICULTY オブジェクトは書き換えない (他の試合と共有されているため)
  scaleDifficulty(base, scale) {
    if (scale === 1) return base;
    return {
      aiSpeed: base.aiSpeed * scale,
      aiTackleProb: Math.min(1.6, base.aiTackleProb * scale),
      aiThink: base.aiThink / scale,
      shootErr: base.shootErr / scale,
    };
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
    this.crossCharge = -1;
    if (text) this.showBanner(text, Math.max(t, 1.2));
  }

  givePossession(p) {
    this.ball.setOwner(p);
    if (p.isGK) p.holdTimer = 1.3;
    // 味方GKが保持した場合も操作キャラにする (ロングキック/パスを選べるようにする)
    if (p.team.isUser) this.controlled = p;
  }

  // ---------------- ファウル (軽量版: スライディングのみ対象) ----------------

  // tackler が victim をスライディングで転ばせた瞬間に呼ばれる。
  // 確率でファウルを取り、取った場合は true を返す (呼び出し元はそこで
  // 通常のボール処理を打ち切る)。victim の背後から入った (追い越しざまに
  // 刈った) 場合は高確率、それ以外は低確率で笛が鳴る
  maybeCallFoul(tackler, victim) {
    const fromBehind = dot(tackler.slideDir, victim.facing) > 0.3;
    const prob = fromBehind ? FOUL_CONF.BEHIND_PROB : FOUL_CONF.BASE_PROB;
    if (Math.random() >= prob) return false;

    tackler.fouls++;
    const carded = tackler.fouls >= 2;
    // doRestart() 内の setFreeze() がバナーを上書きするため、ここでは
    // showBanner を呼ばず、ファウルの内容自体をリスタートのラベルとして渡す
    const label = (carded ? "警告(" + tackler.fouls + "枚目)! " : "ファウル! ") +
      tackler.team.name + " #" + tackler.num;
    const spot = {
      x: clamp(victim.pos.x, -(PITCH.HALF_LEN - 1), PITCH.HALF_LEN - 1),
      y: clamp(victim.pos.y, -(PITCH.HALF_WID - 1), PITCH.HALF_WID - 1),
    };
    this.doRestart(label, victim.team, spot);
    return true;
  }

  // ---------------- オフサイド ----------------

  // from が to へパスを出した瞬間、to がオフサイドポジションにいるか判定する。
  // キックイン/コーナー/ゴールキックなどのリスタートは対象外 (実際のルール通り)。
  // 相手陣内かつ、相手の最終ライン (GKを除く最も後ろの選手) より前に出ていて、
  // かつパスの出し手より前にいる場合にオフサイドとする
  checkOffside(from, to) {
    if (this.restartPassOnly) return false;
    if (to.isGK) return false;
    const dir = from.team.attackDir;
    const af = (pos) => pos.x * dir;   // 攻撃方向を + とした前進度
    if (af(to.pos) <= 0) return false;                // 自陣なら対象外
    if (af(to.pos) <= af(from.pos) + 0.3) return false;  // ボールより前でなければ対象外

    const oppOutfield = this.opponentsOf(from.team).filter((p) => !p.isGK);
    if (oppOutfield.length === 0) return false;
    const lineDepth = Math.max(...oppOutfield.map((p) => af(p.pos)));
    return af(to.pos) > lineDepth + 0.3;   // 僅かでも並んでいればオンサイド
  }

  callOffside(from, to) {
    // doRestart() 内の setFreeze() がバナーを上書きするため、ラベル文字列で
    // 「オフサイド」だと分かるようにする (showBanner を別途呼ぶ必要はない)
    this.offsideFlash = { x: to.pos.x, timer: 1.3 };
    const defTeam = this.otherTeam(from.team);
    const spot = {
      x: clamp(to.pos.x, -(PITCH.HALF_LEN - 1), PITCH.HALF_LEN - 1),
      y: clamp(to.pos.y, -(PITCH.HALF_WID - 1), PITCH.HALF_WID - 1),
    };
    this.doRestart("オフサイド: フリーキック", defTeam, spot);
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
    // ハーフタイムでスタミナを少しだけ回復させる (完全回復はしない)
    for (const p of this.allPlayers()) {
      p.stamina = Math.min(STAMINA_CONF.MAX, p.stamina + STAMINA_CONF.HALFTIME_RECOVER);
    }
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
    if (this.offsideFlash) {
      this.offsideFlash.timer -= dt;
      if (this.offsideFlash.timer <= 0) this.offsideFlash = null;
    }
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
          if (this.half === 1) { this.state = "halftime"; return; }
          // 後半終了時に同点なら PK 戦へ。それ以外はそのまま試合終了
          if (this.score[0] === this.score[1]) { this.startPK(); return; }
          this.state = "fulltime";
          return;
        }
        this.updatePlay(dt, input);
        break;
      case "pk":
        this.updatePK(dt, input);
        break;
      case "pk_done":
        this.freezeTimer -= dt;
        if (this.freezeTimer <= 0) this.state = "fulltime";
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
    // 矢印キー/アクションキーが何も入力されていないフレーム数を数える
    // (自動切替は、操作中に横取りされないよう無入力が続いたときだけ行う)
    if (this.hasUserInput(input)) this.inputIdleFrames = 0;
    else this.inputIdleFrames++;

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

  // 移動・アクションのいずれかのキーが入力されているか (Space による
  // 手動切替は含めない。自動切替の抑制判定にのみ使う)
  hasUserInput(input) {
    return input.axis() !== null ||
      input.isDown("KeyZ") || input.isDown("KeyX");
  }

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
    // タックル・スライディングなど動作中は、その動作が終わるまで絶対に
    // 横取りしない (アクションを起こした瞬間に権限が移ってしまうのを防止)
    if (cur && cur.busy) return;
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
    // 現在の操作キャラが「ボールそのものから」離れすぎている場合だけ、
    // 入力中でも (無入力を待たず) 強制的に切替える。defensiveScore には
    // 前掛かりペナルティ等が乗るため、ボール至近距離でタックルに向かって
    // いる最中に誤って切り替わらないよう、ここは純粋な距離だけで判定する
    const curBallDist = dist(cur.pos, pred);
    const farOverride = curBallDist > SWITCH_CONF.FAR_OVERRIDE_GAP;
    // ヒステリシス: ロック解除後・(無入力が一定フレーム続いた or 遠すぎる)後、
    // かつ十分な差があるときだけ切替える (操作中の横取り防止)
    if (this.switchLock <= 0 &&
        (this.inputIdleFrames >= SWITCH_CONF.IDLE_FRAMES || farOverride) &&
        (bestS < curS * SWITCH_CONF.RATIO || curS - bestS > SWITCH_CONF.ABS_GAP)) {
      this.controlled = best;
      this.switchLock = SWITCH_CONF.LOCK_TIME;
    }
  }

  // 守備時の切替優先度 (小さいほど優先)。
  // ボールへの距離・「ボール → 自ゴール」線への整列に加えて、
  // ピッチの前後方向 (attackDir 軸) でボールより敵陣側 (前) にいる選手を
  // その分だけ大きく減点する。左右にどれだけずれていても、ボールより
  // 前にいる選手は守備に間に合わないため、確実に選ばれにくくする。
  defensiveScore(p, ballPos) {
    const dir = this.userTeam.attackDir;
    const ownGoal = { x: -dir * PITCH.HALF_LEN, y: 0 };
    const dBall = dist(p.pos, ballPos);
    const lineDist = pointSegDist(p.pos, ballPos, ownGoal);
    // + ならボールより敵陣側 (前)。守備に回れないので大きな固定ペナルティ +
    // 距離に比例した追加ペナルティを科し、単純な距離の近さで選ばれないようにする
    const aheadOfBall = (p.pos.x - ballPos.x) * dir;
    const aheadPenalty = aheadOfBall > 0
      ? SWITCH_CONF.AHEAD_BASE_PENALTY + aheadOfBall * SWITCH_CONF.AHEAD_PENALTY
      : 0;
    return dBall + lineDist * 0.8 + aheadPenalty;
  }

  // ---------------- ユーザー操作 ----------------

  updateUserControl(p, input, dt) {
    const ball = this.ball;
    const hasBall = ball.owner === p;

    if (p.busy) {
      if (this.shootCharge >= 0) this.shootCharge = -1;
      if (this.crossCharge >= 0) this.crossCharge = -1;
      return;
    }

    const ax = input.axis();
    const charging = this.shootCharge >= 0 || this.crossCharge >= 0;

    let speed = (hasBall ? PLAYER_CONF.DRIBBLE_SPEED : PLAYER_CONF.RUN_SPEED) * p.effSpeedMult;
    if (charging) speed *= 0.4;   // シュートを溜めている間は減速

    if (ax) {
      p.moveTarget = { x: p.pos.x + ax.x * 10, y: p.pos.y + ax.y * 10 };
      p.moveSpeed = speed;
      p.facing = { x: ax.x, y: ax.y };
    } else {
      p.moveTarget = null;
    }

    if (hasBall && p.isGK) {
      // ---- 味方GKが保持: Z = 近くの味方へショートパス / X = ロングキック ----
      // (ゴールキックのリスタートもここで処理するため restartPassOnly より先に判定)
      if (input.wasPressed("KeyZ")) {
        const target = this.pickNearestTeammate(p, ax);
        if (target) {
          this.pass(p, target);
          this.controlled = target;
          this.switchLock = 0.4;
        } else {
          this.gkLongKick(p, ax);   // 近くに味方が居なければロングキックで逃がす
        }
      }
      if (input.wasPressed("KeyX")) {
        this.gkLongKick(p, ax);
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
      // 相手ゴールライン際のサイド (isCrossZone) では、Z の長押しで
      // 自動的にクロス (センタリング) が上がる。タップですぐ離せば通常のパス
      const inCrossZone = this.isCrossZone(p);
      if (input.wasPressed("KeyZ")) {
        if (inCrossZone) {
          this.crossCharge = 0;
        } else {
          const dir = ax || { x: p.facing.x, y: p.facing.y };
          const target = this.pickPassTarget(p, dir, false);
          if (target) {
            this.pass(p, target);
            this.controlled = target;       // パスと同時に受け手へ操作を移す
            this.switchLock = 0.4;
          }
          return;
        }
      }
      if (this.crossCharge >= 0) {
        this.crossCharge += dt;
        if (this.crossCharge >= CROSS_CONF.HOLD_TIME) {
          this.cross(p);
          this.crossCharge = -1;
        } else if (input.wasReleased("KeyZ")) {
          // 閾値に達する前に離したら、通常のタップパスとして扱う
          const dir = ax || { x: p.facing.x, y: p.facing.y };
          const target = this.pickPassTarget(p, dir, false);
          if (target) {
            this.pass(p, target);
            this.controlled = target;
            this.switchLock = 0.4;
          }
          this.crossCharge = -1;
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
    if (this.checkOffside(from, to)) { this.callOffside(from, to); return; }
    const d = dist(origin, to.pos);
    const speed = clamp(9 + d * 0.85,
      ACTION_CONF.PASS_SPEED_MIN, ACTION_CONF.PASS_SPEED_MAX) * powerMul;
    // 受け手の移動を先読みして少し前へ出す
    const t = d / speed;
    const lead = { x: to.pos.x + to.vel.x * t * 0.8, y: to.pos.y + to.vel.y * t * 0.8 };
    this.ball.kick(from, normTo(origin, lead), speed);
    from.thinkTimer = 0.3;
  }

  // GK のロングキック: 前方の味方 (居なければ入力方向) へ浮き球で強く蹴り出す。
  // ハーフライン付近まで敵味方とも触れられない (Ball.launchLofted)
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
    this.ball.launchLofted(gk, outDir, speed, gk.team.attackDir);
    gk.thinkTimer = 0.3;
  }

  // ---------------- クロス (センタリング) ----------------

  // 相手ゴールラインから CROSS_CONF.ZONE_DEPTH の範囲 (ペナルティエリアの
  // 奥行きよりだいぶ手前、味方陣寄りまで含む) かつペナルティエリアの幅
  // より外側 (サイド) にいるか
  isCrossZone(p) {
    const dir = p.team.attackDir;
    const goalX = PITCH.HALF_LEN * dir;
    const depth = Math.abs(goalX - p.pos.x);
    return depth <= CROSS_CONF.ZONE_DEPTH && Math.abs(p.pos.y) > PITCH.PENALTY_HALF_WIDTH;
  }

  // クロスを送る: 相手ボックス内で最もゴール中央に近い味方 (いなければ
  // ゴール前中央) を狙って浮き球を上げる。着弾までの間は既存のワンタッチ
  // 判定 (updateVolleyState/doVolley) がそのままヘディングシュートの
  // 受付窓として機能する
  cross(p) {
    const target = this.crossTarget(p);
    this.ball.launchCross(p, target, CROSS_CONF.SPEED);
    p.thinkTimer = 0.3;
  }

  crossTarget(p) {
    const oppBox = this.otherTeam(p.team);
    let best = null, bestScore = Infinity;
    for (const mate of p.team.outfield()) {
      if (mate === p || !this.inPenaltyBox(mate.pos, oppBox)) continue;
      const score = Math.abs(mate.pos.y);   // より中央寄りの選手を優先
      if (score < bestScore) { bestScore = score; best = mate; }
    }
    if (best) return { x: best.pos.x, y: best.pos.y };
    const goalX = PITCH.HALF_LEN * p.team.attackDir;
    return { x: goalX - p.team.attackDir * 9, y: 0 };   // 味方が居なければ6ヤード付近中央
  }

  // クロス役 (相手ゴールライン際のサイドへ上がる味方) を1人選ぶ。
  // DF とボール保持者は除外し、ボールに近いサイド (同じ y の符号) を優先する
  pickCrossRunner(team) {
    const owner = this.ball.owner;
    const ballSide = Math.sign(this.ball.pos.y) || 1;
    let best = null, bestScore = -Infinity;
    for (const p of team.outfield()) {
      if (p === owner || p.role === "DF") continue;
      const sameSide = Math.sign(p.pos.y) === ballSide ? 1 : 0;
      const score = sameSide * 30 - Math.abs(Math.abs(p.pos.y) - PITCH.HALF_WID * 0.6);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
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

  // ダイレクトシュートの実行: トラップせずボールの現在位置から直接ゴールへ。
  // ボールが浮き球 (クロス) なら「ヘディングシュート」として扱い、長押し
  // 強シュートと同じフルパワーで撃つ (通常のダイレクトボレーはやや抑えめ)
  doVolley(p, ax) {
    const aimY = ax ? ax.y * 2.6 : 0;   // 通常シュートと同じく上下でコース調整
    const power = this.ball.airborne ? 1 : VOLLEY_CONF.POWER;
    this.shootFrom(p, this.ball.pos, aimY, power);
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
    if (ball.airborne) return;   // 浮き球は着地するまで誰も触れない
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
      // 速すぎるボールは体に当たって勢いを失う。
      // 強いシュートが直撃した場合はフィールドプレーヤーも倒れる
      if (d < 0.7) {
        if (!p.isGK && speed > ACTION_CONF.GK_CATCH_MAX_SPEED) {
          p.stumble(ACTION_CONF.FIELD_SHOT_STUMBLE_TIME);
        }
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

  // ---------------- PK 戦 ----------------
  //  状態: pk.phase
  //    setup  - キッカー/GK配置直後の静止
  //    aim    - キッカーとキーパーがそれぞれコース (3x2ゾーン) を選ぶ
  //             (お互いの選択は見えない。ユーザーが関与する側だけ操作できる)
  //    anim   - 選んだコースが一致すればセーブ、外れればゴールの演出
  //    result - ゴール/失敗の演出中
  //  PK_CONF.ROUNDS 本ずつ終えても同点ならサドンデス (1本ずつ) に突入する

  // 後半終了が同点だったときに呼ばれる
  startPK() {
    this.pk = {
      order: Math.random() < 0.5 ? [this.userTeam, this.cpuTeam] : [this.cpuTeam, this.userTeam],
      kickIndex: 0,
      userScore: 0,
      cpuScore: 0,
      kicksTaken: { [this.userTeam.id]: 0, [this.cpuTeam.id]: 0 },
      sudden: false,
    };
    this.state = "pk";
    this.volley = null;   // 通常プレー終了時点の状態が残らないようにする
    this.showBanner("PK戦!", 1.6);
    this.startPKAttempt();
  }

  // 1本ごとのキッカー/GK配置。他の選手は邪魔にならないよう中央円付近に控えさせる
  startPKAttempt() {
    const pk = this.pk;
    const kicking = pk.order[pk.kickIndex % 2];
    const defending = this.otherTeam(kicking);
    const shooter = kicking.outfield()[pk.kicksTaken[kicking.id] % kicking.outfield().length];
    const gk = defending.gk;
    const goalX = PITCH.HALF_LEN * kicking.attackDir;
    const spot = { x: goalX - kicking.attackDir * PK_CONF.SPOT_DIST, y: 0 };

    for (const t of this.teams) {
      t.players.forEach((p, i) => {
        if (p === shooter || p === gk) return;
        p.pos = { x: t.isUser ? -3 : 3, y: (i - 4) * 3.4 };
        p.vel = { x: 0, y: 0 };
        p.state = "normal";
        p.stateTimer = 0;
        p.moveTarget = null;
      });
    }

    shooter.pos = { x: spot.x, y: spot.y };
    shooter.vel = { x: 0, y: 0 };
    shooter.facing = { x: kicking.attackDir, y: 0 };
    shooter.state = "normal";
    shooter.stateTimer = 0;
    gk.pos = { x: kicking.attackDir * (PITCH.HALF_LEN - 0.3), y: 0 };
    gk.vel = { x: 0, y: 0 };
    gk.state = "normal";
    gk.stateTimer = 0;
    gk.holdTimer = 0;

    this.ball.reset(spot);
    this.givePossession(shooter);
    this.controlled = kicking.isUser ? shooter : gk;   // CPU 側の番は GK にフォーカスするだけ
    this.shootCharge = -1;
    this.crossCharge = -1;

    pk.shooter = shooter;
    pk.gk = gk;
    pk.kickerIsUser = kicking.isUser;
    pk.keeperIsUser = !kicking.isUser;
    pk.phase = "setup";
    pk.timer = PK_CONF.SETUP_TIME;

    const roundLabel = pk.sudden ? "サドンデス" : "PK " + (Math.floor(pk.kickIndex / 2) + 1) + "本目";
    this.showBanner(kicking.name + " の " + roundLabel, 1.2);
  }

  updatePK(dt, input) {
    const pk = this.pk;

    if (pk.phase === "setup") {
      pk.timer -= dt;
      if (pk.timer <= 0) this.startPKAim();
      return;
    }

    if (pk.phase === "aim") {
      this.updatePKAim(dt, input);
      return;
    }

    if (pk.phase === "anim") {
      pk.timer -= dt;
      if (pk.timer <= 0) this.resolvePKAttempt(!pk.matched);
      return;
    }

    if (pk.phase === "result") {
      pk.timer -= dt;
      if (pk.timer <= 0) {
        if (this.pkDecided()) this.finishPK();
        else this.startPKAttempt();
      }
    }
  }

  // コース選択フェーズ開始: キッカー/キーパーとも初期カーソルは中央上、
  // CPU側は少し「考える」演出のあとランダムに決める (お互いの選択は見えない)
  startPKAim() {
    const pk = this.pk;
    pk.phase = "aim";
    pk.timer = PK_AIM_CONF.AIM_TIME;
    pk.kickerChoice = { col: 1, row: 0 };
    pk.keeperChoice = { col: 1, row: 0 };
    pk.kickerConfirmed = false;
    pk.keeperConfirmed = false;
    pk.cpuKickerDecideAt = rand(0.8, 2.0);
    pk.cpuKeeperDecideAt = rand(0.8, 2.0);
    pk.cursorCooldown = 0;   // タッチスティック等の連続入力をカーソル一段分に間引く
  }

  updatePKAim(dt, input) {
    const pk = this.pk;
    pk.timer -= dt;
    pk.cursorCooldown = Math.max(0, pk.cursorCooldown - dt);

    if (pk.kickerIsUser && !pk.kickerConfirmed) {
      this.updatePKCursor(pk.kickerChoice, input);
      if (input.wasPressed("KeyX")) pk.kickerConfirmed = true;
    } else if (!pk.kickerConfirmed) {
      pk.cpuKickerDecideAt -= dt;
      if (pk.cpuKickerDecideAt <= 0) {
        pk.kickerChoice = randomPKZone();
        pk.kickerConfirmed = true;
      }
    }

    if (pk.keeperIsUser && !pk.keeperConfirmed) {
      this.updatePKCursor(pk.keeperChoice, input);
      if (input.wasPressed("KeyX")) pk.keeperConfirmed = true;
    } else if (!pk.keeperConfirmed) {
      pk.cpuKeeperDecideAt -= dt;
      if (pk.cpuKeeperDecideAt <= 0) {
        pk.keeperChoice = randomPKZone();
        pk.keeperConfirmed = true;
      }
    }

    // 制限時間切れなら、今のカーソル位置のまま強制的に確定させる
    if (pk.timer <= 0) {
      pk.kickerConfirmed = true;
      pk.keeperConfirmed = true;
    }

    if (pk.kickerConfirmed && pk.keeperConfirmed) {
      pk.matched = pk.kickerChoice.col === pk.keeperChoice.col &&
        pk.kickerChoice.row === pk.keeperChoice.row;
      pk.phase = "anim";
      pk.timer = PK_AIM_CONF.ANIM_TIME;
    }
  }

  // コース選択カーソルの移動。矢印キーは押した瞬間に1段動かす。
  // タッチジョイスティックは連続値しか取れないため、倒した方向へ
  // cursorCooldown で間引きながら1段ずつ動かす (キーボードの長押しでも
  // 同じ間引きロジックを使い、リピート入力として扱う)
  updatePKCursor(choice, input) {
    const pk = this.pk;
    let moved = false;
    if (input.wasPressed("ArrowLeft")) { choice.col = Math.max(0, choice.col - 1); moved = true; }
    if (input.wasPressed("ArrowRight")) { choice.col = Math.min(PK_AIM_CONF.COLS - 1, choice.col + 1); moved = true; }
    if (input.wasPressed("ArrowUp")) { choice.row = 0; moved = true; }
    if (input.wasPressed("ArrowDown")) { choice.row = 1; moved = true; }
    if (moved) { pk.cursorCooldown = 0.25; return; }

    if (pk.cursorCooldown > 0) return;
    const ax = input.axis();
    if (!ax) return;
    if (Math.abs(ax.x) > 0.5) {
      choice.col = clamp(choice.col + (ax.x > 0 ? 1 : -1), 0, PK_AIM_CONF.COLS - 1);
      pk.cursorCooldown = 0.25;
    } else if (Math.abs(ax.y) > 0.5) {
      choice.row = ax.y > 0 ? 1 : 0;
      pk.cursorCooldown = 0.25;
    }
  }

  resolvePKAttempt(scored) {
    const pk = this.pk;
    const kicking = pk.order[pk.kickIndex % 2];
    if (scored) {
      if (kicking === this.userTeam) pk.userScore++;
      else pk.cpuScore++;
    }
    pk.kicksTaken[kicking.id]++;
    pk.kickIndex++;
    this.showBanner(scored ? "ゴール!" : "はずれ…", 1.2);
    this.shootCharge = -1;
    pk.phase = "result";
    pk.timer = PK_CONF.RESULT_TIME;
  }

  // 決着がついたか判定する。通常本数消化前でも残り本数で逆転不可能なら
  // 打ち切り、通常本数を終えて同点ならサドンデスに切り替える (副作用あり)
  pkDecided() {
    const pk = this.pk;
    if (!pk.sudden) {
      const takenUser = pk.kicksTaken[this.userTeam.id];
      const takenCpu = pk.kicksTaken[this.cpuTeam.id];
      const remainingUser = Math.max(0, PK_CONF.ROUNDS - takenUser);
      const remainingCpu = Math.max(0, PK_CONF.ROUNDS - takenCpu);
      if (pk.userScore > pk.cpuScore + remainingCpu) return true;
      if (pk.cpuScore > pk.userScore + remainingUser) return true;
      if (takenUser < PK_CONF.ROUNDS || takenCpu < PK_CONF.ROUNDS) return false;
      if (pk.userScore === pk.cpuScore) { pk.sudden = true; return false; }
      return true;
    }
    // サドンデス: 両者が同じ本数を消化した直後、差がついていれば終了
    const extraUser = pk.kicksTaken[this.userTeam.id] - PK_CONF.ROUNDS;
    const extraCpu = pk.kicksTaken[this.cpuTeam.id] - PK_CONF.ROUNDS;
    if (extraUser === extraCpu && extraUser > 0) {
      return pk.userScore !== pk.cpuScore;
    }
    return false;
  }

  finishPK() {
    const pk = this.pk;
    const userWon = pk.userScore > pk.cpuScore;
    this.showBanner((userWon ? this.userTeam.name : this.cpuTeam.name) + " PK勝利!", 2.2);
    this.state = "pk_done";
    this.freezeTimer = 2.2;
  }
}
