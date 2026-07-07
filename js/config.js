"use strict";

// =====================================================================
// ゲーム全体の定数・設定
//
// 座標系: ピッチ中央が原点 (0, 0)。単位はメートル。
//   x: -58 (左ゴール) 〜 +58 (右ゴール)
//   y: -38 (画面上)   〜 +38 (画面下)
// 各チームは attackDir (+1 = 右へ攻める / -1 = 左へ攻める) を持ち、
// ハーフタイムで反転する。
// =====================================================================

// ---- ピッチ寸法 (9人制用に標準より少し広め) ----
const PITCH = {
  LENGTH: 116,
  WIDTH: 76,
  HALF_LEN: 58,
  HALF_WID: 38,
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

  // 浮き球 (GK のロングキックなど): 飛んでいる間は誰も (敵味方とも) 触れない
  LOFT_FRICTION: 0.12,        // 浮いている間の減速 (地上より弱い)
  LOFT_MAX_TIME: 2.0,         // 浮いていられる最大時間 (フォールバック)
  LOFT_LANDING_MARGIN: 4,     // ハーフライン(0)からこの距離まで自陣側でも「到達」とみなす
  LOFT_PEAK_HEIGHT: 3.5,      // 描画用の見かけの浮き上がり高さ (仮想単位)
};

// ---- 選手の運動性能 ----
const PLAYER_CONF = {
  RADIUS: 0.55,
  RUN_SPEED: 7.0,
  // ボール保持時は少し遅くなる。個体差の上限 (1.2倍) をかけても、
  // DF の基準速度 (RUN_SPEED) よりわずかに遅くなるよう設定している
  // (ドリブルだけで独走突破できないようにするため)
  DRIBBLE_SPEED: 5.7,
  CHASE_BOOST: 1.12,          // 守備チェイサーの追走速度倍率 (保持者に追いつける)
  GK_SPEED: 6.6,
  ACCEL: 26,                  // 加速度 (m/s^2)
  // 選手ごとの速度個体差 (同じチーム内でもランダムに速い/遅いがある)
  SPEED_VARIANCE_MIN: 0.8,
  SPEED_VARIANCE_MAX: 1.2,
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

  // 味方GKが保持中に Z を押したときのロングキック
  GK_LONG_KICK_SPEED: 27,
  GK_LONG_KICK_RANGE: 120,    // ピッチ全体を見渡して味方を探す

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

  STUMBLE_TIME: 1.2,          // スライディングで倒された選手の起き上がりまでの時間
  CHARGE_STUMBLE_TIME: 0.55,  // 「体をぶつける」で倒れた選手の起き上がりまでの時間
  KICK_SHIELD_TIME: 0.35,     // 蹴った直後に自分で再トラップできない時間

  // 強いシュート (GK_CATCH_MAX_SPEED を超える速さ) が直撃したフィールド
  // プレーヤーも倒れるようにする
  FIELD_SHOT_STUMBLE_TIME: 0.7,
};

// ---- ワンタッチアクション (ダイレクトシュート / ワンタッチパス) ----
// 味方からのパスが届く直前だけ受け手が光り、その間に
//   X : トラップせずダイレクトシュート (ゴールから ZONE 以内の受け手のみ)
//   Z : トラップせずワンタッチパス (ワンツーなど。ゾーン制限なし)
// を出せる。窓は 0.2 秒 (人間の反射速度に対してシビア)。
// 窓の外でキーを押すと、そのパスではそのアクションができなくなる (連打対策)。
// X と Z の成否は独立して判定される。
const VOLLEY_CONF = {
  WINDOW: 0.2,        // 光っている時間 = 入力を受け付ける時間 (秒)
  ZONE: 22,           // ダイレクトシュート(X)が有効な、相手ゴールからの距離(m)
  MIN_BALL_SPEED: 8,  // これより遅いボールは対象外
  POWER: 0.95,        // ダイレクトシュートの威力 (0〜1)
};

// ---- 守備時の操作キャラ自動切替 (チャタリング防止のヒステリシス) ----
const SWITCH_CONF = {
  LOCK_TIME: 0.9,        // 切替後、この時間は自動では再切替しない
  MANUAL_LOCK_TIME: 1.5, // Space での手動切替後はより長くロックする
  RATIO: 0.68,           // 候補が「現在の操作キャラの距離 × この係数」より近ければ切替
  ABS_GAP: 7,            // または距離差がこの値(m)以上開いたら切替
  // ボールより敵陣側 (前) に 1m 出ているごとに科す守備優先度のペナルティ。
  // 左右にどれだけずれていても、ボールより前の選手が選ばれにくくなる
  AHEAD_PENALTY: 3.2,
  // 自動切替は、ユーザーが矢印キー/アクションキーを操作していない状態が
  // この数フレーム続いたときだけ行う (操作中に横取りされるのを防止)
  IDLE_FRAMES: 8,
  // ただし現在の操作キャラの守備優先度スコアがこの値を超えて悪い
  // (ボールから離れすぎている等) 場合は、無入力を待たず即座に切替える
  FAR_OVERRIDE_GAP: 22,
};

// ---- 9人制フォーメーション 3-3-2 ----
// x: -1 が自ゴール側, +1 が敵ゴール側 / y: -1 が画面上, +1 が画面下
const FORMATION_9 = [
  { role: "GK", x: -0.96, y: 0 },
  { role: "DF", x: -0.58, y: -0.55 },
  { role: "DF", x: -0.62, y: 0 },
  { role: "DF", x: -0.58, y: 0.55 },
  { role: "MF", x: -0.18, y: -0.62 },
  { role: "MF", x: -0.24, y: 0 },
  { role: "MF", x: -0.18, y: 0.62 },
  { role: "FW", x: 0.3, y: -0.25 },
  { role: "FW", x: 0.3, y: 0.25 },
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
