"use strict";

// =====================================================================
// 汎用ユーティリティ (ベクトル演算など)
// ベクトルは {x, y} のプレーンオブジェクトで扱う
// =====================================================================

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function vlen(v) {
  return Math.hypot(v.x, v.y);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// (x, y) を正規化した単位ベクトルを返す。ゼロベクトルは (0,0)
function norm(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

// a から b へ向かう単位ベクトル
function normTo(a, b) {
  return norm(b.x - a.x, b.y - a.y);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

// 点 p から線分 a-b までの距離 (パスコース上の敵判定に使用)
function pointSegDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

// 秒数を "MM:SS" 表記にする
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
