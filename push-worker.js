// 킬렐러 우체국 — 푸시 알림 중계소 (Cloudflare Workers에 붙여 넣어 쓰는 파일)
//
// 하는 일: 회원이 쪽지·둘만의 방·채팅·댓글을 남기면 사이트가 여기로 "알려 줘"라고 부릅니다.
// 중계소는 그 사람이 정말 회원인지 확인하고, Firestore에서 실제 내용을 읽어 받을 사람을 정한 뒤,
// Firebase Cloud Messaging으로 받는 사람의 휴대폰·컴퓨터에 바로 알림을 보냅니다.
//
// 필요한 설정 (Cloudflare 대시보드 → 이 Worker → Settings → Variables and Secrets)
//   FIREBASE_SERVICE_ACCOUNT  (Secret)  Firebase 관리자 키 JSON 파일 내용 전체
//   ALLOWED_ORIGIN            (선택)    사이트 주소. 예: https://lastsummerdream.github.io

const CHANNEL_NAMES = {
  square: "광장", school: "페이건 오멘 스쿨", kilrelagh: "킬렐러 마을",
  chapel: "성 카흘루 예배당", castle: "캐슬 페이건", marsh: "늪과 숲"
};

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return text("킬렐러 우체국 알림 중계소가 일하고 있습니다.", 200, cors);
    if (req.method !== "POST" || url.pathname !== "/notify") return text("not found", 404, cors);
    try {
      const sa = readServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
      if (sa.error) return text(sa.error, 500, cors);
      const g = new Google(sa);
      const idToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const caller = await verifyIdToken(idToken, sa.project_id).catch(() => null);
      if (!caller) return text("unauthorized", 401, cors);
      if (!(await g.get(`members/${caller}`))) return text("not a member", 403, cors);
      const body = await req.json().catch(() => ({}));
      const job = await plan(g, caller, body);
      if (!job) return json({ sent: 0 }, 200, cors);
      if (job.test) {                        // 시험 푸시: 끝까지 보내 보고 결과를 그대로 돌려줌
        const results = await deliver(g, job);
        return json({ test: true, tokens: results.length, results }, 200, cors);
      }
      ctx.waitUntil(deliver(g, job));       // 응답은 바로 돌려주고, 보내기는 뒤에서
      return json({ queued: job.to.length }, 200, cors);
    } catch (e) {
      return text("error: " + (e && e.message || e), 500, cors);
    }
  }
};

/* ---------------- 관리자 키 읽기: Secret(글자)로 넣었든 JSON 형식 변수로 넣었든 둘 다 받음 ---------------- */
function readServiceAccount(v) {
  if (!v) return { error: "FIREBASE_SERVICE_ACCOUNT가 비어 있습니다. Cloudflare → Settings → Variables and Secrets에 Firebase 관리자 키 JSON을 넣어 주세요." };
  let o = v;
  if (typeof v === "string") {
    const t = v.trim().replace(/^['"`]+|['"`]+$/g, "");
    try { o = JSON.parse(t); }
    catch (e) {
      return { error: t.startsWith("B") && t.length < 120
        ? "FIREBASE_SERVICE_ACCOUNT에 웹 푸시 키(vapidKey)가 들어 있습니다. Firebase 관리자 키 JSON 전체({ \"type\": \"service_account\" ... })로 바꿔 주세요."
        : "FIREBASE_SERVICE_ACCOUNT를 JSON으로 읽지 못했습니다. 관리자 키 파일의 { 부터 } 까지 전부 붙여 넣었는지 확인해 주세요." };
    }
  }
  if (!o || typeof o !== "object" || !o.private_key || !o.client_email || !o.project_id)
    return { error: "FIREBASE_SERVICE_ACCOUNT에 private_key·client_email·project_id가 없습니다. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성으로 받은 JSON을 넣어 주세요." };
  return o;
}

/* ---------------- 받을 사람과 내용 정하기 (클라이언트 말은 믿지 않고 Firestore에서 다시 읽음) ---------------- */
const SAFE_ID = /^[A-Za-z0-9_\-]{1,200}$/;
async function plan(g, caller, b) {
  const kind = b && b.kind;
  if (kind === "test") {
    return { to: [caller], test: true, title: "✠ 킬렐러 우체국 · 푸시 시험", body: "이 알림이 보이면 푸시 알림이 잘 오는 거예요.", hash: "#/settings/notify", tag: "test" };
  }
  if (kind === "dm" || kind === "room") {
    if (!SAFE_ID.test(b.id || "")) return null;
    const col = kind === "dm" ? "dms" : "rooms";
    const c = await g.get(`${col}/${b.id}`);
    if (!c || !Array.isArray(c.participants) || !c.participants.includes(caller)) return null;
    if (c.lastSender !== caller || (kind === "room" && c.closed)) return null;
    if (!fresh(c.lastAt)) return null;
    const chars = await g.getMany((c.chars || []).map(id => `characters/${id}`));
    const mine = chars.find(x => x && x.ownerUid === caller);
    const name = mine ? mine.name : "누군가";
    const to = c.participants.filter(u => u !== caller);
    const title = kind === "dm" ? `✉ ${name}의 쪽지` : `🕯 둘만의 방 · ${name}`;
    return { to, title, body: c.lastText || "", hash: `#/${kind === "dm" ? "mail" : "rooms"}/${b.id}`, tag: `${kind}:${b.id}` };
  }
  if (kind === "chat") {
    if (!CHANNEL_NAMES[b.channel] || !SAFE_ID.test(b.id || "")) return null;
    const m = await g.get(`channels/${b.channel}/messages/${b.id}`);
    if (!m || m.uid !== caller || !fresh(m.createdAt)) return null;
    const all = await g.list("characters");
    const to = mentionedOwners(m.text, all, caller);
    if (!to.length) return null;
    return { to, title: `${m.charName || "누군가"} · ${CHANNEL_NAMES[b.channel]}`, body: m.text || "", hash: `#/chat/${b.channel}`, tag: `chat:${b.channel}` };
  }
  if (kind === "comment") {
    if (!SAFE_ID.test(b.post || "") || !SAFE_ID.test(b.id || "")) return null;
    const [p, cm] = await g.getMany([`posts/${b.post}`, `posts/${b.post}/comments/${b.id}`]);
    if (!p || !cm || cm.uid !== caller || !fresh(cm.createdAt)) return null;
    const to = new Set();
    if (p.uid && p.uid !== caller && p.uid !== "npc") to.add(p.uid);
    const all = await g.list("characters");
    for (const u of mentionedOwners(cm.text, all, caller)) to.add(u);
    if (!to.size) return null;
    return { to: [...to], title: `💬 ${cm.charName || "누군가"}의 댓글 · ${p.title || "게시판"}`, body: cm.text || "", hash: `#/board/${b.post}`, tag: `post:${b.post}` };
  }
  return null;
}
function fresh(ts) { const d = ts instanceof Date ? ts : null; return !!d && Date.now() - d.getTime() < 10 * 60 * 1000; }
function namesOf(c) {
  const out = new Set();
  const n = (c.name || "").trim(); if (n.length >= 2) out.add(n.toLowerCase());
  const first = n.split(/\s+/)[0]; if (first && first.length >= 2) out.add(first.toLowerCase());
  const en = (c.nameEn || "").trim().split(/\s+/)[0]; if (en && en.length >= 3) out.add(en.toLowerCase());
  return [...out];
}
function mentionedOwners(text, chars, caller) {
  const t = (text || "").toLowerCase(), to = new Set();
  for (const c of chars) {
    if (!c || c.npc || !c.ownerUid || c.ownerUid === caller || c.ownerUid === "npc") continue;
    if (namesOf(c).some(n => t.includes(n))) to.add(c.ownerUid);
  }
  return [...to];
}

/* ---------------- 보내기 ---------------- */
async function deliver(g, job) {
  const body = clip(job.body, 150), results = [];
  for (const uid of job.to) {
    const doc = await g.get(`pushTokens/${uid}`);
    const tokens = doc && doc.tokens ? doc.tokens : {};
    for (const token of Object.keys(tokens)) {
      const r = await g.fcm({
        token,
        data: { title: job.title, body, hash: job.hash, tag: job.tag || job.hash, test: job.test ? "1" : "0" },
        android: { priority: "high", ttl: "86400s" },
        webpush: { headers: { Urgency: "high", TTL: "86400" } }
      });
      results.push({ platform: (tokens[token] && tokens[token].platform) || "?", result: r.result, status: r.status, detail: r.detail });
      if (r.result === "gone") await g.removeToken(uid, token);
    }
  }
  return results;
}
function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

/* ---------------- Firebase 로그인 토큰 확인 ---------------- */
let certCache = { at: 0, keys: [] };
async function verifyIdToken(tok, projectId) {
  const parts = (tok || "").split(".");
  if (parts.length !== 3) return null;
  const header = JSON.parse(b64urlText(parts[0])), claims = JSON.parse(b64urlText(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256") return null;
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (!claims.sub || claims.exp < now - 30 || claims.iat > now + 300) return null;
  if (Date.now() - certCache.at > 3600 * 1000 || !certCache.keys.some(k => k.kid === header.kid)) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if (!r.ok) return null;
    certCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = certCache.keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  return ok ? claims.sub : null;
}

/* ---------------- Google API (관리자 키로) ---------------- */
let tokenCache = { email: "", token: "", exp: 0 };
class Google {
  constructor(sa) { this.sa = sa; this.pid = sa.project_id; this.base = `https://firestore.googleapis.com/v1/projects/${this.pid}/databases/(default)/documents`; }
  async token() {
    const now = Math.floor(Date.now() / 1000);
    if (tokenCache.email === this.sa.client_email && tokenCache.exp > now + 60) return tokenCache.token;
    const head = b64urlJson({ alg: "RS256", typ: "JWT" });
    const claim = b64urlJson({
      iss: this.sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
      scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging"
    });
    const key = await crypto.subtle.importKey("pkcs8", pemToDer(this.sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + head + "." + claim + "." + b64url(new Uint8Array(sig))
    });
    if (!r.ok) throw new Error("google token " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    tokenCache = { email: this.sa.client_email, token: j.access_token, exp: now + (j.expires_in || 3600) };
    return j.access_token;
  }
  async call(url, init = {}) {
    const t = await this.token();
    return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: "Bearer " + t } });
  }
  async get(path) {
    const r = await this.call(`${this.base}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("firestore get " + r.status);
    return fromDoc(await r.json());
  }
  async getMany(paths) { return Promise.all(paths.map(p => this.get(p).catch(() => null))); }
  async list(col) {
    const out = []; let page = "";
    for (let i = 0; i < 10; i++) {
      const r = await this.call(`${this.base}/${col}?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`);
      if (!r.ok) throw new Error("firestore list " + r.status);
      const j = await r.json();
      for (const d of j.documents || []) out.push(fromDoc(d));
      if (!j.nextPageToken) break; page = j.nextPageToken;
    }
    return out;
  }
  async removeToken(uid, token) {
    const field = "tokens.`" + token.replace(/`/g, "") + "`";
    await this.call(`${this.base}/pushTokens/${encodeURIComponent(uid)}?updateMask.fieldPaths=${encodeURIComponent(field)}&currentDocument.exists=true`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: {} })
    }).catch(() => {});
  }
  async fcm(message) {
    const r = await this.call(`https://fcm.googleapis.com/v1/projects/${this.pid}/messages:send`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
    });
    if (r.ok) return { result: "ok", status: r.status, detail: "" };
    const t = await r.text();
    const detail = t.replace(/\s+/g, " ").slice(0, 300);
    if (r.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token|not a valid FCM registration token/i.test(t)) return { result: "gone", status: r.status, detail };
    return { result: "fail", status: r.status, detail };
  }
}

/* ---------------- Firestore 값 풀기 ---------------- */
function fromDoc(d) { const o = {}; for (const [k, v] of Object.entries(d.fields || {})) o[k] = fromVal(v); o.__id = (d.name || "").split("/").pop(); return o; }
function fromVal(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromVal);
  if ("mapValue" in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fromVal(x); return o; }
  if ("referenceValue" in v) return v.referenceValue;
  return null;
}

/* ---------------- 작은 도구들 ---------------- */
function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allow = (env.ALLOWED_ORIGIN || "").trim();
  return {
    "Access-Control-Allow-Origin": !allow ? "*" : (origin === allow ? origin : allow),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function text(s, status, h) { return new Response(s, { status, headers: { ...h, "Content-Type": "text/plain; charset=utf-8" } }); }
function json(o, status, h) { return new Response(JSON.stringify(o), { status, headers: { ...h, "Content-Type": "application/json" } }); }
function b64url(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlJson(o) { return b64url(new TextEncoder().encode(JSON.stringify(o))); }
function b64urlBytes(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function b64urlText(s) { return new TextDecoder().decode(b64urlBytes(s)); }
function pemToDer(pem) { const b = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""); const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

export { plan, mentionedOwners, verifyIdToken, fromDoc, Google };
