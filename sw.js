// 킬렐러 우체국 — 푸시 알림을 받아 보여 주고, 알림을 누르면 그 대화로 열어 주는 도우미 (화면 저장·캐시는 하지 않음)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch (x) { j = {}; }
  const d = (j && (j.data || j.notification)) || j || {};
  const title = d.title || "킬렐러 우체국";
  const body = d.body || "";
  const hash = typeof d.hash === "string" && d.hash.startsWith("#/") ? d.hash : "#/chat/square";
  e.waitUntil((async () => {
    // 지금 이 사이트를 보고 있으면 기기 알림 대신 화면 안의 안내 띠가 알려 줌
    // Chrome·Edge는 사이트를 보고 있으면 화면 안 안내 띠로 대신함.
    // 아이폰·Safari는 푸시마다 반드시 알림을 보여 줘야 하므로(안 그러면 푸시가 끊김) 늘 보여 줌. 시험 푸시도 늘 보여 줌.
    const ua = (self.navigator && self.navigator.userAgent) || "";
    const chromium = /Chrome|Chromium|Edg\//.test(ua) && !/iPhone|iPad|iPod/.test(ua);
    if (chromium && d.test !== "1") {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.some(w => w.visibilityState === "visible" && w.focused)) return;
    }
    await self.registration.showNotification(title, {
      body, tag: d.tag || hash, renotify: true, data: { hash },
      icon: "icon-192.png", badge: "icon-192.png"
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || "";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { await w.focus(); w.postMessage({ hash }); return; }
    }
    await self.clients.openWindow("./" + hash);
  })());
});
