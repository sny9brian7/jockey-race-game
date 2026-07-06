/* ジョッキー視点レースゲーム本体 */
(function () {
"use strict";

if (typeof THREE === "undefined") {
  document.getElementById("err").style.display = "flex";
  return;
}

// ==== コース定数（レース選択時に buildCourse が設定） ====
// 各競馬場を「直線2本+半円2つ」のオーバルで再現。dir: 1=左回り, -1=右回り
const COURSES = {
  tokyo:    { name: "東京",     len: 2080, straight: 540, goal: 525, dir:  1 }, // 実際: 一周2083.1m/直線525.9m/左回り
  kyotoOut: { name: "京都(外)", len: 1894, straight: 420, goal: 404, dir: -1 }, // 実際: 一周1894.3m/直線403.7m/右回り
  nakayama: { name: "中山(内)", len: 1667, straight: 325, goal: 310, dir: -1 }  // 実際: 一周1667.1m/直線310m/右回り
};
let TRACK_LEN = 2080, STRAIGHT = 540, HALF = 270, R = 159.15;
let T1 = 0, T2 = 0, T3 = 0, GOAL_MOD = 525, DIR = 1, REM_CORNER = 1025;
const N = 12;
let START_S = 0, FINISH_S = 0, RACE = null;

// ==== バランス調整用定数 ====
const PLAYER = {
  easeV: 14.2,      // ↓抑え時の目標速度 (m/s)。drainBaseより低い=本当に回復する
  cruiseV: 16.3,    // ニュートラル
  pushV: 18.4,      // ↑追い時（残スタミナが多いとさらに伸びる）
  // ムチ: スタミナを消費して一時加速（回数制限なし）。序盤に使うと掛かる
  whipBoost: 1.2, whipTime: 1.5, whipCd: 1.2, whipCost: 2, whipCap: 20.4,
  drainBase: 14.5,
  accel: 1.15, startAccel: 5.5,
  minLane: 0.6, maxLane: 12, laneSpeed: 2.5
};
// 脚質: early=序盤の上乗せ(隊列形成), spurt=残り何mでスパート
// 道中は後方脚質ほど巡航が僅かに速く、開いた差がじわじわ縮んで3〜4角で凝縮する。
// スパートは末脚(maxV)+残スタミナ変換で決着 → 直線で順位が入れ替わる
// 基礎maxVの差は小さく、残スタミナ変換(stamKick, 最大+1.8)が末脚の主役。
// 脚を溜めた馬はバテた先行勢より3〜4m/s速い状態で直線に飛んでくる
const STYLES = {
  "大逃げ": { early:  1.1, cruise: 16.15, maxV: 17.95, spurt: 700 },
  "逃げ":   { early:  0.55, cruise: 16.2, maxV: 18.05, spurt: 650 },
  "先行":   { early:  0.3, cruise: 16.27, maxV: 18.15, spurt: 640 },
  "差し":   { early: -0.2, cruise: 16.42, maxV: 18.35, spurt: 660 },
  "追込":   { early: -0.35, cruise: 16.5, maxV: 18.45, spurt: 650 }
};

// spdAdj: 距離に応じた全体ペース補正, drainK: 消耗率(距離が長いほど低い)
// adj: 馬ごとの能力補正（cruise/maxV に加算）
const RACES = [
  {
    title: "1997 天皇賞（春）", course: COURSES.kyotoOut, dist: 3200,
    spdAdj: -0.1, drainK: 0.22, pace: [61, 63], vision: "天皇賞(春) 芝3200m",
    player: { name: "マヤノトップガン", odds: 3.7, coat: 0x9a5a2b, mane: 0x6e3c17, silk: 0x2da84f },
    rivals: [
      { name: "サクラローレル",     style: "差し", adj: 0.22, odds: 1.5, coat: 0x9a5a2b, silk: 0xd23a2e },
      { name: "マーベラスサンデー", style: "差し", adj: 0.15, odds: 4.9, coat: 0x6b4423, silk: 0x2b6fdd },
      { name: "ステージチャンプ",   style: "差し", adj: 0.05, odds: 18, coat: 0x5a3a22, silk: 0xe8c522 },
      { name: "ローゼンカバリー",   style: "先行", adj: 0.05, odds: 12, coat: 0x3a2c20, silk: 0x8a3fd1 },
      { name: "ビッグシンボル",     style: "先行", adj: 0.0,  odds: 45, coat: 0x7a5230, silk: 0xe07a20 },
      { name: "ノーザンポラリス",   style: "逃げ", adj: 0.0,  odds: 62, coat: 0x5f4632, silk: 0x22b8c8 },
      { name: "ユウセンショウ",     style: "差し", adj: 0.0,  odds: 26, coat: 0x6b4423, silk: 0xe062a8 },
      { name: "メジロランバダ",     style: "差し", adj: -0.05, odds: 84, coat: 0x5a3a22, silk: 0xf0f0f0 },
      { name: "エイシンホンコン",   style: "先行", adj: -0.05, odds: 55, coat: 0x6b4423, silk: 0x7fd4ff },
      { name: "ハギノリアルキング", style: "差し", adj: -0.08, odds: 39, coat: 0x3a2c20, silk: 0x9acd32 },
      { name: "ポレール",           style: "先行", adj: -0.1, odds: 93, coat: 0x7a5230, silk: 0xb08968 }
    ]
  },
  {
    title: "1999 有馬記念", course: COURSES.nakayama, dist: 2500,
    spdAdj: 0.0, drainK: 0.29, pace: [60.5, 62.5], vision: "有馬記念 芝2500m",
    player: { name: "グラスワンダー", odds: 2.8, coat: 0x96552a, mane: 0x5f3212, silk: 0xd23a2e },
    rivals: [
      { name: "スペシャルウィーク", style: "差し", adj: 0.22, odds: 3.0, coat: 0x33281e, silk: 0x2b6fdd },
      { name: "テイエムオペラオー", style: "先行", adj: 0.12, odds: 5.4, coat: 0x9a5a2b, silk: 0x2da84f },
      { name: "ツルマルツヨシ",     style: "先行", adj: 0.08, odds: 9.8, coat: 0x5a3a22, silk: 0xe8c522 },
      { name: "メジロブライト",     style: "追込", adj: 0.05, odds: 15, coat: 0x6b4423, silk: 0x8a3fd1 },
      { name: "ナリタトップロード", style: "先行", adj: 0.05, odds: 12, coat: 0x5a3a22, silk: 0xe07a20 },
      { name: "ステイゴールド",     style: "差し", adj: 0.02, odds: 21, coat: 0x3a2c20, silk: 0x22b8c8 },
      { name: "ゴーイングスズカ",   style: "逃げ", adj: 0.0,  odds: 52, coat: 0x7a5230, silk: 0xe062a8 },
      { name: "ファレノプシス",     style: "差し", adj: -0.02, odds: 24, coat: 0x4a2c17, silk: 0xf0f0f0 },
      { name: "フサイチエアデール", style: "先行", adj: -0.05, odds: 37, coat: 0x6b4423, silk: 0x7fd4ff },
      { name: "スエヒロコマンダー", style: "先行", adj: -0.08, odds: 71, coat: 0x5a3a22, silk: 0x9acd32 },
      { name: "ダイワオーシュウ",   style: "差し", adj: -0.1, odds: 88, coat: 0x7a5230, silk: 0xb08968 }
    ]
  },
  {
    title: "2022 天皇賞（秋）", course: COURSES.tokyo, dist: 2000,
    spdAdj: 0.4, drainK: 0.36, pace: [59, 61], vision: "天皇賞(秋) 芝2000m",
    player: { name: "イクイノックス", odds: 2.6, coat: 0x26211c, mane: 0x171310, silk: 0x1c3f99 },
    rivals: [
      { name: "パンサラッサ",   style: "大逃げ", adj: 0.0,   odds: 8.9, coat: 0x6b4423, silk: 0xd23a2e },
      { name: "ジャックドール", style: "先行",   adj: 0.1,   odds: 7.0, coat: 0x5a3a22, silk: 0xe8c522 },
      { name: "ダノンベルーガ", style: "差し",   adj: 0.12,  odds: 4.9, coat: 0x5a3a22, silk: 0x2da84f },
      { name: "シャフリヤール", style: "差し",   adj: 0.15,  odds: 5.9, coat: 0x352a1e, silk: 0x8a3fd1 },
      { name: "ジオグリフ",     style: "先行",   adj: 0.0,   odds: 14, coat: 0x6b4423, silk: 0xe07a20 },
      { name: "マリアエレーナ", style: "差し",   adj: -0.05, odds: 21, coat: 0x7a5230, silk: 0x22b8c8 },
      { name: "ノースブリッジ", style: "先行",   adj: -0.1,  odds: 42, coat: 0x5f4632, silk: 0xe062a8 },
      { name: "レイパパレ",     style: "先行",   adj: -0.02, odds: 26, coat: 0x6b4423, silk: 0xf0f0f0 },
      { name: "バビット",       style: "逃げ",   adj: -0.05, odds: 91, coat: 0x5a3a22, silk: 0x7fd4ff },
      { name: "ユーバーレーベン", style: "追込", adj: -0.05, odds: 58, coat: 0x3a2c20, silk: 0x9acd32 },
      { name: "カラテ",         style: "差し",   adj: -0.08, odds: 54, coat: 0x5f4632, silk: 0xb08968 }
    ]
  },
  {
    title: "2005 日本ダービー", course: COURSES.tokyo, dist: 2400,
    spdAdj: 0.2, drainK: 0.30, pace: [60, 62], vision: "日本ダービー 芝2400m",
    player: { name: "ディープインパクト", odds: 1.1, coat: 0x4a2c17, mane: 0x1d130b, silk: 0x2b6fdd },
    rivals: [
      { name: "コンゴウリキシオー", style: "逃げ", adj: 0.0,   odds: 33, coat: 0x9a6a33, silk: 0xd23a2e },
      { name: "インティライミ",     style: "先行", adj: 0.15,  odds: 14, coat: 0x6b4423, silk: 0x2da84f },
      { name: "シックスセンス",     style: "差し", adj: 0.12,  odds: 9.8, coat: 0x352a1e, silk: 0xe8c522 },
      { name: "アドマイヤフジ",     style: "差し", adj: 0.1,   odds: 20, coat: 0x5a3a22, silk: 0x8a3fd1 },
      { name: "マイネルレコルト",   style: "先行", adj: 0.05,  odds: 25, coat: 0x7a5230, silk: 0xe07a20 },
      { name: "ローゼンクロイツ",   style: "差し", adj: 0.05,  odds: 7.1, coat: 0x3a2c20, silk: 0x22b8c8 },
      { name: "アドマイヤジャパン", style: "先行", adj: 0.0,   odds: 12, coat: 0x5f4632, silk: 0xe062a8 },
      { name: "ニシノドコマデ",     style: "差し", adj: -0.02, odds: 61, coat: 0x7a5230, silk: 0xf0f0f0 },
      { name: "ペールギュント",     style: "差し", adj: -0.05, odds: 46, coat: 0x5f4632, silk: 0x7fd4ff },
      { name: "シャドウゲイト",     style: "先行", adj: -0.05, odds: 82, coat: 0x6b4423, silk: 0x9acd32 },
      { name: "ダンスインザモア",   style: "先行", adj: -0.08, odds: 94, coat: 0x5a3a22, silk: 0xb08968 }
    ]
  },
  {
    title: "1990 安田記念", course: COURSES.tokyo, dist: 1600,
    spdAdj: 0.9, drainK: 0.45, pace: [57.5, 59.5], vision: "安田記念 芝1600m",
    player: { name: "オグリキャップ", odds: 1.4, coat: 0xd2d2d2, mane: 0xbdbdbd, silk: 0xd23a2e },
    rivals: [
      { name: "ケープポイント",   style: "逃げ", adj: -0.05, odds: 44, coat: 0x6b4423, silk: 0x2b6fdd },
      { name: "ヤエノムテキ",     style: "先行", adj: 0.15,  odds: 8.4, coat: 0x5a3a22, silk: 0x2da84f },
      { name: "オサイチジョージ", style: "先行", adj: 0.1,   odds: 6.9, coat: 0x8b5a2b, silk: 0xe8c522 },
      { name: "バンブーメモリー", style: "差し", adj: 0.05,  odds: 4.8, coat: 0x3a2c20, silk: 0x8a3fd1 },
      { name: "シンウインド",     style: "差し", adj: 0.05,  odds: 29, coat: 0x7a5230, silk: 0xe07a20 },
      { name: "ホクトヘリオス",   style: "先行", adj: 0.0,   odds: 24, coat: 0x5a3a22, silk: 0x22b8c8 },
      { name: "コガネターボ",     style: "差し", adj: -0.05, odds: 49, coat: 0x6b4423, silk: 0xe062a8 },
      { name: "リンドホシ",       style: "差し", adj: -0.05, odds: 63, coat: 0x7a5230, silk: 0xf0f0f0 },
      { name: "ジュネーブシンボリ", style: "先行", adj: -0.05, odds: 72, coat: 0x5a3a22, silk: 0x7fd4ff },
      { name: "メジロモニカ",     style: "差し", adj: -0.08, odds: 85, coat: 0x6b4423, silk: 0x9acd32 },
      { name: "イズミサンシャイン", style: "先行", adj: -0.1, odds: 96, coat: 0x3a2c20, silk: 0xb08968 }
    ]
  }
];

// ==== コース座標系 ====
// s: 周回距離, lane: ラチ(内柵)からの外向き距離
function railPoint(s) {
  s = ((s % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  if (s < T1) return { x: -HALF + s, z: R };
  if (s < T2) { const t = Math.PI / 2 - (s - T1) / R;
    return { x: HALF + R * Math.cos(t), z: R * Math.sin(t) }; }
  if (s < T3) return { x: HALF - (s - T2), z: -R };
  const t = -Math.PI / 2 - (s - T3) / R;
  return { x: -HALF + R * Math.cos(t), z: R * Math.sin(t) };
}
function posAt(s, lane) {
  const p = railPoint(s);
  const cx = Math.max(-HALF, Math.min(HALF, p.x));
  let ox = p.x - cx, oz = p.z;
  const l = Math.hypot(ox, oz) || 1;
  ox /= l; oz /= l;
  let x = p.x + ox * lane, z = p.z + oz * lane, hx = oz, hz = -ox;
  if (DIR < 0) { z = -z; oz = -oz; hz = -hz; }  // 右回り: コースを鏡映
  return { x: x, z: z, ox: ox, oz: oz, hx: hx, hz: hz };
}

// ==== シーン ====
const scene = new THREE.Scene();
const sceneRoot = scene;
scene.background = new THREE.Color(0x9fc8ef);
scene.fog = new THREE.Fog(0x9fc8ef, 160, 750);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 1200);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.id = "view";
document.body.insertBefore(renderer.domElement, document.body.firstChild);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x6f9a55, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(150, 260, 80);
scene.add(sun);

// --- 地面と馬場 ---
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 900),
  new THREE.MeshLambertMaterial({ color: 0x4e9a4e })
);
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.05;
scene.add(grass);

function stadiumPath(rad, asShape) {
  const p = asShape ? new THREE.Shape() : new THREE.Path();
  p.moveTo(-HALF, -rad);
  p.lineTo(HALF, -rad);
  p.absarc(HALF, 0, rad, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(-HALF, rad);
  p.absarc(-HALF, 0, rad, Math.PI / 2, Math.PI * 1.5, false);
  return p;
}
// --- テキストテクスチャ ---
function textCanvas(text, opt) {
  opt = opt || {};
  const c = document.createElement("canvas");
  c.width = opt.w || 256; c.height = opt.h || 128;
  const g = c.getContext("2d");
  g.fillStyle = opt.bg || "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 10; g.strokeRect(0, 0, c.width, c.height); }
  g.fillStyle = opt.fg || "#c22";
  g.font = "bold " + (opt.size || 64) + "px sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2);
  return new THREE.CanvasTexture(c);
}

// ==== コース構築（競馬場ごとに作り直す） ====
let courseGroup = null, builtCourse = null;
let visionMat = null;

function buildCourse(cs) {
  if (builtCourse === cs) return;
  builtCourse = cs;
  TRACK_LEN = cs.len; STRAIGHT = cs.straight; HALF = STRAIGHT / 2;
  R = (cs.len - 2 * cs.straight) / (2 * Math.PI);
  T1 = STRAIGHT; T2 = T1 + Math.PI * R; T3 = T2 + STRAIGHT;
  GOAL_MOD = cs.goal; DIR = cs.dir;
  REM_CORNER = GOAL_MOD + (TRACK_LEN - T3);
  if (courseGroup) sceneRoot.remove(courseGroup);
  courseGroup = new THREE.Group();
  sceneRoot.add(courseGroup);
  const scene = courseGroup;   // 以降の scene.add はコースグループに入る

const trackShape = stadiumPath(R + 15, true);
trackShape.holes.push(stadiumPath(R - 1.5, false));
const track = new THREE.Mesh(
  new THREE.ShapeGeometry(trackShape, 64),
  new THREE.MeshLambertMaterial({ color: 0x86b45c })
);
track.rotation.x = -Math.PI / 2;
track.position.y = 0.01;
scene.add(track);

// --- ラチ（柵）: 内外のレール + 支柱 ---
function railCurve(lane, y) {
  const pts = [];
  for (let s = 0; s < TRACK_LEN; s += 8) {
    const p = posAt(s, lane);
    pts.push(new THREE.Vector3(p.x, y, p.z));
  }
  return new THREE.CatmullRomCurve3(pts, true);
}
const railMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
scene.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve(-0.3, 1.05), 520, 0.05, 6, true), railMat));
scene.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve(14.8, 1.05), 540, 0.05, 6, true), railMat));

const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.05, 5);
const nPost = Math.ceil(TRACK_LEN / 8) * 2 + 4;
const posts = new THREE.InstancedMesh(postGeo, railMat, nPost);
{
  const m = new THREE.Matrix4();
  let i = 0;
  for (let s = 0; s < TRACK_LEN && i < nPost / 2; s += 8, i++) {
    const p = posAt(s, -0.3);
    m.makeTranslation(p.x, 0.52, p.z);
    posts.setMatrixAt(i, m);
  }
  for (let s = 0; s < TRACK_LEN && i < nPost; s += 8, i++) {
    const p = posAt(s, 14.8);
    m.makeTranslation(p.x, 0.52, p.z);
    posts.setMatrixAt(i, m);
  }
  posts.count = i;
  posts.instanceMatrix.needsUpdate = true;
}
scene.add(posts);

// --- ゴールライン・ゴール柱 ---
{
  const p = posAt(GOAL_MOD, 7.25);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(16.5, 1.0),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(p.x, 0.03, p.z);
  line.rotation.z = -Math.atan2(p.hx, p.hz);
  scene.add(line);

  // ゴール板（内ラチ側に立つ実際のスタイル。板面はスタンド側を向く）
  const gp = posAt(GOAL_MOD, -1.6);
  const gpole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0f0f0 })
  );
  gpole.position.set(gp.x, 2.1, gp.z);
  scene.add(gpole);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.7),
    new THREE.MeshBasicMaterial({ map: textCanvas("GOAL", { bg: "#fff", fg: "#c22", border: "#c22", w: 256, h: 128, size: 64 }), side: THREE.DoubleSide })
  );
  board.position.set(gp.x, 3.6, gp.z);
  board.rotation.y = Math.atan2(gp.ox, gp.oz);
  scene.add(board);
}

// --- 残り距離標識 ---
[200, 400, 600, 800, 1000].forEach(function (rem) {
  const s = ((GOAL_MOD - rem) % TRACK_LEN + TRACK_LEN) % TRACK_LEN;
  const p = posAt(s, 16.8);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 1.8),
    new THREE.MeshBasicMaterial({ map: textCanvas("残り" + rem, { border: "#c22", size: 56 }), side: THREE.DoubleSide })
  );
  sign.position.set(p.x, 1.9, p.z);
  sign.rotation.y = Math.atan2(-p.hx, -p.hz);
  scene.add(sign);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), railMat);
  pole.position.set(p.x, 0.5, p.z);
  scene.add(pole);
});

// --- スタンド・観客・ビジョン・木 ---
{
  const SW = STRAIGHT * 0.8, SCX = STRAIGHT * 0.15;   // スタンド幅・中心x
  const standMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 });
  for (let t = 0; t < 3; t++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(SW, 5 + t * 4, 10), standMat);
    tier.position.set(SCX, (5 + t * 4) / 2, DIR * (R + 24 + t * 9));
    scene.add(tier);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(SW + 5, 1, 14), new THREE.MeshLambertMaterial({ color: 0x7d838d }));
  roof.position.set(SCX, 15.5, DIR * (R + 40));
  scene.add(roof);

  const crowdGeo = new THREE.BoxGeometry(0.5, 0.7, 0.4);
  const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 300);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let i = 0; i < 300; i++) {
    const t = Math.floor(Math.random() * 3);
    m.makeTranslation(SCX + (Math.random() - 0.5) * SW * 0.94,
      5.7 + t * 4, DIR * (R + 20.5 + t * 9 + Math.random() * 3));
    crowd.setMatrixAt(i, m);
    if (crowd.setColorAt) {
      col.setHSL(Math.random(), 0.7, 0.55);
      crowd.setColorAt(i, col);
    }
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  scene.add(crowd);

  visionMat = new THREE.MeshBasicMaterial({ map: textCanvas("JOCKEY VISION", { bg: "#123", fg: "#8f8", w: 512, h: 160, size: 62 }) });
  const vision = new THREE.Mesh(new THREE.PlaneGeometry(38, 11), visionMat);
  vision.position.set(HALF * 0.45, 8, DIR * (R - 75));
  if (DIR < 0) vision.rotation.y = Math.PI;
  scene.add(vision);
  const vbox = new THREE.Mesh(new THREE.BoxGeometry(40, 13, 1.5), new THREE.MeshLambertMaterial({ color: 0x222831 }));
  vbox.position.set(HALF * 0.45, 7.8, DIR * (R - 76));
  scene.add(vbox);

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7a35 });
  for (let i = 0; i < 40; i++) {
    const s = Math.random() * TRACK_LEN;
    const p = posAt(s, 20 + Math.random() * 45);
    if (p.z * DIR > R + 12 && p.x > -HALF * 0.5 && p.x < HALF * 1.1) continue; // スタンド前は空ける
    const h = 4 + Math.random() * 4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, h * 0.4, 5), trunkMat);
    trunk.position.set(p.x, h * 0.2, p.z);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h * 0.8, 7), leafMat);
    leaf.position.set(p.x, h * 0.4 + h * 0.4, p.z);
    scene.add(trunk); scene.add(leaf);
  }
}
} // buildCourse ここまで

// ==== 馬メッシュ（AI用・遠景用） ====
function makeLabel(text, colorHex) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#" + colorHex.toString(16).padStart(6, "0");
  g.globalAlpha = 0.85;
  g.fillRect(0, 0, 256, 64);
  g.globalAlpha = 1;
  g.fillStyle = "#fff";
  g.font = "bold 34px sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9 }));
  sp.scale.set(2.6, 0.65, 1);
  return sp;
}

function buildHorseMesh(coat, silk, name) {
  const grp = new THREE.Group();
  const coatMat = new THREE.MeshLambertMaterial({ color: coat });
  const silkMat = new THREE.MeshLambertMaterial({ color: silk });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 1.9), coatMat);
  body.position.y = 1.15;
  grp.add(body);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.85, 0.5), coatMat);
  neck.position.set(0, 1.65, 0.85);
  neck.rotation.x = -0.5;
  grp.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.62, 0.32), coatMat);
  head.position.set(0, 2.0, 1.22);
  head.rotation.x = -0.9;
  grp.add(head);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.14), new THREE.MeshLambertMaterial({ color: 0x241a10 }));
  tail.position.set(0, 1.25, -1.05);
  tail.rotation.x = 0.5;
  grp.add(tail);

  const legGeo = new THREE.BoxGeometry(0.14, 0.95, 0.14);
  legGeo.translate(0, -0.45, 0);
  const legs = [];
  [[0.22, 0.72], [-0.22, 0.72], [0.22, -0.72], [-0.22, -0.72]].forEach(function (o) {
    const leg = new THREE.Mesh(legGeo, coatMat);
    leg.position.set(o[0], 1.0, o[1]);
    grp.add(leg); legs.push(leg);
  });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), silkMat);
  torso.position.set(0, 1.85, -0.15);
  torso.rotation.x = 0.6;
  grp.add(torso);
  const jhead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), silkMat);
  jhead.position.set(0, 2.12, 0.02);
  grp.add(jhead);

  const label = makeLabel(name, silk);
  label.position.y = 2.85;
  grp.add(label);

  grp.userData.legs = legs;
  return grp;
}

// ==== 一人称パーツ（自馬の首・ムチ） ====
const fp = new THREE.Group();
const fpCoatMat = new THREE.MeshLambertMaterial({ color: 0x5a3a22 });
const fpManeMat = new THREE.MeshLambertMaterial({ color: 0x241a10 });
{
  const coatMat = fpCoatMat;
  const maneMat = fpManeMat;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 1.35, 8), coatMat);
  neck.rotation.x = -1.15;
  neck.position.set(0, -0.42, -0.95);
  fp.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.28), coatMat);
  head.rotation.x = -0.55;
  head.position.set(0, -0.62, -1.72);
  fp.add(head);

  const earGeo = new THREE.ConeGeometry(0.05, 0.2, 6);
  [-0.09, 0.09].forEach(function (x) {
    const ear = new THREE.Mesh(earGeo, coatMat);
    ear.position.set(x, -0.24, -1.55);
    ear.rotation.x = -0.4;
    fp.add(ear);
  });

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.95), maneMat);
  mane.position.set(0, -0.24, -0.95);
  mane.rotation.x = -0.12;
  fp.add(mane);

  const glove = new THREE.BoxGeometry(0.09, 0.09, 0.2);
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  [-0.2, 0.2].forEach(function (x) {
    const hand = new THREE.Mesh(glove, gloveMat);
    hand.position.set(x, -0.52, -0.62);
    fp.add(hand);
  });
}
const whip = new THREE.Mesh(
  new THREE.CylinderGeometry(0.013, 0.02, 0.9, 6),
  new THREE.MeshLambertMaterial({ color: 0x332211 })
);
whip.position.set(0.38, -0.3, -0.6);
whip.rotation.z = -0.35;
fp.add(whip);
camera.add(fp);

// ==== 馬データ ====
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

let horses = [];
let pl = null;

function initRace(raceIdx) {
  RACE = RACES[raceIdx];
  buildCourse(RACE.course);
  FINISH_S = GOAL_MOD + 2 * TRACK_LEN;
  START_S = FINISH_S - RACE.dist;

  const gates = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  horses = [];
  for (let i = 0; i < N; i++) {
    const isPlayer = i === 0;
    const e = isPlayer ? RACE.player : RACE.rivals[i - 1];
    const st = isPlayer ? null : STYLES[e.style];
    const rnd = function (a) { return (Math.random() * 2 - 1) * a; };
    const gate = gates[i];
    const h = {
      idx: i, name: e.name, silk: e.silk, style: isPlayer ? "自在" : e.style, isPlayer: isPlayer,
      s: START_S - 2, v: 0, lane: 0.8 + gate * 1.15, targetLane: 0.8 + gate * 1.15,
      startLane: 0.8 + gate * 1.15, gate: gate,
      stamina: 100, exhausted: false, phase: Math.random() * 6,
      kakari: isPlayer ? 0.25 : 0.2 + Math.random() * 0.25,
      paceMul: 1,
      finished: false, finishTime: 0, blocked: false, slip: false, blockT: 0,
      reaction: 0.08 + Math.random() * 0.3,
      cruise: st ? st.cruise + RACE.spdAdj + e.adj * 0.4 + rnd(0.05) + 0.03 - (demo ? 0.32 : 0) : 0,
      maxV: st ? st.maxV + RACE.spdAdj + e.adj * 0.4 + rnd(0.05) + 0.03 - (demo ? 0.32 : 0) : 0,
      early: st ? st.early : 0,
      spurt: st ? st.spurt * (0.75 + RACE.dist / 6400) + rnd(40) : 0,
      wob: Math.random() * 10,
      nextMove: 2 + Math.random() * 6, drift: null, atkLane: 0,
      mesh: null
    };
    if (!isPlayer) {
      h.mesh = buildHorseMesh(e.coat, e.silk, h.name);
      scene.add(h.mesh);
    }
    horses.push(h);
  }
  pl = horses[0];

  // スパート時の攻め進路を全幅に分散（直線で馬群がばらける）
  {
    const lanes = [0.8, 1.7, 2.6, 3.5, 4.4, 5.3, 6.2, 7.1, 8.0, 8.9, 9.8];
    shuffle(lanes);
    for (let i = 1; i < N; i++) horses[i].atkLane = lanes[i - 1];
  }

  fpCoatMat.color.setHex(RACE.player.coat);
  fpManeMat.color.setHex(RACE.player.mane);
  visionMat.map = textCanvas(RACE.vision, { bg: "#123", fg: "#8f8", w: 512, h: 160, size: 52 });
  visionMat.needsUpdate = true;
  elDist.textContent = RACE.dist;
  whipTimer = whipCdTimer = whipAnim = 0;
  kakariWarned = false;
  // レースごとにペースが振れる(±0.3m/s) → ハイ/ミドル/スローが発生する
  paceBias = (Math.random() * 2 - 1) * 0.3;
  if (demo) paceBias = 0;   // デモはミドルペース固定
}

// ==== 入力 ====
const keys = {};
let whipTimer = 0, whipCdTimer = 0, whipAnim = 0;
let kakariWarned = false;   // 折り合いは各馬の h.kakari (0=完璧 1=完全に掛かる)
let demo = false;

function doWhip() {
  if (whipCdTimer > 0 || !pl || pl.finished || pl.stamina <= 2) return;
  pl.stamina = Math.max(0, pl.stamina - PLAYER.whipCost);
  whipTimer = PLAYER.whipTime;
  whipCdTimer = PLAYER.whipCd;
  whipAnim = 0.35;
}

addEventListener("keydown", function (e) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
  if (demo && e.code !== "KeyV") return;   // デモ中は後方確認以外の操作を受け付けない
  keys[e.code] = true;
  if (e.code === "Space" && state === "race") doWhip();
});
addEventListener("keyup", function (e) { if (!demo || e.code === "KeyV") keys[e.code] = false; });
const down = function (c1, c2) { return keys[c1] || keys[c2]; };

// ==== HUD ====
const $ = function (id) { return document.getElementById(id); };
const elDist = $("dist"), elRank = $("rank"), elStam = $("stamBar"),
      elSpeed = $("speed"), elMsg = $("msg"), elCount = $("count"),
      elKoaiBar = $("koaiBar"), elDemoTip = $("demoTip"), elPos = $("posState"),
      elTime = $("rtime"), elPace = $("pace1000");
let msgTimer = 0;
function showMsg(t, dur) {
  elMsg.textContent = t;
  elMsg.style.opacity = 1;
  msgTimer = dur || 2.2;
}
const fired = {};
function fireOnce(key, fn) { if (!fired[key]) { fired[key] = true; fn(); } }

// ==== デモ自動操縦（勝ちパターンの再生） ====
function setTip(t) { elDemoTip.textContent = "🎬 デモ — " + t; }

function demoControl() {
  keys.ArrowUp = keys.ArrowDown = keys.ArrowLeft = keys.ArrowRight = false;
  if (!pl || pl.finished) { setTip("ゴール！ これが勝ちパターン"); return; }
  const rem = FINISH_S - pl.s;
  const raced = pl.s - START_S;

  // いちばん近い前の馬（スリップストリームの的）
  let tgt = null;
  for (let i = 1; i < horses.length; i++) {
    const o = horses[i], ds = o.s - pl.s;
    if (ds > 1 && ds < 15 && (!tgt || ds < tgt.ds)) tgt = { h: o, ds: ds };
  }

  if (raced < 450) {
    // 好位抜け出し: 序盤の位置取りダッシュ（この区間は掛からない）
    keys.ArrowUp = true;
    if (pl.blocked) keys.ArrowRight = true;
    setTip("序盤: ダッシュして2〜4番手の好位を確保（450mまでは掛からない）");
  } else if (rem > 800) {
    // 道中: 前の馬の真後ろで折り合いに専念
    if (pl.blocked) keys.ArrowRight = true;   // 詰まったら掛かる前に横へ
    else if (tgt) {
      const dl = tgt.h.lane - pl.lane;
      if (dl > 0.3) keys.ArrowRight = true;
      else if (dl < -0.3) keys.ArrowLeft = true;
    }
    setTip(pl.slip ? "道中: 好位のポケットで折り合う（消耗-40%・デモは折り合い完璧の想定）"
                   : "道中: 前の馬の真後ろへ進路を合わせる");
  } else {
    keys.ArrowUp = true;
    if (pl.blocked) keys.ArrowRight = true;   // 詰まったら外へ
    if (rem < GOAL_MOD) {
      if (pl.stamina > 24) doWhip();   // バテるラインの手前までムチ
      setTip("最終直線: 抜け出してムチ！（スタミナ24までは使ってよい）");
    } else {
      setTip("残り800m: 先頭を射程に入れて早めのスパート [↑]");
    }
  }
}

// ==== ミニマップ ====
const mm = $("minimap").getContext("2d");
function drawMinimap() {
  const W = 230, H = 110, CX = W / 2, CY = H / 2;
  // コースサイズに合わせてスケール。右回りは180度回転してスタンドを下に
  const K = Math.min((W - 18) / (2 * (HALF + R + 16)), (H - 10) / (2 * (R + 16)));
  const F = DIR;
  const mx = function (p) { return CX + p.x * K * F; };
  const my = function (p) { return CY + p.z * K * F; };
  mm.clearRect(0, 0, W, H);
  mm.strokeStyle = "rgba(210,190,140,0.9)";
  mm.lineWidth = Math.max(3, 15 * K);
  mm.beginPath();
  for (let s = 0; s <= TRACK_LEN; s += 20) {
    const p = posAt(s, 7);
    if (s === 0) mm.moveTo(mx(p), my(p));
    else mm.lineTo(mx(p), my(p));
  }
  mm.closePath(); mm.stroke();
  mm.strokeStyle = "#fff"; mm.lineWidth = 2;
  mm.beginPath();
  const gi = posAt(GOAL_MOD, -1), go = posAt(GOAL_MOD, 15);
  mm.moveTo(mx(gi), my(gi));
  mm.lineTo(mx(go), my(go));
  mm.stroke();
  for (let i = horses.length - 1; i >= 0; i--) {
    const h = horses[i];
    const p = posAt(h.s, h.lane);
    mm.fillStyle = "#" + h.silk.toString(16).padStart(6, "0");
    mm.beginPath();
    mm.arc(mx(p), my(p), h.isPlayer ? 4 : 3, 0, Math.PI * 2);
    mm.fill();
    if (h.isPlayer) { mm.strokeStyle = "#fff"; mm.lineWidth = 1.5; mm.stroke(); }
  }
}

// ==== レースロジック ====
let state = "title";   // title | count | race | result
let countT = 0, raceTime = 0, resultTimer = -1;
let paceBias = 0;      // レースごとのペースの振れ（AI全体に加算）
let leadS = 0;         // 未ゴール馬の先頭位置（集団収束の基準）

function nearAhead(h) {
  let bestBlock = null, bestSlip = null, cover = false;
  for (let i = 0; i < horses.length; i++) {
    const o = horses[i];
    if (o === h || o.finished) continue;   // ゴール済みの馬は壁にもスリップにもならない
    const ds = o.s - h.s;
    const dl = Math.abs(o.lane - h.lane);
    if (ds > 0 && ds < 4.0 && dl < 1.3) {
      if (!bestBlock || o.s < bestBlock.s) bestBlock = o;
    }
    if (ds >= 2.5 && ds < 9 && dl < 1.15) {
      if (!bestSlip || o.s < bestSlip.s) bestSlip = o;
    }
    if (ds > 0 && ds < 12 && dl < 1.5) cover = true;   // 前に「壁」がいる
  }
  return { block: bestBlock, slip: bestSlip, cover: cover };
}

function updateHorse(h, dt) {
  if (h.finished) { h.v = Math.max(11, h.v - dt * 1.5); h.s += h.v * dt; return; }   // ゴール後は流す（後続の邪魔はしない）
  if (raceTime < h.reaction) return;

  const rem = FINISH_S - h.s;
  const raced = h.s - START_S;
  let tv;

  // 残スタミナが多いほど末脚が伸びる（道中で溜めた脚の変換・最大+1.0）
  const stamKick = Math.max(0, Math.min(1.0, (h.stamina - 28) * 0.03));
  // 集団収束: 前と離れているほど脚を使って追走する → 馬群が千切れず、終いは後方から飛んでくる
  const chase = Math.min(2.2, Math.max(0, (leadS - h.s) * 0.02));
  if (h.isPlayer) {
    tv = PLAYER.cruiseV + RACE.spdAdj;
    if (down("ArrowUp", "KeyW")) tv = PLAYER.pushV + RACE.spdAdj + (rem < 900 ? stamKick : 0);
    if (down("ArrowDown", "KeyS")) tv = PLAYER.easeV + RACE.spdAdj;
    tv += rem < 900 ? chase : chase * 0.6;
    if (whipTimer > 0) tv = Math.min(PLAYER.whipCap + RACE.spdAdj, tv + PLAYER.whipBoost);
  } else {
    tv = h.cruise + paceBias;
    if (raced < 400) tv = h.cruise + h.early + paceBias;
    // 中弛み: 道中でペースが波打ち、馬群が縮んだり伸びたりする
    if (raced > 700 && rem > h.spurt + 250 && Math.sin((raced - 700) / 180) > 0.1) tv -= 0.35;
    if (rem < h.spurt) tv = h.maxV + stamKick;
    tv += rem < h.spurt ? chase : chase * 0.6;
    tv += Math.sin(raceTime * 0.7 + h.wob) * 0.15;
  }

  const near = nearAhead(h);
  h.slip = !!near.slip;
  h.cover = near.cover;
  if (h.slip) tv += 0.3;

  // 折り合い（全馬対象）: スパートに入るまでずっと管理が必要。
  // 前に壁がないと行きたがり、急に詰まると引っ掛かる。壁・スリップ・↓で落ち着く
  {
    const spurtPhase = rem < 900;   // 仕掛けどころ以降は追ってOK
    let dk;
    if (spurtPhase) {
      dk = -0.30;
    } else {
      dk = h.isPlayer ? -0.06 : -0.20;   // AIの騎手は宥めがうまい
      if (h.isPlayer) {
        // 序盤450mの位置取りダッシュは掛からない（テンに出すのは折り合いと別）
        if (down("ArrowUp", "KeyW") && raced > 450) dk += 0.25;
        if (whipTimer > 0) dk += 0.28;
        // 強く手綱を引くとハミを噛んで余計に掛かる（序盤の位置取りの抑えは対象外）
        if (down("ArrowDown", "KeyS") && raced > 450) dk += 0.38;
      }
      const lone = !h.isPlayer && h.early > 0.5;   // 逃げ系は単騎でも折り合える
      if (!near.cover && !lone) dk += 0.16;        // 前が開いていると行きたがる
      if (h.blocked) dk += h.isPlayer ? 0.30 : 0.15; // 詰まると引っ掛かる(AI騎手は捌く)
      if (h.slip) dk -= 0.08;
    }
    if (raced < 300 && dk > 0) dk = 0;   // 最初の300mは掛かりが進行しない
    if (demo && h.isPlayer) dk = -0.6;   // デモ騎手は折り合い完璧の想定
    h.kakari = Math.max(0, Math.min(1, h.kakari + dk * dt));
    if (h.kakari > 0.5) {
      // 掛かり: 抑えが利かなくなる
      tv = Math.max(tv, (h.isPlayer ? PLAYER.cruiseV + RACE.spdAdj : h.cruise) + 0.5);
      if (h.isPlayer && h.kakari > 0.75 && !kakariWarned) {
        kakariWarned = true;
        showMsg("掛かった！ 壁の後ろで我慢させろ！", 2.2);
      }
    }
    if (h.isPlayer && h.kakari < 0.5) kakariWarned = false;
  }

  // スタミナが減ると脚色が鈍る（ソフトなバテ・下限つき）。前で消耗した馬は直線で捕まる
  if (h.stamina < 15) tv = Math.min(tv, Math.max(16.0 + RACE.spdAdj, 13.6 + RACE.spdAdj + h.stamina * 0.3));

  // 加減速
  const acc = h.v < 12 ? PLAYER.startAccel : PLAYER.accel;
  if (h.v < tv) h.v = Math.min(tv, h.v + acc * dt);
  else h.v = Math.max(tv, h.v - 1.8 * dt);

  // 前が壁なら同速まで減速して追走。急ブレーキではなく、車間が近いほど強い減速率で近づける
  h.blocked = false;
  if (near.block && h.v > near.block.v) {
    const gap = near.block.s - h.s;
    let capV = near.block.v * (gap < 2.8 ? 0.97 : 1.0);
    if (raced < 150) capV = Math.max(capV, 7);   // スタート直後に0km/hへ張り付かない
    const brake = gap < 1.6 ? 30 : gap < 2.6 ? 8 : 3.5;   // m/s^2
    if (h.v > capV) {
      h.v = Math.max(capV, h.v - brake * dt);
      h.blocked = true;
    }
  }

  // 重なり解消: ほぼ同じ位置に重なった馬は横に押し出される
  for (let i = 0; i < horses.length; i++) {
    const o = horses[i];
    if (o === h || o.finished) continue;
    if (Math.abs(o.s - h.s) < 1.6 && Math.abs(o.lane - h.lane) < 0.7) {
      h.lane += (h.lane >= o.lane ? 1 : -1) * 1.2 * dt;
      h.lane = Math.max(0.3, Math.min(12.5, h.lane));
      break;
    }
  }

  // スタミナ。テン(序盤)を飛ばすと余計に消耗する = 逃げのリスク
  let drain = Math.max(0, h.v - PLAYER.drainBase - RACE.spdAdj) * RACE.drainK;
  if (raced < 500) drain *= 1.35;   // テンに脚を使った代償を重く（前崩れしやすく）
  if (h.slip) drain *= 0.6;
  else if (h.cover) drain *= 0.8;   // 壁があるだけでも風よけになる
  // 掛かりの代償（全馬）: ゲージ半分を超えると消耗が増え、深いほど重くなる(最大+80%)
  if (h.kakari > 0.5) drain *= 1 + (h.kakari - 0.5) * 1.6;
  // ペース補正: ハイペースは前の馬に重く、スローは前の馬に軽い（1000m通過時に決定）
  drain *= h.paceMul;
  if (drain > 0) h.stamina -= drain * dt;   // 回復はしない（使ったら戻らない）
  h.stamina = Math.max(0, h.stamina);
  if (h.stamina <= 0 && !h.exhausted) {
    h.exhausted = true;
    if (h.isPlayer) showMsg("バテた！ 脚が止まる…", 2.5);
  }

  // 進路（AI）: 道中は原則ラチ沿いの隊列。長く詰まった時だけ外へ持ち出す（まくり）。
  // スパートでは各馬の攻め進路に持ち出して直線でばらける
  if (!h.isPlayer) {
    if (rem >= h.spurt) {
      // 基本は内へ寄せるが、詰まっている時は無理に突っ込まない。
      // 長く詰まったら外の列に移り、道中はその列を守る（隊列が2〜3列に分散する）
      if (h.drift != null) h.targetLane = h.drift;
      else h.targetLane = h.blocked ? h.lane : 0.9;
      if (h.blocked) h.blockT += dt; else h.blockT = Math.max(0, h.blockT - dt);
      if (h.blockT > 1.5) {
        h.drift = Math.min(10, h.lane + 1.6);
        h.blockT = 0;
      }
    } else {
      h.targetLane = h.atkLane;
      if (h.blocked) h.targetLane = Math.min(11, h.lane + 2.0);
    }
    const dl = h.targetLane - h.lane;
    const lsp = rem < h.spurt ? 1.4 : 0.9;   // 道中の進路変更はゆっくり
    const step = Math.max(-lsp * dt, Math.min(lsp * dt, dl));
    if (step !== 0 && !sideBlocked(h, Math.sign(step))) h.lane += step;
  }

  h.s += h.v * dt;
  h.phase += dt * (2.0 + h.v * 0.55);

  if (h.s >= FINISH_S) {
    h.finished = true;
    h.finishTime = raceTime - (h.s - FINISH_S) / Math.max(h.v, 1);
    if (h.isPlayer) {
      const place = horses.filter(function (o) { return o.finished; }).length;
      showMsg("ゴール！ " + place + "着", 3);
      resultTimer = 3.2;
    }
  }
}

// 最初の500m以降は真横にいる馬をすり抜けての進路変更はできない
function sideBlocked(h, dir) {
  if (h.s - START_S < 500) return false;
  for (let i = 0; i < horses.length; i++) {
    const o = horses[i];
    if (o === h || o.finished) continue;
    const ds = Math.abs(o.s - h.s);
    const dl = o.lane - h.lane;
    if (ds < 2.6 && dl * dir > 0 && Math.abs(dl) < 1.2) return true;
  }
  return false;
}

function playerLane(dt) {
  if (pl.finished) return;
  let d = 0;
  if (down("ArrowRight", "KeyD")) d += 1;
  if (down("ArrowLeft", "KeyA")) d -= 1;
  // DIR: 左回りは右キー=外(lane+)、右回りは右キー=内(lane-)
  const dLane = d * DIR;
  if (dLane !== 0 && sideBlocked(pl, dLane)) return;   // 横に馬がいて動けない
  pl.lane = Math.max(PLAYER.minLane, Math.min(PLAYER.maxLane, pl.lane + dLane * PLAYER.laneSpeed * dt));
}

function rankOf(h) {
  let r = 1;
  for (let i = 0; i < horses.length; i++) {
    const o = horses[i];
    if (o === h) continue;
    if (o.finished && h.finished) { if (o.finishTime < h.finishTime) r++; }
    else if (o.finished && !h.finished) r++;
    else if (!o.finished && !h.finished && o.s > h.s) r++;
  }
  return r;
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1);
  return m + ":" + (Number(s) < 10 ? "0" : "") + s;
}

function showResult() {
  state = "result";
  const list = horses.slice().sort(function (a, b) {
    const ta = a.finished ? a.finishTime : 9999 + (FINISH_S - a.s);
    const tb = b.finished ? b.finishTime : 9999 + (FINISH_S - b.s);
    return ta - tb;
  });
  let html = "<tr><th>着</th><th>馬名</th><th>脚質</th><th>タイム</th></tr>";
  list.forEach(function (h, i) {
    const t = h.finished ? fmtTime(h.finishTime)
      : fmtTime(raceTime + (FINISH_S - h.s) / Math.max(h.v, 8)) + "*";
    html += "<tr" + (h.isPlayer ? ' class="me"' : "") + "><td>" + (i + 1) + "</td>" +
      '<td><span class="silk" style="background:#' + h.silk.toString(16).padStart(6, "0") + '"></span>' +
      h.name + (h.isPlayer ? "（あなた）" : "") + "</td>" +
      "<td>" + h.style + "</td><td>" + t + "</td></tr>";
  });
  $("resTable").innerHTML = html;
  const myRank = list.indexOf(pl) + 1;
  $("resTitle").textContent = (demo ? "🎬 デモ: " : "") + RACE.title + " — " + (myRank === 1 ? "🏆 優勝！" : myRank + "着");
  $("result").classList.remove("hidden");
}

// ==== カメラ ====
function updateCamera(dt) {
  if (!pl || state === "title") {
    // タイトル画面: スタンド上空からコースを見渡す
    const t = performance.now() * 0.00008;
    camera.position.set(HALF * 0.5 + Math.sin(t) * 45, 24, DIR * (R + 58));
    camera.lookAt(0, 0, 0);
    camera.fov = 62;
    camera.updateProjectionMatrix();
    fp.visible = false;
    return;
  }
  const back = !!keys.KeyV;      // Vキー: 後方確認
  fp.visible = !back;
  const p = posAt(pl.s, pl.lane);
  const spdF = Math.min(1, pl.v / 15);
  const bob = Math.sin(pl.phase) * 0.09 * spdF;
  const sway = Math.sin(pl.phase * 0.5) * 0.05 * spdF;
  camera.position.set(p.x + p.ox * sway, 2.0 + bob, p.z + p.oz * sway);
  const look = posAt(pl.s + (back ? -30 : 25), pl.lane);
  camera.lookAt(look.x, back ? 1.7 : 1.45, look.z);
  camera.rotateZ(Math.sin(pl.phase * 0.5) * 0.018 * spdF + (whipAnim > 0 ? (Math.random() - 0.5) * 0.02 : 0));

  camera.fov = 72 + Math.max(0, pl.v - 13) * 1.1;
  camera.updateProjectionMatrix();

  // 自馬の首の上下（体感速度の演出）
  fp.position.y = Math.sin(pl.phase + 2.6) * 0.1 * spdF;
  fp.rotation.x = Math.sin(pl.phase + 2.0) * 0.045 * spdF;
  whip.rotation.x = whipAnim > 0 ? -1.6 * (whipAnim / 0.35) : 0;
}

// ==== AIメッシュ反映 ====
function updateMeshes() {
  for (let i = 1; i < horses.length; i++) {
    const h = horses[i];
    const p = posAt(h.s, h.lane);
    h.mesh.position.set(p.x, 0.02 + Math.abs(Math.sin(h.phase)) * 0.1 * Math.min(1, h.v / 14), p.z);
    h.mesh.rotation.y = Math.atan2(p.hx, p.hz);
    const legs = h.mesh.userData.legs;
    const sw = Math.min(1, h.v / 14);
    legs[0].rotation.x = Math.sin(h.phase) * 0.9 * sw;
    legs[1].rotation.x = Math.sin(h.phase + 0.5) * 0.9 * sw;
    legs[2].rotation.x = Math.sin(h.phase + Math.PI) * 0.9 * sw;
    legs[3].rotation.x = Math.sin(h.phase + Math.PI + 0.5) * 0.9 * sw;
  }
}

// ==== HUD更新 ====
function updateHUD(dt) {
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) elMsg.style.opacity = 0; }
  if (!pl) return;
  const rem = Math.max(0, Math.round(FINISH_S - pl.s));
  elDist.textContent = pl.finished ? 0 : rem;
  elRank.textContent = rankOf(pl);
  const st = pl.stamina;
  elStam.style.width = st + "%";
  elStam.style.background = pl.exhausted ? "#d0342c" : st > 50 ? "#3ec46d" : st > 25 ? "#e8c522" : "#e07a20";
  elSpeed.textContent = Math.round(pl.v * 3.6) + " km/h";
  elKoaiBar.style.width = Math.round((1 - pl.kakari) * 100) + "%";
  elKoaiBar.style.background = pl.kakari < 0.4 ? "#3ec46d" : pl.kakari < 0.7 ? "#e8c522" : "#d0342c";
  elTime.textContent = (state === "race" || state === "result")
    ? fmtTime(pl.finished ? pl.finishTime : raceTime) : "0:00.0";

  // ポジション状態（道中の駆け引き用フィードバック）
  let ps = "", pc = "";
  if (state === "race" && !pl.finished) {
    if (pl.blocked) { ps = "前が詰まった！"; pc = "#ff7a6a"; }
    else if (pl.kakari > 0.5) { ps = "掛かっている！ 壁の後ろへ"; pc = "#ff7a6a"; }
    else if (pl.slip) { ps = "スリップストリーム中（消耗-40%）"; pc = "#6dff9f"; }
    else if (!pl.cover && rem > 900) { ps = "前が開いている…行きたがる"; pc = "#ffd75a"; }
  }
  elPos.textContent = ps;
  elPos.style.color = pc;

  if (state === "race" && !pl.finished) {
    // 先頭馬の1000m通過でペースを判定
    if (!fired.pace1000) {
      let lead = 0;
      for (let i = 0; i < horses.length; i++) lead = Math.max(lead, horses[i].s - START_S);
      if (lead >= 1000) {
        const t1000 = raceTime;
        const label = t1000 < RACE.pace[0] ? "ハイ" : t1000 > RACE.pace[1] ? "スロー" : "ミドル";
        fireOnce("pace1000", function () {
          showMsg("1000m通過 " + t1000.toFixed(1) + "秒 — " + label + "ペース", 2.6);
          elPace.textContent = "前半1000m " + t1000.toFixed(1) + "s（" + label + "）";
          // ハイペースなら前にいる馬(5番手以内)の消耗が増え、スローなら軽くなる
          const eff = label === "ハイ" ? 1 : label === "スロー" ? -1 : 0;
          if (eff !== 0) {
            for (let i = 0; i < horses.length; i++) {
              const o = horses[i];
              const r = rankOf(o);
              o.paceMul = r <= 5 ? (eff > 0 ? 1.12 : 0.90) : (eff > 0 ? 0.98 : 1.02);
            }
            if (eff > 0) showMsg("1000m通過 " + t1000.toFixed(1) + "秒 — ハイペース！ 前は苦しい", 2.6);
          }
        });
      }
    }
    if (rem <= REM_CORNER) fireOnce("corner", function () { showMsg("3〜4コーナー！", 2); });
    if (rem <= GOAL_MOD) fireOnce("straight", function () { showMsg("最終直線" + Math.round(GOAL_MOD) + "m！ ラストスパート！", 2.5); });
    if (pl.stamina < 22 && !pl.exhausted) fireOnce("lowstam", function () { showMsg("スタミナ残りわずか！", 2); });
  }
}

// ==== メインループ ====
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === "count") {
    countT -= dt;
    if (countT > 0.5) elCount.textContent = Math.ceil(countT - 0.5);
    else if (countT > 0) elCount.textContent = "";
    if (countT <= 0) {
      state = "race";
      elCount.classList.add("hidden");
      showMsg("スタート！", 1.6);
    }
  }

  if (state === "race" || state === "result") {
    raceTime += dt;
    if (whipTimer > 0) whipTimer -= dt;
    if (whipCdTimer > 0) whipCdTimer -= dt;
    if (whipAnim > 0) whipAnim -= dt;
    if (demo) demoControl();
    playerLane(dt);
    leadS = -1e9;
    for (let i = 0; i < horses.length; i++) if (!horses[i].finished) leadS = Math.max(leadS, horses[i].s);
    for (let i = 0; i < N; i++) updateHorse(horses[i], dt);
    if (resultTimer > 0) {
      resultTimer -= dt;
      if (resultTimer <= 0 && state === "race") showResult();
    }
  }

  updateMeshes();
  updateCamera(dt);
  updateHUD(dt);
  drawMinimap();
  renderer.render(scene, camera);
}

// ==== 出馬表・オッズ ====
function wakuOf(bn) { return bn <= 4 ? bn : 4 + Math.ceil((bn - 4) / 2); }
const WAKU_BG = ["", "#ffffff", "#222222", "#d63333", "#2255cc", "#e8c522", "#2da84f", "#e07220", "#e88ab0"];
const WAKU_FG = ["", "#000", "#fff", "#fff", "#fff", "#000", "#fff", "#fff", "#000"];

function buildEntryTable() {
  // 単勝オッズ: 史実の値(判明分)+当時の人気に沿った推定値をデータから使用
  horses.forEach(function (h) {
    const e = h.isPlayer ? RACE.player : RACE.rivals[h.idx - 1];
    h.odds = e.odds;
  });
  const byOdds = horses.slice().sort(function (a, b) { return a.odds - b.odds; });
  horses.forEach(function (h) { h.pop = byOdds.indexOf(h) + 1; });

  const list = horses.slice().sort(function (a, b) { return a.gate - b.gate; });
  let html = "<tr><th>枠</th><th>馬番</th><th>馬名</th><th>脚質</th><th>単勝</th><th>人気</th></tr>";
  list.forEach(function (h) {
    const bn = h.gate + 1, w = wakuOf(bn);
    html += "<tr" + (h.isPlayer ? ' class="me"' : "") + ">" +
      '<td><span class="waku" style="background:' + WAKU_BG[w] + ";color:" + WAKU_FG[w] + '">' + w + "</span></td>" +
      "<td>" + bn + "</td>" +
      '<td><span class="silk" style="background:#' + h.silk.toString(16).padStart(6, "0") + '"></span>' +
      h.name + (h.isPlayer ? "（騎乗）" : "") + "</td>" +
      "<td>" + h.style + "</td>" +
      "<td>" + h.odds.toFixed(1) + "</td>" +
      "<td>" + h.pop + "人気</td></tr>";
  });
  $("entryTable").innerHTML = html;
  $("entryTitle").textContent = RACE.title + " 出馬表";
  $("entryCourse").textContent = RACE.course.name + " " + RACE.dist + "m ／ 12頭";
}

// ==== 開始処理 ====
function beginRace() {
  $("entry").classList.add("hidden");
  elCount.classList.remove("hidden");
  state = "count";
  countT = 3.5;
}
document.querySelectorAll(".raceBtn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    if (state !== "title") return;
    initRace(Number(btn.dataset.race));
    $("title").classList.add("hidden");
    buildEntryTable();
    $("entry").classList.remove("hidden");
  });
});
$("gateBtn").addEventListener("click", function () {
  if (state !== "title") return;
  beginRace();
});
$("demoBtn").addEventListener("click", function (e) {
  e.stopPropagation();
  if (state !== "title") return;
  demo = true;
  initRace(2);   // 2022 天皇賞（秋）
  pl.reaction = 0.05;              // デモはスタートを決める
  elDemoTip.style.display = "block";
  setTip("スタートを待つ…");
  $("title").classList.add("hidden");
  beginRace();
});
$("retryBtn").addEventListener("click", function () { location.reload(); });

buildCourse(COURSES.tokyo);   // タイトル画面の背景用
updateMeshes();
requestAnimationFrame(animate);
})();
