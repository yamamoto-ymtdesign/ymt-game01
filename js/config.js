"use strict";

// =====================================================================
// ゲーム全体の定数・設定
//
// 座標系: ピッチ中央が原点 (0, 0)。単位はメートル。
//   x: -52.5 (左ゴール) 〜 +52.5 (右ゴール)
//   y: -34   (画面上)   〜 +34   (画面下)
// 各チームは attackDir (+1 = 右へ攻める / -1 = 左へ攻める) を持ち、
// ハーフタイムで反転する。
// =====================================================================

// ---- ピッチ寸法 ----
const PITCH = {
  LENGTH: 105,
  WIDTH: 68,
  HALF_LEN: 52.5,
  HALF_WID: 34,
  GOAL_HALF: 3.66,            // ゴール幅の半分
  GOAL_DEPTH: 2.2,            // ゴールネットの奥行き(描画用)
  PENALTY_DEPTH: 16.5,
  PENALTY_HALF_WIDTH: 20.16,
  GOAL_AREA_DEPTH: 5.5,
  GOAL_AREA_HALF_WIDTH: 9.16,
  CENTER_CIRCLE_R: 9.15,
  MARGIN: 0.6,                // 選手がライン外に出られる余白(クランプ用)
};

// ---- ボール ----
const BALL_CONF = {
  RADIUS: 0.35,
  FRICTION: 0.55,             // 速度の指数減衰係数 (毎秒)
  CONTROL_RADIUS: 1.0,        // この距離以内ならトラップできる
  CONTROL_MAX_SPEED: 14,      // これより速いボールはトラップ不可
  DRIBBLE_OFFSET: 0.85,       // ドリブル時にボールを置く前方距離
};

// ---- 選手の運動性能 ----
const PLAYER_CONF = {
  RADIUS: 0.55,
  RUN_SPEED: 7.0,
  DASH_SPEED: 9.0,
  DRIBBLE_SPEED: 6.2,         // ボール保持時は少し遅くなる
  DASH_DRIBBLE_SPEED: 7.8,
  GK_SPEED: 6.6,
  ACCEL: 26,                  // 加速度 (m/s^2)
};

// ---- アクション(パス・シュート・守備動作) ----
const ACTION_CONF = {
  PASS_SPEED_MIN: 11,
  PASS_SPEED_MAX: 24,
  SHOOT_SPEED_MIN: 17,
  SHOOT_SPEED_MAX: 33,
  SHOOT_CHARGE_TIME: 0.8,     // シュートの最大溜め時間(秒)

  // GKのシュート対応:
  //  ボール速度 <= GK_CATCH_MAX_SPEED ならキャッチ。
  //  それを超える強シュートは弾く(パリー)だけで、GK_PARRY_TIME の間
  //  倒れ込んで動けなくなる。さらに至近距離からの強シュートは
  //  GKが反応しきれず正面でも抜けることがある。
  GK_CATCH_MAX_SPEED: 26,
  GK_PARRY_TIME: 1.0,         // パリー後に動けない時間
  GK_PARRY_REBOUND: 0.32,     // 弾いたボールに残る速度の割合

  TACKLE_RANGE: 1.7,          // 「脚を出す(カット)」の届く距離
  TACKLE_TIME: 0.3,
  TACKLE_COOLDOWN: 0.5,

  SLIDE_SPEED: 9.5,           // スライディングの初速
  SLIDE_TIME: 0.55,
  SLIDE_RANGE: 1.3,           // スライディング中にボールへ届く距離
  GETUP_TIME: 0.75,           // スライディング後の起き上がり時間

  CHARGE_RANGE: 1.5,          // 「体をぶつける」の届く距離
  CHARGE_TIME: 0.25,
  CHARGE_COOLDOWN: 0.8,

  STUMBLE_TIME: 0.8,          // 転倒・よろけの持続時間
  KICK_SHIELD_TIME: 0.35,     // 蹴った直後に自分で再トラップできない時間
};

// ---- 守備時の操作キャラ自動切替 (チャタリング防止のヒステリシス) ----
const SWITCH_CONF = {
  LOCK_TIME: 0.9,        // 切替後、この時間は自動では再切替しない
  MANUAL_LOCK_TIME: 1.5, // Space での手動切替後はより長くロックする
  RATIO: 0.68,           // 候補が「現在の操作キャラの距離 × この係数」より近ければ切替
  ABS_GAP: 7,            // または距離差がこの値(m)以上開いたら切替
};

// ---- 7人制フォーメーション 2-3-1 ----
// x: -1 が自ゴール側, +1 が敵ゴール側 / y: -1 が画面上, +1 が画面下
const FORMATION_7 = [
  { role: "GK", x: -0.96, y: 0 },
  { role: "DF", x: -0.58, y: -0.42 },
  { role: "DF", x: -0.58, y: 0.42 },
  { role: "MF", x: -0.18, y: -0.62 },
  { role: "MF", x: -0.24, y: 0 },
  { role: "MF", x: -0.18, y: 0.62 },
  { role: "FW", x: 0.3, y: 0 },
];

// ---- 難易度 (敵チームAIにのみ適用) ----
const DIFFICULTY = {
  easy:   { aiSpeed: 0.85, aiTackleProb: 0.6, aiThink: 0.6,  shootErr: 1.6 },
  normal: { aiSpeed: 0.95, aiTackleProb: 1.0, aiThink: 0.4,  shootErr: 1.0 },
  hard:   { aiSpeed: 1.03, aiTackleProb: 1.4, aiThink: 0.28, shootErr: 0.6 },
};

// ---- ユーザーが変更できる設定 (localStorage に保存) ----
const Settings = {
  data: {
    halfLengthMin: 5,       // 前後半それぞれの長さ(分)
    difficulty: "normal",
  },
  load() {
    try {
      const raw = localStorage.getItem("ymt-soccer-settings");
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* 保存データが壊れていても初期値で続行 */ }
  },
  save() {
    try {
      localStorage.setItem("ymt-soccer-settings", JSON.stringify(this.data));
    } catch (e) { /* localStorage が使えない環境では保存しない */ }
  },
};
