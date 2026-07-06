"use strict";

// =====================================================================
// Service Worker: オフラインでも遊べるように主要アセットをキャッシュする。
// 戦略: キャッシュがあれば即返しつつ、裏でネットワークから取得して
// キャッシュを更新する (stale-while-revalidate)。オフライン時はネット
// 取得が失敗するので、あればキャッシュへフォールバックする。
//
// リリースごとにファイルを変更したら CACHE_NAME のバージョンを上げること。
// 古いキャッシュは activate イベントで自動的に破棄される。
// =====================================================================

const CACHE_NAME = "ymt-soccer-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/utils.js",
  "./js/input.js",
  "./js/touch.js",
  "./js/ball.js",
  "./js/player.js",
  "./js/team.js",
  "./js/match.js",
  "./js/render.js",
  "./js/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
