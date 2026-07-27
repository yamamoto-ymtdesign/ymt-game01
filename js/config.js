"use strict";

// =====================================================================
// ゲーム全体の定数・設定
//
// 座標系: ピッチ中央が原点 (0, 0)。単位はメートル。
//   x: -69.6 (左ゴール) 〜 +69.6 (右ゴール)
//   y: -45.6 (画面上)   〜 +45.6 (画面下)
// 各チームは attackDir (+1 = 右へ攻める / -1 = 左へ攻める) を持ち、
// ハーフタイムで反転する。
// =====================================================================

// ---- ピッチ寸法 (9人制用に標準より少し広め) ----
// 縦横とも従来 (116 x 76) の 1.2 倍。選手間が空くぶんスルーパスや
// サイドチェンジで使えるスペースが生まれる。ゴール・ペナルティエリア・
// センターサークルは実寸のまま据え置き (相対的に小さくなる)
const PITCH = {
  LENGTH: 139.2,
  WIDTH: 91.2,
  HALF_LEN: 69.6,
  HALF_WID: 45.6,
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
  // ボール保持時は少し遅くなる。個体差の上限 (絶好調の1.1倍) をかけても、
  // DF の基準速度 (RUN_SPEED) よりわずかに遅くなるよう設定している
  // (ドリブルだけで独走突破できないようにするため)
  DRIBBLE_SPEED: 5.7,
  GK_SPEED: 6.6,
  ACCEL: 26,                  // 加速度 (m/s^2)
  // 通常選手は個体差なし (全員 1.0倍)。差がつくのは絶好調選手のみ
  SPEED_VARIANCE_MIN: 1.0,
  SPEED_VARIANCE_MAX: 1.0,
  // その日の「調子」: チームごとにランダムで最大 GOOD_FORM_COUNT 人だけ
  // 好調になり、通常より速い個体差レンジが割り当てられる
  GOOD_FORM_COUNT: 3,
  GOOD_FORM_SPEED_MIN: 1.1,
  GOOD_FORM_SPEED_MAX: 1.1,
  // サイドバックが自陣センターバックより後ろに下がりすぎない (最低限前に出る) 距離
  SIDEBACK_LEAD_MIN: 4,
};

// ---- スタミナ (疲労) ----
// 動き続けると徐々に減り、動きを緩めれば回復する。
// スタミナが尽きると速度が落ちる。ハーフタイムでも少しだけ回復する (完全回復はしない)
const STAMINA_CONF = {
  MAX: 100,
  MOVE_DRAIN: 0.7,     // 通常移動 (ジョグ) 中のわずかな消費量
  RECOVER_RATE: 9.0,   // ほぼ静止しているときの毎秒回復量
  MIN_MULT: 0.82,      // スタミナ0のときの速度倍率 (最大で18%低下)
  HALFTIME_RECOVER: 45,
};

// ---- ファウル (軽量版: スライディングタックルのみ対象) ----
// スライディングで相手に接触したとき、相手の背後から入った (相手の向き
// と滑走方向がほぼ一致 = 追い越しざまに刈った) 場合は高確率、それ以外は
// 低確率でファウルを取る。累積2回目以降は「警告」として表示する
// (退場は実装しない: プレー人数が変わる大掛かりな変更を避けるため)
const FOUL_CONF = {
  BASE_PROB: 0.15,
  BEHIND_PROB: 0.55,
};

// フリーキック・キックインなどのリスタート時、相手チームの選手が
// 出し手にこれ以上近づけない距離 (実際のルールの9.15ヤードを簡略化)
const RESTART_KEEP_DIST = 8;

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

// ---- クロス (センタリング) ----
// 相手ゴールラインから ZONE_DEPTH の範囲 (ペナルティエリアの奥行きより
// 少し手前まで含む) かつペナルティエリアの幅より外側 (サイド) で
// ボールを持っているときだけ、パスボタン (Z) を HOLD_TIME 秒以上長押し
// すると自動でクロスが上がる。
// 味方がヘディングシュートするタイミング判定は既存のワンタッチ
// (ダイレクトシュート) の仕組みをそのまま流用する
const CROSS_CONF = {
  ZONE_DEPTH: 30,   // 相手ゴールラインからこの距離以内ならクロス発動可能
  HOLD_TIME: 0.35,
  SPEED: 19,
};

// ---- スルーパス (スペースへのパス) ----
// クロスゾーン外で Z を HOLD_TIME 秒以上長押しすると、味方の足元ではなく
// 「その選手の前のスペース」へ走らせるパスになる。パスを出した瞬間の
// 受け手の位置でオフサイドを判定するため、ラインの裏を取る駆け引きになる
const THROUGH_CONF = {
  HOLD_TIME: 0.3,
  LEAD: 9,           // 受け手の前方 (攻撃方向) どれだけ先に落とすか(m)
  // 落とす地点までの距離から初速を決める (摩擦で減速し、走り込む味方が
  // ちょうど追いつける程度の速さになるよう調整してある)
  SPEED_K: 0.95,
  SPEED_MIN: 12,
  SPEED_MAX: 22,
};

// ---- モメンタム (ノリ) ゲージ / ゾーン ----
// 良いプレーを重ねるほどチームのゲージが溜まり、満タンになると自動的に
// 「ゾーン」に突入する。ゾーン中はチーム全員が加速し、スプリントしても
// スタミナが減らず、シュート精度も上がる。ボールを失ったり失点すると減る
// 数値は実際に試合をシミュレートして調整しており、10分ハーフの試合で
// 両チーム合わせて 1〜3 回ゾーンが発動する程度のペースになっている
const MOMENTUM_CONF = {
  MAX: 80,
  // 自然減少は「ボールを保持していない間」だけ効く。保持して繋いでいる
  // 限りは減らないので、良い攻撃を続けたチームがゾーンに到達できる
  DECAY: 0.5,
  ZONE_TIME: 15,        // ゾーンの持続時間(秒)
  ZONE_SPEED: 1.12,     // ゾーン中の速度倍率
  ZONE_SHOOT_ERR: 0.55, // ゾーン中のシュート誤差の倍率 (小さいほど正確)
  // 加点/減点イベント
  GAIN: {
    pass: 4,            // パス成功 (受け手がトラップ)
    oneTouch: 9,        // ワンタッチパス (ワンツー)
    through: 10,        // スルーパス成功
    cross: 10,          // クロスが味方に通った
    tackle: 8,          // タックル・スライディングでボール奪取
    shotOnTarget: 13,   // 枠内シュート
    goal: 33,
  },
  LOSS: {
    turnover: 4,        // 相手にボールを奪われた
    conceded: 25,       // 失点
  },
};

// ---- 演出 (画面効果) ----
const FX_CONF = {
  SHAKE_GOAL: 14,       // ゴール時の画面シェイク強度(px)
  SHAKE_POST: 9,        // バー/ポスト直撃時
  SHAKE_TACKLE: 4,      // 激しいタックル時
  SHAKE_DECAY: 5.5,     // シェイクの減衰速度(毎秒)
  HITSTOP_GOAL: 0.12,   // ゴール時に画面を止める時間(秒)
  HITSTOP_SHOT: 0.05,   // 強シュート/セーブ時
  // カメラズーム: ボールが相手ゴールに近いほど寄る。
  // ピッチを 1.2 倍にしたぶんだけ引き (12 → 10.5 px/m)、画面に映る
  // ピッチの割合が従来とほぼ同じになるようにしている。スルーパスを
  // 出す先のスペースが画面内に収まらないと狙いようがないため
  ZOOM_BASE: 10.5,      // 通常時の1mあたりピクセル数
  ZOOM_MAX: 13.5,       // ゴール前まで攻め込んだときの最大ズーム
  ZOOM_NEAR: 31,        // ゴールからこの距離以内で最大ズームになる
  ZOOM_FAR: 66,         // ゴールからこの距離以上で通常ズーム
  ZOOM_LERP: 1.6,       // ズームの追従速度
  // 終盤のスローモー: 残りこの秒数以内で枠内シュートが飛ぶとスローになる
  SLOWMO_LAST_SEC: 30,
  SLOWMO_SCALE: 0.35,   // スローモー中の時間倍率
  SLOWMO_TIME: 0.9,     // スローモーの持続時間(実時間・秒)
};

// ---- アディショナルタイム (ロスタイム) ----
// 前後半それぞれの終わりに、ランダムな長さの追加時間が加わる
const STOPPAGE_CONF = {
  MIN: 5,    // 最短(秒)
  MAX: 15,   // 最長(秒)
};

// ---- PK 戦 ----
const PK_CONF = {
  ROUNDS: 3,            // 通常本数 (これでも決着つかなければサドンデスへ)
  SPOT_DIST: 11,        // ペナルティスポットのゴールラインからの距離(m) (演出用)
  SETUP_TIME: 1.0,      // 配置直後の静止時間
  RESULT_TIME: 1.3,     // ゴール/失敗の演出時間
};

// ---- PK 戦: コース選択 (キッカー1人称視点) ----
// ゴールを左/中央/右 × 上/下 の 3x2 = 6 ゾーンに分け、キッカーとキーパーが
// それぞれ (お互いに見えない状態で) ゾーンを選ぶ。一致すればセーブ、
// 外れればゴール。CPU 側は完全ランダムに選ぶため、単純な確率では 1/6 で
// 一致する (=キッカー視点では 5/6 で得点、キーパー視点では 1/6 でセーブ)
const PK_AIM_CONF = {
  COLS: 3,              // 左/中央/右
  ROWS: 2,              // 上/下
  AIM_TIME: 3.0,        // コースを選べる制限時間 (秒)。過ぎると今のカーソル位置で確定
  ANIM_TIME: 1.3,       // シュート/セーブ演出の時間
};

// ---- 守備時の操作キャラ自動切替 (チャタリング防止のヒステリシス) ----
const SWITCH_CONF = {
  LOCK_TIME: 0.9,        // 切替後、この時間は自動では再切替しない
  MANUAL_LOCK_TIME: 1.5, // Space での手動切替後はより長くロックする
  RATIO: 0.68,           // 候補が「現在の操作キャラの距離 × この係数」より近ければ切替
  ABS_GAP: 7,            // または距離差がこの値(m)以上開いたら切替
  // 守備時は「自陣側 (ボールより自ゴール寄り) にいる選手のうち、ボールに
  // 最も近い者」を選ぶ。ボールとほぼ並んだ位置は自陣側として扱う猶予
  GOALSIDE_TOLERANCE: 2,
  // 自陣側の候補が必ず優先されるよう、ボールより前に出ている選手には
  // ピッチ全長より大きい固定ペナルティを科す (前に出ている距離に応じた
  // 追加ペナルティで、前掛かりな選手ほど後回しになる)
  AHEAD_BASE_PENALTY: 200,
  AHEAD_PENALTY: 3.2,
  // 自動切替は、ユーザーが矢印キー/アクションキーを操作していない状態が
  // この数フレーム続いたときだけ行う (操作中に横取りされるのを防止)
  IDLE_FRAMES: 8,
  // ただし現在の操作キャラの守備優先度スコアがこの値を超えて悪い
  // (ボールから離れすぎている等) 場合は、無入力を待たず即座に切替える
  FAR_OVERRIDE_GAP: 22,
  // 守備中、操作キャラがボールよりこれだけ敵陣側に置き去りにされたら
  // 「抜かれた」とみなし、無入力を待たずに後ろの味方へ切替える
  BEATEN_GAP: 4,
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

// ---- トーナメントモード (ベスト16からの4回戦、単発試合とは別モード) ----
// ユーザー (BLUES) が実際に対戦する相手だけを、ラウンドが進むごとに
// このプールからランダムに (重複なく) 選ぶ。他の山の結果はシミュレート
// しない (見えない試合を計算する必要がないため、軽量に保てる)
const TOURNAMENT_TEAMS = [
  { name: "REDS",     colors: { main: "#e04a3a", dark: "#8f231a", gk: "#c9a227" } },
  { name: "TIGERS",   colors: { main: "#f2871f", dark: "#a85a12", gk: "#2fb96e" } },
  { name: "OWLS",     colors: { main: "#7b3fb5", dark: "#4a2570", gk: "#e0c93a" } },
  { name: "HAWKS",    colors: { main: "#383838", dark: "#1a1a1a", gk: "#e0c93a" } },
  { name: "WAVES",    colors: { main: "#17a2b8", dark: "#0f6b78", gk: "#e0c93a" } },
  { name: "FOXES",    colors: { main: "#d6336c", dark: "#8a1f46", gk: "#2fb96e" } },
  { name: "WOLVES",   colors: { main: "#5b6270", dark: "#2f333a", gk: "#e0c93a" } },
  { name: "BULLS",    colors: { main: "#8b4513", dark: "#5a2d0c", gk: "#2fb96e" } },
  { name: "EAGLES",   colors: { main: "#6b8e23", dark: "#425a15", gk: "#e0c93a" } },
  { name: "COBRAS",   colors: { main: "#4b3fae", dark: "#2b2468", gk: "#e0c93a" } },
  { name: "PANTHERS", colors: { main: "#212529", dark: "#000000", gk: "#e0c93a" } },
  { name: "FALCONS",  colors: { main: "#0e8a6c", dark: "#095c48", gk: "#f2871f" } },
  { name: "LIONS",    colors: { main: "#eab308", dark: "#92700a", gk: "#2fb96e" } },
  { name: "RAPTORS",  colors: { main: "#7c2d12", dark: "#431705", gk: "#e0c93a" } },
  { name: "SHARKS",   colors: { main: "#d97706", dark: "#8a4c04", gk: "#2fb96e" } },
];

const TOURNAMENT_ROUND_NAMES = ["ベスト16", "準々決勝", "準決勝", "決勝"];
// ラウンドが進むごとに敵AIを少しずつ強くする (難易度セレクトの値を基準に掛け算)
const TOURNAMENT_ROUND_SCALE = [1, 1.05, 1.1, 1.18];

// ---- ユーザーが変更できる設定 (localStorage に保存) ----
const Settings = {
  data: {
    halfLengthMin: 5,       // 前後半それぞれの長さ(分)
    difficulty: "normal",
    // 通算成績 (連勝記録込み)。PK戦で決着した場合も勝敗としてカウントする
    record: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, tournamentTitles: 0 },
  },
  load() {
    try {
      const raw = localStorage.getItem("ymt-soccer-settings");
      if (raw) {
        const saved = JSON.parse(raw);
        // record はネストしたオブジェクトなので、新しく追加したフィールド
        // (例: tournamentTitles) が古い保存データで欠けていても
        // デフォルト値で補えるよう浅いマージではなく個別に上書きする
        const record = Object.assign({}, this.data.record, saved.record);
        Object.assign(this.data, saved);
        this.data.record = record;
      }
    } catch (e) { /* 保存データが壊れていても初期値で続行 */ }
  },
  save() {
    try {
      localStorage.setItem("ymt-soccer-settings", JSON.stringify(this.data));
    } catch (e) { /* localStorage が使えない環境では保存しない */ }
  },
};
