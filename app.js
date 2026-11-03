// 킬렐러 우체국 — 세계관 참여자 전용 채팅·게시판·쪽지
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where,
  orderBy, limit, limitToLast, onSnapshot, serverTimestamp, writeBatch, increment, deleteField, FieldPath
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getMessaging, getToken, deleteToken, isSupported as msgSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import * as CFG from "./config.js";
const firebaseConfig = CFG.firebaseConfig;

/* ============================== 입력창 자동 확대 막기 ============================== */
// iPhone·iPad의 Safari는 16px보다 작은 글씨의 입력창을 누르면 화면을 자동으로 확대합니다.
// 채팅 글씨(10pt)는 그대로 두고, iOS에서만 자동 확대를 꺼 둡니다. (두 손가락 확대는 iOS에서 계속 됩니다.)
(function () {
  const ua = navigator.userAgent || "";
  const iOS = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!iOS) return;
  let m = document.querySelector('meta[name="viewport"]');
  if (!m) { m = document.createElement("meta"); m.name = "viewport"; document.head.appendChild(m); }
  const c = m.getAttribute("content") || "width=device-width, initial-scale=1, viewport-fit=cover";
  if (!/maximum-scale/.test(c)) m.setAttribute("content", c + ", maximum-scale=1");
})();

/* ============================== 세계관 데이터 ============================== */
const CHANNELS = [
  { id: "square",    name: "광장",             desc: "장소에 얽매이지 않는 전체 대화방" },
  { id: "school",    name: "페이건 오멘 스쿨",  desc: "교정, 강의실, 기숙사, 도서관" },
  { id: "kilrelagh", name: "킬렐러 마을",       desc: "둑길 위의 마을, 여관과 대장간" },
  { id: "chapel",    name: "성 카흘루 예배당",  desc: "늪과 호수가 만나는 섬 위의 예배당" },
  { id: "castle",    name: "캐슬 페이건",       desc: "숲 그늘 속의 저택과 고해실" },
  { id: "marsh",     name: "늪과 숲",           desc: "학생 출입이 금지된 곳" }
];
const AFFILIATIONS = [
  "페이건 오멘 스쿨 · 학생", "페이건 오멘 스쿨 · 교직원", "킬렐러 주민",
  "페이건 가", "성 카흘루 예배당", "외지인", "기타"
];
const ROOM_PLACES = [
  "도서관 구석 열람석", "기숙사 옥상", "빈 강의실", "예배당으로 가는 둑길",
  "늪가의 낡은 보트하우스", "킬렐러 여관 2층 방", "캐슬 페이건 정원"
];
const MAX_CHARS = 8;

/* ============================== 도우미 ============================== */
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const $toast = document.getElementById("toast");
const $active = document.getElementById("active-char");
const $badge = document.getElementById("mail-badge");
const $roomBadge = document.getElementById("room-badge");

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value" || k === "checked") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function mount(...nodes) { $app.replaceChildren(...nodes.flat().filter(n => n !== null && n !== undefined && n !== false)); fitSoon(); }

/* ---------- 대화 상자(채팅·쪽지·둘만의 방)가 화면 높이에 꼭 맞게 ----------
   아래쪽에 음악 버튼이 들어갈 여백(약 52px)을 남겨서, 접힌 음악 버튼이 대화를 가리지 않게 함 */
const MOBILE = window.matchMedia("(max-width: 860px)");
let fitTimer = 0, safeBottom = 0;
function measureSafe() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;height:env(safe-area-inset-bottom, 0px);width:1px";
  document.body.append(probe); safeBottom = probe.offsetHeight || 0; probe.remove();
}
function fitBoxes() {
  const boxes = document.querySelectorAll("#app .chat, #app .mail");
  if (!boxes.length) return;
  measureSafe();
  for (const el of boxes) {
    // 휴대폰 쪽지 목록(대화를 열기 전)은 글 목록처럼 자연스러운 높이로
    if (MOBILE.matches && el.classList.contains("mail") && !el.classList.contains("has-thread")) { el.style.height = "auto"; el.style.minHeight = "0"; continue; }
    el.style.minHeight = "";
    const top = el.getBoundingClientRect().top + window.scrollY;
    const h = window.innerHeight - top - 52 - safeBottom;
    el.style.height = Math.max(MOBILE.matches ? 380 : 460, Math.round(h)) + "px";
  }
}
function fitSoon() { cancelAnimationFrame(fitTimer); fitTimer = requestAnimationFrame(() => requestAnimationFrame(fitBoxes)); }
window.addEventListener("resize", fitSoon);
window.addEventListener("orientationchange", fitSoon);
if (MOBILE.addEventListener) MOBILE.addEventListener("change", fitSoon);
try { new ResizeObserver(fitSoon).observe(document.querySelector(".mast")); } catch (e) {}
let toastTimer = null;
function toast(msg, hash) {
  $toast.textContent = msg; $toast.hidden = false;
  if (hash) { $toast.dataset.hash = hash; $toast.classList.add("link"); } else { delete $toast.dataset.hash; $toast.classList.remove("link"); }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $toast.hidden = true; }, hash ? 6000 : 2600);
}
$toast.addEventListener("click", () => { if ($toast.dataset.hash) location.hash = $toast.dataset.hash; $toast.hidden = true; });
function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function fmtDay(d) { return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`; }
function fmtTime(d) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function fmtShort(d) {
  if (!d) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(d);
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}.${d.getDate()}`;
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}
function errText(e) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-credential": "아이디나 비밀번호가 맞지 않습니다.",
    "auth/wrong-password": "비밀번호가 맞지 않습니다.",
    "auth/user-not-found": "아이디나 비밀번호가 맞지 않습니다.",
    "auth/email-already-in-use": "이미 쓰고 있는 아이디입니다. 다른 아이디를 골라 주세요.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
    "auth/invalid-email": "아이디는 영문 소문자, 숫자, 밑줄(_)로 3~20자여야 합니다.",
    "auth/missing-password": "비밀번호를 입력해 주세요.",
    "auth/too-many-requests": "시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.",
    "auth/requires-recent-login": "보안을 위해 지금 비밀번호를 한 번 더 확인해야 합니다.",
    "auth/operation-not-allowed": "Firebase에서 ‘이메일/비밀번호’ 로그인이 꺼져 있습니다. 운영자에게 알려 주세요.",
    "permission-denied": "권한이 없습니다.",
    "unavailable": "서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요."
  };
  return map[c] || "문제가 생겼습니다. 다시 시도해 주세요." + (c ? ` (${c})` : "");
}
function initial(name) { return (name || "?").trim().charAt(0) || "?"; }
function safeImg(src) { return typeof src === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(src) ? src : null; }
function avatar(ch, size, fallbackName) {
  const box = h("span", { class: "avatar", style: size ? `--s:${size}px` : null, "aria-hidden": "true" });
  const src = ch && safeImg(ch.avatar);
  if (src) box.append(h("img", { src, alt: "" }));
  else box.textContent = initial(ch ? ch.name : fallbackName);
  return box;
}
function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; }
function isComposingKey(e) { return e.isComposing || e.keyCode === 229; }

/* ============================== 설정 확인 ============================== */
document.getElementById("today").textContent = fmtDay(new Date());

if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR")) {
  mount(h("div", { class: "gate" }, h("div", { class: "gate-card" },
    h("span", { class: "kicker", text: "Setup" }),
    h("h2", { text: "아직 연결 전입니다" }),
    h("p", { class: "lead", text: "config.js 파일에 Firebase 프로젝트 정보를 넣어야 우체국이 문을 엽니다. 함께 드린 README의 순서를 따라 주세요." })
  )));
  throw new Error("Firebase 설정이 비어 있습니다 (config.js).");
}

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ============================== 상태 ============================== */
const S = {
  user: null, member: null,
  chars: {}, charList: [], myChars: [], charsReady: false,
  activeId: null, convs: [], rooms: [],
  globalUnsubs: [], viewUnsubs: [], refresh: null, marking: new Set()
};
function isAdmin() { return S.member && S.member.role === "admin"; }
function uid() { return S.user ? S.user.uid : null; }
function activeChar() { return S.activeId ? S.chars[S.activeId] : null; }
function clearView() { S.viewUnsubs.forEach(u => { try { u(); } catch (e) {} }); S.viewUnsubs = []; S.refresh = null; }
function clearAll() { clearView(); S.globalUnsubs.forEach(u => { try { u(); } catch (e) {} }); S.globalUnsubs = []; }
function loadActive() { try { return localStorage.getItem("kp-active-" + uid()); } catch (e) { return null; } }
function saveActive(id) { try { localStorage.setItem("kp-active-" + uid(), id || ""); } catch (e) {} }

/* ============================== 아이디 ============================== */
// Firebase 로그인은 이메일 형식이 필요해서, 아이디를 속으로 "아이디@users.kilrelagh.post"로 바꿔 씁니다.
// 참여자는 이 주소를 볼 일이 없고, 실제로 메일이 가지도 않습니다.
const ID_DOMAIN = "users.kilrelagh.post";
const ID_RULE = /^[a-z0-9_]{3,20}$/;
function normId(v) { return (v || "").trim().toLowerCase(); }
function idToEmail(id) { return `${normId(id)}@${ID_DOMAIN}`; }
function emailToId(email) { return (email || "").endsWith("@" + ID_DOMAIN) ? email.slice(0, -(ID_DOMAIN.length + 1)) : (email || ""); }
let pendingInvite = null;

/* ============================== 인증 흐름 ============================== */
onAuthStateChanged(auth, async (user) => {
  clearAll();
  if (typeof setMusicFor === "function") setMusicFor(null);
  S.user = user; S.member = null; S.chars = {}; S.charList = []; S.myChars = []; S.charsReady = false; S.convs = []; S.rooms = [];
  $nav.hidden = true;
  if (!user) { renderAuth("login"); return; }
  mount(h("p", { class: "loading", text: "명부를 확인하는 중…" }));
  try {
    let snap = await getDoc(doc(db, "members", user.uid));
    if (!snap.exists() && pendingInvite) {
      const code = pendingInvite; pendingInvite = null;
      try {
        await setDoc(doc(db, "members", user.uid), { inviteCode: code, role: "member", createdAt: serverTimestamp() });
        snap = await getDoc(doc(db, "members", user.uid));
      } catch (e) { renderInvite("초대 코드가 맞지 않습니다. 운영자에게 받은 코드를 다시 확인해 주세요."); return; }
    }
    if (!snap.exists()) { renderInvite(); return; }
    S.member = snap.data();
    startMember();
  } catch (e) {
    mount(h("div", { class: "gate" }, h("div", { class: "error", text: errText(e) })));
  }
});

function renderAuth(mode) {
  const signup = mode === "signup";
  const err = h("div", { class: "error", hidden: true });
  const id = h("input", { class: "input", type: "text", id: "login-id", autocomplete: "username", autocapitalize: "none", autocorrect: "off", spellcheck: "false", inputmode: "latin", required: true, maxlength: "20" });
  const pw = h("input", { class: "input", type: "password", id: "pw", autocomplete: signup ? "new-password" : "current-password", required: true, minlength: "6" });
  const pw2 = signup ? h("input", { class: "input", type: "password", id: "pw2", autocomplete: "new-password", required: true }) : null;
  const invite = signup ? h("input", { class: "input", type: "text", id: "signup-invite", autocomplete: "off", autocapitalize: "none", required: true }) : null;
  const submit = h("button", { class: "btn primary", type: "submit", text: signup ? "가입하고 입장하기" : "로그인" });
  const showErr = (m) => { err.textContent = m; err.hidden = false; };
  id.addEventListener("input", () => { const v = id.value.toLowerCase(); if (v !== id.value) id.value = v; });
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      const uidv = normId(id.value);
      if (!ID_RULE.test(uidv)) { showErr("아이디는 영문 소문자, 숫자, 밑줄(_)로 3~20자여야 합니다."); id.focus(); return; }
      if (pw.value.length < 6) { showErr("비밀번호는 6자 이상이어야 합니다."); pw.focus(); return; }
      if (signup && pw.value !== pw2.value) { showErr("비밀번호 확인이 일치하지 않습니다."); pw2.focus(); return; }
      if (signup && !invite.value.trim()) { showErr("초대 코드를 입력해 주세요."); invite.focus(); return; }
      submit.disabled = true;
      try {
        if (signup) { pendingInvite = invite.value.trim(); await createUserWithEmailAndPassword(auth, idToEmail(uidv), pw.value); }
        else await signInWithEmailAndPassword(auth, idToEmail(uidv), pw.value);
      } catch (ex) { pendingInvite = null; showErr(errText(ex)); submit.disabled = false; }
    }
  },
    err,
    h("div", { class: "field" }, h("label", { for: "login-id", text: "아이디" }), id, signup ? h("span", { class: "hint", text: "영문 소문자, 숫자, 밑줄(_) 3~20자. 나중에 바꿀 수 없습니다." }) : null),
    h("div", { class: "field" }, h("label", { for: "pw", text: "비밀번호" }), pw, signup ? h("span", { class: "hint", text: "6자 이상" }) : null),
    signup ? h("div", { class: "field" }, h("label", { for: "pw2", text: "비밀번호 확인" }), pw2) : null,
    signup ? h("div", { class: "field" }, h("label", { for: "signup-invite", text: "초대 코드" }), invite, h("span", { class: "hint", text: "운영자에게 받은 코드" })) : null,
    h("div", { class: "gate-actions" }, submit)
  );
  mount(h("div", { class: "gate" }, h("div", { class: "gate-card" },
    h("span", { class: "kicker", text: signup ? "New Member" : "Members Only" }),
    h("h2", { text: signup ? "우체국 등록" : "우체국 입장" }),
    h("p", { class: "lead", text: signup ? "아이디와 비밀번호를 정하고, 초대 코드를 입력하면 바로 들어갈 수 있습니다." : "이 세계를 아는 사람들만 드나드는 곳입니다." }),
    form,
    h("p", { class: "gate-switch" },
      signup ? "이미 계정이 있나요? " : "처음 오셨나요? ",
      h("button", { class: "linkbtn", type: "button", text: signup ? "로그인" : "가입하기", onclick: () => renderAuth(signup ? "login" : "signup") })),
    signup ? null : h("p", { class: "gate-switch muted", style: "margin-top:6px", text: "비밀번호를 잊었다면 운영자에게 초기화를 부탁하세요." })
  )));
  id.focus();
}

function renderInvite(message) {
  const err = h("div", { class: "error", hidden: !message, text: message || "" });
  const code = h("input", { class: "input", id: "invite", autocomplete: "off", required: true });
  const btn = h("button", { class: "btn primary", type: "submit", text: "입장하기" });
  mount(h("div", { class: "gate" }, h("div", { class: "gate-card" },
    h("span", { class: "kicker", text: "Invitation" }),
    h("h2", { text: "초대 코드" }),
    h("p", { class: "lead", text: "운영자에게 받은 초대 코드를 입력해 주세요. 한 번만 입력하면 됩니다." }),
    h("form", {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; btn.disabled = true;
        try {
          await setDoc(doc(db, "members", uid()), { inviteCode: code.value.trim(), role: "member", createdAt: serverTimestamp() });
          S.member = { role: "member" };
          startMember();
        } catch (ex) {
          err.textContent = ex.code === "permission-denied" ? "초대 코드가 맞지 않습니다." : errText(ex);
          err.hidden = false; btn.disabled = false;
        }
      }
    }, err, h("div", { class: "field" }, h("label", { for: "invite", text: "초대 코드" }), code), h("div", { class: "gate-actions" }, btn)),
    h("p", { class: "gate-switch" }, h("button", { class: "linkbtn", type: "button", text: "다른 계정으로 로그인", onclick: () => signOut(auth) }))
  )));
  code.focus();
}

/* ============================== 회원 시작 ============================== */
function startMember() {
  $nav.hidden = false;
  mount(h("p", { class: "loading", text: "인물록을 펼치는 중…" }));

  S.globalUnsubs.push(onSnapshot(collection(db, "characters"), (snap) => {
    const map = {};
    snap.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
    S.chars = map;
    S.charList = Object.values(map).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
    S.myChars = S.charList.filter(c => c.ownerUid === uid());
    const saved = S.activeId || loadActive();
    S.activeId = S.myChars.some(c => c.id === saved) ? saved : (S.myChars[0] ? S.myChars[0].id : null);
    drawWhoami();
    const first = !S.charsReady; S.charsReady = true;
    if (first) route(); else if (S.refresh) S.refresh();
  }, (e) => mount(h("div", { class: "error", text: errText(e) }))));

  S.globalUnsubs.push(onSnapshot(query(collection(db, "dms"), where("participants", "array-contains", uid())), (snap) => {
    S.convs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (toDate(b.lastAt) || 0) - (toDate(a.lastAt) || 0));
    const n = S.convs.filter(isUnread).length;
    $badge.textContent = n; $badge.hidden = n === 0;
    try { noticeDms(snap); } catch (e) {}
    if (S.refresh) S.refresh();
  }, () => {}));

  S.globalUnsubs.push(onSnapshot(query(collection(db, "rooms"), where("participants", "array-contains", uid())), (snap) => {
    S.rooms = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (toDate(b.lastAt) || 0) - (toDate(a.lastAt) || 0));
    const n = S.rooms.filter(r => !r.closed && isUnread(r)).length;
    $roomBadge.textContent = n; $roomBadge.hidden = n === 0;
    try { noticeRooms(snap); } catch (e) {}
    if (S.refresh) S.refresh();
  }, () => {}));

  startNotices();
}

function isUnread(c) {
  if (!c.lastAt || c.lastSender === uid()) return false;
  const r = c.readAt && toDate(c.readAt[uid()]);
  return !r || r < toDate(c.lastAt);
}

function drawWhoami() {
  if (!S.myChars.length) {
    $active.replaceChildren(h("option", { value: "", text: "캐릭터 없음" }));
    $active.disabled = true;
    return;
  }
  $active.disabled = false;
  $active.replaceChildren(...S.myChars.map(c => h("option", { value: c.id, text: c.name })));
  $active.value = S.activeId || "";
}
$active.addEventListener("change", () => { S.activeId = $active.value; saveActive(S.activeId); toast(`${activeChar().name}(으)로 말합니다.`); if (S.refresh) S.refresh(); });
document.getElementById("logout").addEventListener("click", async () => { await disablePush(); signOut(auth); });

function needChar() {
  return h("div", { class: "empty" },
    h("strong", { text: "먼저 캐릭터를 만들어 주세요" }),
    "대화와 글쓰기는 캐릭터의 이름으로 합니다. ",
    h("a", { href: "#/me/new", text: "캐릭터 만들기 →" }));
}

/* ============================== 채널별 배경음악 ============================== */
// 채널 id → 음악 파일. 여기에 줄을 추가하면 그 채널에서도 음악이 나옵니다.
// default: 채널이 아닌 화면(게시판, 쪽지함, 둘만의 방, 인물록, 내 캐릭터)과 음악이 없는 채널에서 나오는 곡
const CHANNEL_MUSIC = {
  default: "default.mp3",
  square: "square.mp3",
  school: "school.mp3",
  kilrelagh: "kilrelagh.mp3",
  chapel: "chapel.mp3",
  castle: "castle.mp3",
  marsh: "marsh.mp3"
};
const tracks = {};
let current = null;            // 지금 채널의 Audio
let musicWanted = true;
let volume = 40;               // 0~100
const $bgmBox = document.getElementById("bgm-box");
const $bgm = document.getElementById("bgm-toggle");
const $bgmLabel = $bgm.querySelector(".bgm-label");
const $vol = document.getElementById("bgm-volume");
try { if (localStorage.getItem("kp-music") === "off") musicWanted = false; } catch (e) {}
try { const v = parseInt(localStorage.getItem("kp-volume"), 10); if (v >= 0 && v <= 100) volume = v; } catch (e) {}

// iPhone·iPad는 audio.volume을 무시해서, 그쪽에서만 Web Audio로 소리 크기를 조절합니다.
const IOS_AUDIO = /iP(hone|od|ad)/.test(navigator.userAgent || "") || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);
let actx = null;
function ensureAudioCtx() {
  if (!IOS_AUDIO) return;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  // 무음 모드(옆 스위치)에서도 음악이 나오게: Safari 16.4+ 의 audioSession을 '재생' 용도로
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
  if (!actx) { try { actx = new C(); } catch (e) { return; } Object.values(tracks).forEach(connectTrack); }
  if (actx.state === "suspended") actx.resume().catch(() => {});
}
function connectTrack(a) {
  if (!actx || a._gain) return;
  try {
    const src = actx.createMediaElementSource(a), g = actx.createGain();
    src.connect(g); g.connect(actx.destination); a._gain = g;
  } catch (e) {}
  applyVolume();
}
function applyVolume() {
  for (const a of Object.values(tracks)) {
    if (a._gain) { a.volume = 1; a._gain.gain.value = volume / 100; }
    else a.volume = volume / 100;
  }
  $vol.value = String(volume);
  $vol.setAttribute("aria-valuetext", `${volume}%`);
  $vol.style.setProperty("--fill", `${volume}%`);
}
function track(id) {
  if (!tracks[id]) {
    const a = new Audio(CHANNEL_MUSIC[id]);
    a.loop = true; a.preload = "none";
    a.addEventListener("play", drawBgm); a.addEventListener("pause", drawBgm);
    tracks[id] = a;
    connectTrack(a);
    applyVolume();
  }
  return tracks[id];
}
function drawBgm() {
  const on = !!current && !current.paused;
  $bgm.setAttribute("aria-pressed", on ? "true" : "false");
  $bgmLabel.textContent = on ? "Music On" : "Music Off";
  $bgmBox.classList.toggle("playing", on);
}
function tryPlay() {
  if (!current || !musicWanted) return;
  const p = current.play();
  if (p && p.catch) p.catch(() => drawBgm());
}
function setMusicFor(channelId) {
  const id = channelId === null ? null : (CHANNEL_MUSIC[channelId] ? channelId : "default");
  const next = id && CHANNEL_MUSIC[id] ? track(id) : null;
  if (current && current !== next) current.pause();
  current = next;
  $bgmBox.hidden = !current;
  if (current) tryPlay();
  drawBgm();
}
// 브라우저가 자동 재생을 막았을 때: 화면을 처음 누르는 순간 재생
["pointerdown", "keydown"].forEach(t => document.addEventListener(t, (e) => {
  ensureAudioCtx();
  if (e.target && e.target.closest && e.target.closest("#bgm-box")) return;
  if (current && musicWanted && current.paused) tryPlay();
}, true));
$bgm.addEventListener("click", () => {
  if (!current) return;
  ensureAudioCtx();
  if (current.paused) { musicWanted = true; tryPlay(); } else { musicWanted = false; current.pause(); }
  try { localStorage.setItem("kp-music", musicWanted ? "on" : "off"); } catch (e) {}
});
$vol.addEventListener("input", () => {
  ensureAudioCtx();
  volume = Math.max(0, Math.min(100, parseInt($vol.value, 10) || 0));
  applyVolume();
  try { localStorage.setItem("kp-volume", String(volume)); } catch (e) {}
});
applyVolume();
// 음악 막대 접기·펴기 (기본은 접힘: 오른쪽 아래 작은 버튼 하나만 보임). 펼친 상태는 기억함
const $bgmFold = document.getElementById("bgm-fold");
function setBgmOpen(open, save) {
  $bgmBox.dataset.open = open ? "true" : "false";
  $bgmFold.setAttribute("aria-expanded", open ? "true" : "false");
  $bgmFold.setAttribute("aria-label", open ? "음악 막대 접기" : "음악 막대 펼치기");
  if (save) { try { localStorage.setItem("kp-bgm-open", open ? "1" : "0"); } catch (e) {} }
}
let bgmOpen = false; try { bgmOpen = localStorage.getItem("kp-bgm-open") === "1"; } catch (e) {}
setBgmOpen(bgmOpen, false);
$bgmFold.addEventListener("click", () => { ensureAudioCtx(); setBgmOpen($bgmBox.dataset.open !== "true", true); });
// 펼친 채로 다른 곳을 누르면 저절로 접힘 (휴대폰에서 대화를 가리지 않게)
document.addEventListener("pointerdown", (e) => {
  if ($bgmBox.dataset.open === "true" && MOBILE.matches && !(e.target.closest && e.target.closest("#bgm-box"))) setBgmOpen(false, true);
}, true);
// 다른 앱·탭으로 가면 음악을 잠시 멈추고, 돌아오면 다시 (안드로이드 앱은 kp-app-hidden/visible 신호를 보냄)
function bgmAway() { if (current && !current.paused) { current._away = true; current.pause(); } }
function bgmBack() { if (current && current._away) { current._away = false; if (musicWanted) tryPlay(); } }
document.addEventListener("visibilitychange", () => { if (document.hidden) bgmAway(); else bgmBack(); });
window.addEventListener("kp-app-hidden", bgmAway);
window.addEventListener("kp-app-visible", bgmBack);

/* ============================== 알림 ============================== */
// 새 쪽지, 둘만의 방의 새 말, 채팅에서 내 인물 이름이 불린 말, 내 글에 달린 새 댓글을 알려 줍니다.
// 이 화면을 보고 있을 때는 아래쪽 안내 띠로, 다른 탭·앱에 가 있을 때는 기기 알림으로 보여 줍니다.
// (사이트나 앱이 완전히 닫혀 있을 때는 알림이 오지 않습니다.)
const NATIVE = window.KilrelaghApp || null;   // 안드로이드 앱 안에서만 존재
let swReg = null;
if (!NATIVE && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(r => { swReg = r; }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && typeof e.data.hash === "string" && e.data.hash.startsWith("#/")) location.hash = e.data.hash; });
}
function notifyOn() { try { return localStorage.getItem("kp-notify") !== "off"; } catch (e) { return true; } }
function setNotifyOn(on) { try { localStorage.setItem("kp-notify", on ? "on" : "off"); } catch (e) {} }
function notifyPermission() {
  if (NATIVE) { try { return String(NATIVE.permission()); } catch (e) { return "unsupported"; } }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;   // granted | denied | default
}
async function askNotifyPermission() {
  if (NATIVE) { try { NATIVE.requestPermission(); } catch (e) {} return; }
  if ("Notification" in window) { try { await Notification.requestPermission(); } catch (e) {} }
  window.dispatchEvent(new Event("kp-notify-perm"));
}
function appAway() { return document.hidden || window.__kpAppHidden === true; }
function osNotify(title, body, hash) {
  if (notifyPermission() !== "granted") return false;
  if (NATIVE) { try { NATIVE.show(title, body, hash); return true; } catch (e) { return false; } }
  const opts = { body, tag: hash, icon: "icon-192.png", badge: "icon-192.png", data: { hash }, renotify: true };
  if (swReg && swReg.showNotification) { swReg.showNotification(title, opts).catch(() => {}); return true; }
  try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); location.hash = hash; n.close(); }; return true; } catch (e) { return false; }
}
/* ---------- 푸시 알림: 사이트·앱이 닫혀 있어도 바로 오는 알림 ----------
   보낼 때: 글을 남긴 사람의 화면이 알림 중계소(Cloudflare Worker)를 부르고, 중계소가 받을 사람에게 Firebase로 보냄.
   받을 때: 이 기기의 '푸시 주소(토큰)'를 pushTokens/{내 uid}에 적어 둠. */
const PUSH_CFG = CFG.pushConfig || {};
const PUSH_RELAY = (PUSH_CFG.relay || "").trim().replace(/\/+$/, "");
const NATIVE_PUSH = !!(NATIVE && NATIVE.pushToken);
let messaging = null;
function pushKey() { return "kp-push-" + uid(); }
function pushReady() { try { return !!localStorage.getItem(pushKey()); } catch (e) { return false; } }
async function webPushToken() {
  if (!PUSH_CFG.vapidKey || !("serviceWorker" in navigator)) return "";
  if (!(await msgSupported().catch(() => false))) return "";
  const reg = swReg || await navigator.serviceWorker.register("sw.js");
  swReg = reg;
  await navigator.serviceWorker.ready;
  messaging = messaging || getMessaging(fb);
  return await getToken(messaging, { vapidKey: PUSH_CFG.vapidKey, serviceWorkerRegistration: reg });
}
async function enablePush() {
  if (!uid() || !PUSH_RELAY || !notifyOn() || notifyPermission() !== "granted") return;
  let t = "";
  try { t = NATIVE_PUSH ? String(NATIVE.pushToken() || "") : await webPushToken(); } catch (e) { console.warn("푸시 등록 실패", e); }
  if (!t) return;
  try {
    const old = localStorage.getItem(pushKey());
    if (old === t) return;
    await setDoc(doc(db, "pushTokens", uid()), { tokens: { [t]: { platform: NATIVE_PUSH ? "android" : "web", at: serverTimestamp() } } }, { merge: true });
    if (old) { try { await updateDoc(doc(db, "pushTokens", uid()), new FieldPath("tokens", old), deleteField()); } catch (e) {} }
    localStorage.setItem(pushKey(), t);
    window.dispatchEvent(new Event("kp-notify-perm"));
  } catch (e) { console.warn("푸시 주소 저장 실패", e); }
}
async function disablePush() {
  if (!uid()) return;
  let t = null; try { t = localStorage.getItem(pushKey()); } catch (e) {}
  if (!t) return;
  try { await updateDoc(doc(db, "pushTokens", uid()), new FieldPath("tokens", t), deleteField()); } catch (e) {}
  try { localStorage.removeItem(pushKey()); } catch (e) {}
  if (!NATIVE_PUSH && messaging) { try { await deleteToken(messaging); } catch (e) {} }
}
window.addEventListener("kp-push-token", () => { enablePush(); });   // 안드로이드 앱이 푸시 주소를 받았을 때
async function pushOut(payload) {
  if (!PUSH_RELAY || !auth.currentUser) return;
  try {
    const idt = await auth.currentUser.getIdToken();
    fetch(PUSH_RELAY + "/notify", {
      method: "POST",
      headers: { Authorization: "Bearer " + idt, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (e) {}
}

const noticeSeen = new Set();
let noticeSince = 0;
function notice(key, title, body, hash) {
  if (noticeSeen.has(key)) return; noticeSeen.add(key);
  if (!notifyOn()) return;
  body = (body || "").replace(/\s+/g, " ").trim();
  if (body.length > 120) body = body.slice(0, 118) + "…";
  if (!appAway()) { if (location.hash !== hash) toast(`${title} — ${body}`, hash); return; }
  if (pushReady()) return;          // 푸시 알림이 켜진 기기는 푸시가 대신 알려 줌 (두 번 울리지 않게)
  osNotify(title, body, hash);
}
function isNew(ts) { const d = toDate(ts); return !!d && d.getTime() > noticeSince; }
function charName(id, fallback) { const c = S.chars[id]; return c ? c.name : (fallback || "누군가"); }

function noticeDms(snap) {
  if (!noticeSince) return;
  snap.docChanges().forEach(ch => {
    if (ch.type === "removed") return;
    const c = { id: ch.doc.id, ...ch.doc.data({ serverTimestamps: "estimate" }) };
    if (!isUnread(c) || !isNew(c.lastAt)) return;
    const p = convParts(c.id); const other = p ? p.otherId : (c.chars || []).find(x => !(S.chars[x] && S.chars[x].ownerUid === uid()));
    notice(`dm:${c.id}:${toDate(c.lastAt).getTime()}`, `✉ ${charName(other)}의 쪽지`, c.lastText, "#/mail/" + c.id);
  });
}
function noticeRooms(snap) {
  if (!noticeSince) return;
  snap.docChanges().forEach(ch => {
    if (ch.type === "removed") return;
    const r = { id: ch.doc.id, ...ch.doc.data({ serverTimestamps: "estimate" }) };
    if (r.closed || !isUnread(r) || !isNew(r.lastAt)) return;
    const other = roomOther(r, roomMine(r));
    notice(`room:${r.id}:${toDate(r.lastAt).getTime()}`, `🕯 둘만의 방 · ${charName(other)}`, r.lastText, "#/rooms/" + r.id);
  });
}
// 이름이 불렸는지: 전체 이름, 첫 이름(2자 이상), 영어 첫 이름(3자 이상) — 중계소(push-worker.js)와 같은 규칙
function namesOf(c) {
  const out = new Set();
  const n = (c.name || "").trim(); if (n.length >= 2) out.add(n.toLowerCase());
  const first = n.split(/\s+/)[0]; if (first && first.length >= 2) out.add(first.toLowerCase());
  const en = (c.nameEn || "").trim().split(/\s+/)[0]; if (en && en.length >= 3) out.add(en.toLowerCase());
  return [...out];
}
function callsMe(text) {
  const t = (text || "").toLowerCase();
  return S.myChars.some(c => namesOf(c).some(n => t.includes(n)));
}
function callsOthers(text) {
  const t = (text || "").toLowerCase();
  return S.charList.some(c => !c.npc && c.ownerUid && c.ownerUid !== uid() && c.ownerUid !== "npc" && namesOf(c).some(n => t.includes(n)));
}
function startNotices() {
  noticeSince = Date.now();
  const since = new Date(noticeSince);
  // 채널: 내 인물 이름이 들어간 새 말
  for (const chn of CHANNELS) {
    S.globalUnsubs.push(onSnapshot(
      query(collection(db, "channels", chn.id, "messages"), where("createdAt", ">", since), orderBy("createdAt", "desc"), limit(5)),
      (snap) => snap.docChanges().forEach(ch => {
        if (ch.type !== "added") return;
        const m = ch.doc.data();
        if (m.uid === uid() || !callsMe(m.text)) return;
        notice("ch:" + ch.doc.id, `${charName(m.charId, m.charName)} · ${chn.name}`, m.text, "#/chat/" + chn.id);
      }), () => {}));
  }
  // 내 글에 달린 새 댓글
  const counts = new Map();
  S.globalUnsubs.push(onSnapshot(query(collection(db, "posts"), where("uid", "==", uid())), (snap) => {
    snap.docChanges().forEach(async ch => {
      const p = ch.doc.data(); const before = counts.get(ch.doc.id);
      counts.set(ch.doc.id, p.commentCount || 0);
      if (ch.type !== "modified" || before === undefined || (p.commentCount || 0) <= before) return;
      try {
        const cs = await getDocs(query(collection(db, "posts", ch.doc.id, "comments"), orderBy("createdAt", "desc"), limit(1)));
        cs.forEach(d => {
          const cm = d.data();
          if (cm.uid === uid()) return;
          notice("cm:" + d.id, `💬 ${charName(cm.charId, cm.charName)}의 댓글 · ${p.title || "내 글"}`, cm.text, "#/board/" + ch.doc.id);
        });
      } catch (e) {}
    });
  }, () => {}));
  enablePush();
  // 처음 한 번만: 알림을 켤 수 있다고 알려 주기
  try {
    if (notifyPermission() === "default" && !localStorage.getItem("kp-notify-hint")) {
      localStorage.setItem("kp-notify-hint", "1");
      setTimeout(() => toast("알림을 받으려면 ‘설정 → 알림’에서 켜 주세요.", "#/settings/notify"), 2500);
    }
  } catch (e) {}
}

// 푸시 진단: 어디서 막히는지 한 단계씩 확인해서 보여 줌
async function pushDiagnose(out) {
  const lines = [];
  const add = (ok, label, detail) => { lines.push(`${ok === true ? "✓" : ok === false ? "✗" : "·"} ${label}${detail ? " — " + detail : ""}`); out.textContent = lines.join("\n"); };
  const ua = navigator.userAgent || "";
  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  add(null, "기기", NATIVE ? "안드로이드 앱" : (/iPhone|iPad|iPod/.test(ua) ? "아이폰·아이패드" : /Android/.test(ua) ? "안드로이드 브라우저" : "컴퓨터") + (standalone ? " · 홈 화면 앱" : ""));
  add(!!PUSH_RELAY, "중계소 주소(config.js relay)", PUSH_RELAY || "비어 있음");
  if (!NATIVE) add(!!PUSH_CFG.vapidKey, "웹 푸시 키(config.js vapidKey)", PUSH_CFG.vapidKey ? PUSH_CFG.vapidKey.length + "자" : "비어 있음");
  const perm = notifyPermission();
  add(perm === "granted", "알림 권한", perm);
  if (perm !== "granted") { add(false, "멈춤", "먼저 알림을 허용해야 합니다"); return lines; }
  let token = "";
  if (NATIVE) {
    token = NATIVE_PUSH ? String(NATIVE.pushToken() || "") : "";
    add(!!token, "앱 푸시 주소", token ? token.slice(0, 12) + "…" : (NATIVE_PUSH ? "아직 없음 (앱을 껐다 켜 보세요)" : "푸시 없이 만든 앱입니다 (GOOGLE_SERVICES_JSON 확인)"));
  } else {
    let sup = false; try { sup = await msgSupported(); } catch (e) {}
    add(sup, "이 브라우저의 푸시 지원", sup ? "지원" : (/iPhone|iPad|iPod/.test(ua) && !standalone ? "아이폰은 Safari ‘홈 화면에 추가’ 아이콘으로 열어야 합니다" : "지원 안 함"));
    if (!sup) return lines;
    try { const reg = swReg || await navigator.serviceWorker.register("sw.js"); swReg = reg; await navigator.serviceWorker.ready; add(true, "도우미(sw.js)", reg.active ? "작동 중" : "설치 중"); }
    catch (e) { add(false, "도우미(sw.js)", e.message); return lines; }
    try { messaging = messaging || getMessaging(fb); token = await getToken(messaging, { vapidKey: PUSH_CFG.vapidKey, serviceWorkerRegistration: swReg }); add(!!token, "웹 푸시 주소", token ? token.slice(0, 12) + "…" : "받지 못함"); }
    catch (e) { add(false, "웹 푸시 주소", (e.code || "") + " " + (e.message || "")); return lines; }
  }
  if (!token) return lines;
  try {
    await setDoc(doc(db, "pushTokens", uid()), { tokens: { [token]: { platform: NATIVE ? "android" : "web", at: serverTimestamp() } } }, { merge: true });
    try { localStorage.setItem(pushKey(), token); } catch (e) {}
    add(true, "푸시 주소 저장", "Firestore에 저장됨");
  } catch (e) { add(false, "푸시 주소 저장", (e.code || e.message) + (e.code === "permission-denied" ? " (Firebase 규칙 탭에 최신 firestore.rules를 게시했는지 확인)" : "")); return lines; }
  if (!PUSH_RELAY) return lines;
  try { const r = await fetch(PUSH_RELAY + "/"); const t = (await r.text()).slice(0, 80); add(r.ok, "중계소 연결", r.status + " " + t); if (!r.ok) return lines; }
  catch (e) { add(false, "중계소 연결", "닿지 않음: " + e.message + " (주소가 맞는지, Deploy를 눌렀는지 확인)"); return lines; }
  try {
    const idt = await auth.currentUser.getIdToken();
    const r = await fetch(PUSH_RELAY + "/notify", { method: "POST", headers: { Authorization: "Bearer " + idt, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "test" }) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok || !j) { add(false, "시험 푸시", r.status + " " + t.slice(0, 200)); return lines; }
    if (j.test !== true) { add(false, "시험 푸시", "중계소 코드가 예전 버전입니다. Cloudflare에서 push-worker.js 내용을 다시 붙여 넣고 Deploy를 눌러 주세요."); return lines; }
    const okN = (j.results || []).filter(x => x.result === "ok").length;
    add(okN > 0, "시험 푸시 보냄", `등록된 기기 ${j.tokens}곳 중 ${okN}곳 성공`);
    for (const x of j.results || []) if (x.result !== "ok") add(false, `  ${x.platform} 기기`, `${x.result} ${x.status} ${x.detail || ""}`.slice(0, 260));
    if (okN) add(null, "확인", "몇 초 안에 ‘푸시 시험’ 알림이 떠야 합니다. 안 뜨면 이 화면을 캡처해 주세요.");
    if (NATIVE && NATIVE.battery) {
      let bat = ""; try { bat = String(NATIVE.battery()); } catch (e) {}
      add(bat === "free", "배터리 최적화", bat === "free" ? "꺼짐 (알림이 바로 옵니다)" : "켜짐 — 앱이 닫혀 있을 때 알림이 늦거나 안 올 수 있어요. ‘앱 정보 열기 (배터리)’ → 배터리 → 제한 없음으로 바꿔 주세요.");
    }
  } catch (e) { add(false, "시험 푸시", e.message); }
  return lines;
}

function notifyBox() {
  const box = h("section", { class: "account" });
  function draw() {
    const perm = notifyPermission(), on = notifyOn();
    const row = (text, ...btns) => h("div", { class: "account-row" }, h("span", { text }), btns.length ? h("span", { class: "actions", style: "margin:0" }, ...btns) : null);
    let body;
    if (perm === "unsupported") {
      body = row(/iP(hone|od|ad)/.test(navigator.userAgent) ? "아이폰은 Safari에서 ‘홈 화면에 추가’한 아이콘으로 열면 알림을 켤 수 있습니다 (iOS 16.4 이상)." : "이 브라우저는 알림을 지원하지 않습니다.");
    } else if (perm === "denied") {
      body = row("알림이 차단되어 있습니다. 브라우저나 휴대폰 설정에서 이 사이트(앱)의 알림을 허용해 주세요.");
    } else if (perm === "default") {
      body = row("새 쪽지, 둘만의 방, 내 이름이 불린 말, 내 글의 새 댓글을 알려 드립니다.",
        h("button", { class: "btn small primary", type: "button", text: "알림 켜기", onclick: async () => { setNotifyOn(true); await askNotifyPermission(); draw(); enablePush(); } }));
    } else {
      body = row(on ? (pushReady() ? "알림을 받고 있습니다. 사이트나 앱이 닫혀 있어도 바로 옵니다." : "알림을 받고 있습니다.") : "알림이 꺼져 있습니다.",
        on ? h("button", { class: "btn small", type: "button", text: "시험 알림", onclick: () => { if (!osNotify("✠ 킬렐러 우체국", "알림이 이렇게 옵니다.", "#/settings/notify")) toast("알림을 보내지 못했습니다."); } }) : null,
        h("button", { class: "btn small", type: "button", text: on ? "알림 끄기" : "알림 켜기", onclick: async () => { setNotifyOn(!on); if (on) await disablePush(); else await enablePush(); draw(); } }));
    }
    const diagOut = h("pre", { class: "diag", hidden: true });
    const diagBtn = h("button", { class: "btn small", type: "button", text: "푸시 진단하기", onclick: async () => {
      diagBtn.disabled = true; diagOut.hidden = false; diagOut.textContent = "확인하는 중…";
      try { await pushDiagnose(diagOut); } finally { diagBtn.disabled = false; }
    } });
    const appRow = NATIVE && NATIVE.openBattery ? h("div", { class: "account-row" },
      h("span", { class: "muted", text: "안드로이드 앱: 앱이 닫혀 있어도 알림이 오려면 ‘앱 정보 → 배터리 → 제한 없음’으로 바꿔 주세요." }),
      h("span", { class: "actions", style: "margin:0" },
        h("button", { class: "btn small", type: "button", text: "앱 정보 열기 (배터리)", onclick: () => { try { NATIVE.openBattery(); } catch (e) {} } }),
        h("button", { class: "btn small", type: "button", text: "앱 알림 설정", onclick: () => { try { NATIVE.openNotifySettings(); } catch (e) {} } }))) : null;
    const diag = PUSH_RELAY || NATIVE_PUSH ? h("div", { class: "diag-wrap" }, appRow, h("div", { class: "account-row" }, h("span", { class: "muted", text: "푸시가 안 오면 눌러 보세요. 어디서 막히는지 단계별로 보여 줍니다." }), diagBtn), diagOut) : null;
    box.replaceChildren(h("h3", { class: "room-sec", text: "✠ 알림" }), body, ...(diag ? [diag] : []),
      h("p", { class: "muted", style: "font-size:.82rem;margin:8px 0 0", text: pushReady() ? "이 기기로 푸시 알림이 옵니다. 다른 기기에서도 받으려면 그 기기에서도 알림을 켜 주세요."
        : PUSH_RELAY ? "알림을 켜면 이 기기에 푸시 알림이 등록됩니다. (컴퓨터 Chrome·Edge, 안드로이드 앱, 홈 화면에 추가한 아이폰)"
        : "지금은 사이트나 앱이 열려 있을 때만 알림이 옵니다." }));
  }
  window.addEventListener("kp-notify-perm", () => { if (box.isConnected) { draw(); if (notifyPermission() === "granted") enablePush(); } });
  draw();
  return box;
}

/* ============================== 라우터 ============================== */
window.addEventListener("hashchange", () => { if (S.charsReady) route(); });
function route() {
  clearView();
  const parts = (location.hash.replace(/^#\/?/, "") || "chat/square").split("/");
  const [sec, a, b] = parts;
  const navSec = sec === "me" ? "settings" : sec;      // 캐릭터 만들기·고치기 화면도 '설정' 탭에 속함
  document.querySelectorAll("#nav a[data-sec]").forEach(x => {
    if (x.dataset.sec === navSec) {
      x.setAttribute("aria-current", "page");
    } else x.removeAttribute("aria-current");
  });
  showCurrentTab(); setTimeout(showCurrentTab, 350);
  window.scrollTo(0, 0);
  setMusicFor(sec === "chat" ? (a || "square") : "default");
  if (sec === "chat") return viewChat(a || "square");
  if (sec === "board") { if (a === "new") return viewPostForm(null); if (a === "edit") return viewPostForm(b); if (a) return viewPost(a); return viewBoard(); }
  if (sec === "mail") return viewMail(a || null);
  if (sec === "rooms") { if (a === "new") return viewRoomForm(b); if (a) return viewRoom(a); return viewRooms(); }
  if (sec === "people") return a ? viewProfile(a) : viewPeople();
  if (sec === "settings") return viewSettings(a || "chars");
  if (sec === "me") { if (a === "new") return viewCharForm(null); if (a === "edit") return viewCharForm(b); location.replace("#/settings/chars"); return; }
  location.hash = "#/chat/square";
}

/* ============================== 대화 기록 공통 ============================== */
function isNpc(c) { return !!(c && c.npc); }
function renderLog(log, msgs, state, opts) {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  const out = [];
  let prev = null, prevDay = null;
  for (const m of msgs) {
    const d = toDate(m.createdAt) || new Date();
    const day = d.toDateString();
    if (day !== prevDay) { out.push(h("div", { class: "day", text: fmtDay(d) })); prevDay = day; prev = null; }
    const c = S.chars[m.charId];
    const action = m.kind === "action";
    const cont = prev && !action && prev.kind !== "action" && prev.charId === m.charId && (d - (toDate(prev.createdAt) || d)) < 5 * 60 * 1000;
    const mine = m.uid === uid();
    const name = c ? c.name : (m.charName || "사라진 인물");
    const npc = isNpc(c) || m.npc;
    const del = (opts.delRef && (mine || isAdmin()) && !opts.readOnly) ? h("button", {
      class: "msg-del", type: "button", text: "지우기", "aria-label": "메시지 지우기",
      onclick: async () => { if (!confirm("이 메시지를 지울까요?")) return; try { await deleteDoc(opts.delRef(m)); } catch (e) { toast(errText(e)); } }
    }) : null;
    out.push(h("div", { class: "msg" + (cont ? " cont" : "") + (mine ? " mine" : "") + (action ? " action" : "") + (npc ? " npc" : "") },
      avatar(c, 40, name),
      h("div", { class: "msg-body" },
        cont ? null : h("div", { class: "msg-meta" },
          c ? h("a", { class: "msg-name", href: "#/people/" + c.id, text: name }) : h("span", { class: "msg-name", text: name }),
          npc ? h("span", { class: "tag npc", text: "NPC" }) : null,
          c && c.affiliation ? h("span", { class: "msg-aff", text: c.affiliation }) : null,
          h("time", { class: "msg-time", text: fmtTime(d) })),
        h("p", { class: "msg-text", text: action ? `— ${name} ${m.text}` : m.text })),
      del));
    prev = m;
  }
  if (!out.length) out.push(h("div", { class: "empty", style: "margin:auto" }, h("strong", { text: opts.emptyTitle }), opts.emptyText));
  log.replaceChildren(...out);
  if (state.first || nearBottom) log.scrollTop = log.scrollHeight;
  state.first = false;
}
function parseAction(text) {
  if (/^\/me\s+/.test(text)) return { kind: "action", text: text.replace(/^\/me\s+/, "") };
  if (/^\*[^*][\s\S]*\*$/.test(text)) return { kind: "action", text: text.slice(1, -1).trim() };
  return { kind: "say", text };
}

/* ============================== 채팅 ============================== */
function viewChat(chId) {
  const ch = CHANNELS.find(c => c.id === chId) || CHANNELS[0];
  const log = h("div", { class: "log", role: "log", "aria-live": "polite", "aria-label": `${ch.name} 대화` });
  const ta = h("textarea", { id: "chat-input", rows: "1", placeholder: `${ch.name}에 말하기`, "aria-label": "메시지" });
  const who = h("div", { class: "who" });
  const sendBtn = h("button", { class: "btn primary", type: "button", text: "보내기" });
  const select = h("select", { class: "chan-select", "aria-label": "채널 선택", onchange: (e) => { location.hash = "#/chat/" + e.target.value; } },
    CHANNELS.map(c => h("option", { value: c.id, text: c.name })));
  select.value = ch.id;
  let msgs = [];
  const logState = { first: true };

  function drawWho() {
    const me = activeChar();
    who.title = me ? me.name + "(으)로 말합니다" : ""; who.replaceChildren(avatar(me, 36), h("span", { text: me ? me.name : "캐릭터 없음" }));
    ta.disabled = !me; sendBtn.disabled = !me;
    ta.placeholder = me ? `${ch.name}에 말하기` : "캐릭터를 먼저 만들어 주세요";
  }
  function draw() {
    drawWho();
    renderLog(log, msgs, logState, {
      delRef: (m) => doc(db, "channels", ch.id, "messages", m.id),
      emptyTitle: "아직 조용합니다", emptyText: "첫마디를 건네 보세요."
    });
  }
  async function send() {
    const me = activeChar();
    let text = ta.value.trim();
    if (!me || !text) return;
    const parsed = parseAction(text); const kind = parsed.kind; text = parsed.text;
    if (!text) return;
    if (text.length > 2000) { toast("2,000자까지 보낼 수 있습니다."); return; }
    ta.value = ""; autosize(ta);
    try {
      const ref = await addDoc(collection(db, "channels", ch.id, "messages"), {
        uid: uid(), charId: me.id, charName: me.name, text, kind, createdAt: serverTimestamp()
      });
      if (callsOthers(text)) pushOut({ kind: "chat", channel: ch.id, id: ref.id });
    } catch (e) { toast(errText(e)); ta.value = text; autosize(ta); }
  }
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposingKey(e)) { e.preventDefault(); send(); }
  });
  ta.addEventListener("input", () => autosize(ta));
  sendBtn.addEventListener("click", send);

  mount(h("section", { class: "chat" },
    h("nav", { class: "channels", "aria-label": "채널" },
      h("h3", { text: "Channels · 채널" }),
      CHANNELS.map(c => h("a", { href: "#/chat/" + c.id, "aria-current": c.id === ch.id ? "page" : null }, h("strong", { text: c.name }), h("span", { text: c.desc })))),
    h("div", { class: "room" },
      select,
      h("div", { class: "room-head" }, h("h3", { text: ch.name }), h("p", { text: ch.desc })),
      log,
      h("div", { class: "composer" }, who, ta, sendBtn),
      h("div", { class: "composer-tip", text: "Enter 보내기 · Shift+Enter 줄바꿈 · /me 또는 *별표*로 감싸면 행동 묘사" }))
  ));
  draw();
  S.refresh = draw;
  S.viewUnsubs.push(onSnapshot(
    query(collection(db, "channels", ch.id, "messages"), orderBy("createdAt"), limitToLast(200)),
    (snap) => { msgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); draw(); },
    (e) => toast(errText(e))));
  if (activeChar() && window.matchMedia("(min-width: 861px)").matches) ta.focus();
}

/* ============================== 게시판 ============================== */
function viewBoard() {
  const list = h("div", { class: "board-list" }, h("p", { class: "loading", text: "게시물을 모으는 중…" }));
  let posts = [];
  function draw() {
    if (!posts.length) { list.replaceChildren(h("div", { class: "empty" }, h("strong", { text: "아직 게시물이 없습니다" }), "첫 소식을 붙여 보세요.")); return; }
    list.replaceChildren(
      h("div", { class: "board-head" }, h("span", { text: "제목" }), h("span", { class: "ha", text: "작성 인물" }), h("span", { class: "r", text: "댓글" }), h("span", { class: "r hd", text: "날짜" })),
      ...posts.map(p => {
        const c = S.chars[p.charId];
        const name = c ? c.name : (p.charName || "사라진 인물");
        return h("a", { class: "board-row", href: "#/board/" + p.id },
          h("span", { class: "t" }, p.title, h("small", { text: (p.body || "").slice(0, 80) })),
          h("span", { class: "a" }, avatar(c, 26, name), h("span", { text: name })),
          h("span", { class: "c", text: p.commentCount ? `${p.commentCount}개` : "—" }),
          h("span", { class: "d", text: fmtShort(toDate(p.lastActivityAt) || toDate(p.createdAt)) }));
      }));
  }
  mount(
    h("div", { class: "page-head" },
      h("div", null, h("span", { class: "kicker", text: "Notice Board" }), h("h2", null, "게시판", h("small", { text: "공지, 소문, 사건, 일지를 붙이는 벽" }))),
      S.myChars.length ? h("a", { class: "btn primary", href: "#/board/new", text: "새 글 쓰기" }) : null),
    S.myChars.length ? null : needChar(),
    list);
  S.refresh = draw;
  S.viewUnsubs.push(onSnapshot(query(collection(db, "posts"), orderBy("lastActivityAt", "desc"), limit(100)),
    (snap) => { posts = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); draw(); },
    (e) => list.replaceChildren(h("div", { class: "error", text: errText(e) }))));
}

function viewPost(postId) {
  const wrap = h("article", { class: "post" }, h("p", { class: "loading", text: "글을 펼치는 중…" }));
  let post = null, comments = [], gone = false;
  const ta = h("textarea", { class: "textarea", id: "comment-input", placeholder: "댓글을 남기세요", "aria-label": "댓글" });
  const btn = h("button", { class: "btn primary", type: "button", text: "댓글 달기" });
  const whoLine = h("p", { class: "muted", style: "margin:0 0 8px;font-size:.88rem" });

  async function addComment() {
    const me = activeChar(); const text = ta.value.trim();
    if (!me || !text) return;
    if (text.length > 3000) { toast("3,000자까지 쓸 수 있습니다."); return; }
    btn.disabled = true;
    try {
      const b = writeBatch(db);
      const cref = doc(collection(db, "posts", postId, "comments"));
      b.set(cref, { uid: uid(), charId: me.id, charName: me.name, text, createdAt: serverTimestamp() });
      b.update(doc(db, "posts", postId), { commentCount: increment(1), lastActivityAt: serverTimestamp() });
      await b.commit();
      ta.value = "";
      pushOut({ kind: "comment", post: postId, id: cref.id });
    } catch (e) { toast(errText(e)); }
    btn.disabled = false;
  }
  btn.addEventListener("click", addComment);

  function draw() {
    if (gone) { wrap.replaceChildren(h("div", { class: "empty" }, h("strong", { text: "글을 찾을 수 없습니다" }), h("a", { href: "#/board", text: "게시판으로" }))); return; }
    if (!post) return;
    const c = S.chars[post.charId];
    const name = c ? c.name : (post.charName || "사라진 인물");
    const mine = post.uid === uid();
    const me = activeChar();
    whoLine.textContent = me ? `${me.name}(으)로 작성합니다` : "";
    wrap.replaceChildren(
      h("a", { href: "#/board", class: "linkbtn", text: "← 게시판" }),
      h("h2", { class: "title", text: post.title }),
      h("div", { class: "byline" },
        avatar(c, 34, name),
        c ? h("a", { href: "#/people/" + c.id, text: name, style: "font-weight:700" }) : h("strong", { text: name }),
        h("span", { class: "muted", text: fmtDay(toDate(post.createdAt) || new Date()) + (post.editedAt ? " · 수정됨" : "") }),
        h("span", { class: "grow" }),
        mine ? h("a", { class: "btn small", href: "#/board/edit/" + post.id, text: "고치기" }) : null,
        (mine || isAdmin()) ? h("button", {
          class: "btn small", type: "button", text: "지우기",
          onclick: async () => { if (!confirm("이 글을 지울까요?")) return; try { await deleteDoc(doc(db, "posts", post.id)); location.hash = "#/board"; } catch (e) { toast(errText(e)); } }
        }) : null),
      h("div", { class: "prose", text: post.body }),
      h("section", { class: "comments" },
        h("h3", { text: `Comments · 댓글 ${comments.length}` }),
        comments.map(cm => {
          const cc = S.chars[cm.charId]; const cn = cc ? cc.name : (cm.charName || "사라진 인물");
          const cmine = cm.uid === uid();
          return h("div", { class: "comment" + (cmine ? " mine" : "") },
            avatar(cc, 34, cn),
            h("div", { class: "msg-body" },
              h("div", { class: "msg-meta" },
                cc ? h("a", { class: "msg-name", href: "#/people/" + cc.id, text: cn }) : h("span", { class: "msg-name", text: cn }),
                h("time", { class: "msg-time", text: fmtShort(toDate(cm.createdAt)) }),
                (cmine || isAdmin()) ? h("button", {
                  class: "linkbtn", type: "button", text: "지우기",
                  onclick: async () => {
                    if (!confirm("이 댓글을 지울까요?")) return;
                    try { const b = writeBatch(db); b.delete(doc(db, "posts", postId, "comments", cm.id)); b.update(doc(db, "posts", postId), { commentCount: increment(-1) }); await b.commit(); }
                    catch (e) { toast(errText(e)); }
                  }
                }) : null),
              h("p", { class: "msg-text", text: cm.text })));
        }),
        me ? h("div", { class: "comment-form", style: "margin-top:16px" }, whoLine, ta, h("div", { class: "actions", style: "margin-top:8px" }, btn)) : needChar()));
  }
  mount(wrap);
  S.refresh = draw;
  S.viewUnsubs.push(onSnapshot(doc(db, "posts", postId), (snap) => {
    if (!snap.exists()) { gone = true; draw(); return; }
    post = { id: snap.id, ...snap.data({ serverTimestamps: "estimate" }) }; draw();
  }, (e) => { wrap.replaceChildren(h("div", { class: "error", text: errText(e) })); }));
  S.viewUnsubs.push(onSnapshot(query(collection(db, "posts", postId, "comments"), orderBy("createdAt")), (snap) => {
    comments = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); draw();
  }, () => {}));
}

async function viewPostForm(postId) {
  const me = activeChar();
  if (!me) { mount(needChar()); return; }
  let existing = null;
  if (postId) {
    try { const s = await getDoc(doc(db, "posts", postId)); if (s.exists()) existing = s.data(); } catch (e) {}
    if (!existing || existing.uid !== uid()) { mount(h("div", { class: "error", text: "고칠 수 있는 글이 아닙니다." })); return; }
  }
  const err = h("div", { class: "error", hidden: true });
  const title = h("input", { class: "input", id: "post-title", maxlength: "120", required: true, value: existing ? existing.title : "" });
  const body = h("textarea", { class: "textarea", id: "post-body", maxlength: "10000", required: true, style: "min-height:320px", value: existing ? existing.body : "" });
  const btn = h("button", { class: "btn primary", type: "submit", text: existing ? "고친 내용 저장" : "게시하기" });
  mount(
    h("div", { class: "page-head" }, h("div", null, h("span", { class: "kicker", text: existing ? "Edit" : "New Post" }), h("h2", { text: existing ? "글 고치기" : "새 글" }))),
    h("form", {
      class: "post",
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const t = title.value.trim(), b = body.value.trim();
        if (!t || !b) { err.textContent = "제목과 본문을 모두 채워 주세요."; err.hidden = false; return; }
        btn.disabled = true;
        try {
          if (existing) { await updateDoc(doc(db, "posts", postId), { title: t, body: b, editedAt: serverTimestamp() }); location.hash = "#/board/" + postId; }
          else {
            const ref = await addDoc(collection(db, "posts"), {
              uid: uid(), charId: me.id, charName: me.name, title: t, body: b, commentCount: 0,
              createdAt: serverTimestamp(), lastActivityAt: serverTimestamp()
            });
            location.hash = "#/board/" + ref.id;
          }
        } catch (ex) { err.textContent = errText(ex); err.hidden = false; btn.disabled = false; }
      }
    },
      err,
      existing ? null : h("p", { class: "notice" }, h("strong", { text: me.name }), "(으)로 게시합니다. 다른 인물로 쓰려면 위의 ‘말하는 인물’을 바꾸세요."),
      h("div", { class: "field" }, h("label", { for: "post-title", text: "제목" }), title),
      h("div", { class: "field" }, h("label", { for: "post-body", text: "본문" }), body),
      h("div", { class: "actions" }, btn, h("a", { class: "btn", href: existing ? "#/board/" + postId : "#/board", text: "취소" }))));
  title.focus();
}

/* ============================== 쪽지 ============================== */
function convParts(convId) {
  const ids = (convId || "").split("__");
  if (ids.length !== 2) return null;
  const mineId = ids.find(id => S.chars[id] && S.chars[id].ownerUid === uid());
  if (!mineId) return null;
  const otherId = ids[0] === mineId ? ids[1] : ids[0];
  return { ids, mineId, otherId };
}
function convIdFor(a, b) { return [a, b].sort().join("__"); }

function viewMail(convId) {
  const box = h("section", { class: "mail" + (convId ? " has-thread" : "") });
  const listEl = h("nav", { class: "convs", "aria-label": "쪽지 목록" });
  const thread = h("div", { class: "room thread" });
  box.append(listEl, thread);

  function drawList() {
    const items = S.convs.map(c => {
      const p = convParts(c.id) || { otherId: (c.chars || []).find(x => !(S.chars[x] && S.chars[x].ownerUid === uid())) || (c.chars || [])[1], mineId: (c.chars || [])[0] };
      const other = S.chars[p.otherId]; const mineC = S.chars[p.mineId];
      const unread = isUnread(c);
      return h("a", { class: "conv" + (unread ? " unread" : ""), href: "#/mail/" + c.id, "aria-current": c.id === convId ? "page" : null },
        avatar(other, 40, other ? other.name : "?"),
        h("div", { class: "conv-main" },
          h("strong", null, h("span", { text: other ? other.name : "사라진 인물" }), h("time", { text: fmtShort(toDate(c.lastAt)) })),
          h("p", { class: "muted", text: (mineC ? `${mineC.name} · ` : "") + (c.lastSender === uid() ? "나: " : "") + (c.lastText || "") })),
        unread ? h("span", { class: "dot-new", "aria-label": "읽지 않음" }) : null);
    });
    listEl.replaceChildren(
      h("div", { class: "room-head" }, h("h3", { text: "쪽지함" }), h("a", { class: "btn small", href: "#/people", text: "새 쪽지" })),
      ...(items.length ? items : [h("div", { class: "empty", style: "margin:14px" }, h("strong", { text: "쪽지가 없습니다" }), "인물록에서 상대를 골라 첫 쪽지를 보내 보세요.")]));
  }

  let msgs = [], subbed = false, unsub = null;
  const log = h("div", { class: "log", role: "log", "aria-label": "쪽지 내용" });
  const ta = h("textarea", { id: "mail-input", rows: "1", placeholder: "쪽지 쓰기", "aria-label": "쪽지" });
  const sendBtn = h("button", { class: "btn primary", type: "button", text: "보내기" });

  function subscribe() {
    if (unsub) { unsub(); }
    unsub = onSnapshot(query(collection(db, "dms", convId, "messages"), orderBy("createdAt"), limitToLast(300)),
      (snap) => { subbed = true; msgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); drawThread(); markRead(); },
      () => { subbed = false; msgs = []; drawThread(); });
    S.viewUnsubs.push(() => unsub && unsub());
  }
  function markRead() {
    const c = S.convs.find(x => x.id === convId);
    if (!c || !isUnread(c) || S.marking.has(convId)) return;
    S.marking.add(convId);
    updateDoc(doc(db, "dms", convId), { ["readAt." + uid()]: serverTimestamp() })
      .catch(() => {}).finally(() => setTimeout(() => S.marking.delete(convId), 1500));
  }
  function drawThread() {
    if (!convId) {
      thread.replaceChildren(h("div", { class: "empty", style: "margin:auto" }, h("strong", { text: "쪽지를 고르세요" }), "왼쪽 목록에서 대화를 열 수 있습니다."));
      return;
    }
    const p = convParts(convId);
    if (!p) {
      thread.replaceChildren(h("div", { class: "empty", style: "margin:auto" }, h("strong", { text: "열 수 없는 쪽지입니다" }), "내 캐릭터가 포함된 대화만 열 수 있습니다."));
      return;
    }
    const mineC = S.chars[p.mineId], other = S.chars[p.otherId];
    if (!thread.contains(log)) {
      thread.replaceChildren(
        h("div", { class: "room-head" },
          h("a", { class: "btn small back", href: "#/mail", text: "← 목록" }),
          h("h3", null, other ? h("a", { href: "#/people/" + other.id, text: other.name, style: "text-decoration:none" }) : "사라진 인물"),
          h("p", { text: `${mineC.name}(으)로 주고받는 쪽지` })),
        log,
        h("div", { class: "composer" }, ta, sendBtn),
        h("div", { class: "composer-tip", text: "Enter 보내기 · Shift+Enter 줄바꿈 · 두 사람만 볼 수 있습니다" }));
    }
    const out = [];
    let prevDay = null;
    for (const m of msgs) {
      const d = toDate(m.createdAt) || new Date();
      if (d.toDateString() !== prevDay) { out.push(h("div", { class: "day", text: fmtDay(d) })); prevDay = d.toDateString(); }
      const mine = m.uid === uid();
      const c = S.chars[m.charId];
      out.push(h("div", { class: "letter" + (mine ? " mine" : "") },
        h("p", { class: "msg-text", text: m.text }),
        h("footer", { text: `${c ? c.name : "사라진 인물"} · ${fmtTime(d)}` })));
    }
    if (!out.length) out.push(h("div", { class: "empty", style: "margin:auto" }, h("strong", { text: other ? `${other.name}에게 보내는 첫 쪽지` : "첫 쪽지" }), `${mineC.name}의 이름으로 보냅니다.`));
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    log.replaceChildren(...out);
    if (nearBottom || log.dataset.first !== "0") { log.scrollTop = log.scrollHeight; log.dataset.first = "0"; }
    ta.disabled = sendBtn.disabled = !other;
    if (!other) ta.placeholder = "상대 인물이 사라져 보낼 수 없습니다";
  }
  async function send() {
    const p = convParts(convId); if (!p) return;
    const mineC = S.chars[p.mineId], other = S.chars[p.otherId];
    const text = ta.value.trim();
    if (!other || !text) return;
    if (text.length > 3000) { toast("3,000자까지 보낼 수 있습니다."); return; }
    const chars = [...p.ids].sort();
    const participants = chars.map(id => S.chars[id].ownerUid);
    ta.value = ""; autosize(ta); sendBtn.disabled = true;
    try {
      const b = writeBatch(db);
      b.set(doc(db, "dms", convId), {
        participants, chars, lastText: text.slice(0, 80), lastAt: serverTimestamp(), lastSender: uid(),
        readAt: { [uid()]: serverTimestamp() }
      }, { merge: true });
      b.set(doc(collection(db, "dms", convId, "messages")), { uid: uid(), charId: mineC.id, text, createdAt: serverTimestamp() });
      await b.commit();
      pushOut({ kind: "dm", id: convId });
      if (!subbed) subscribe();
    } catch (e) { toast(errText(e)); ta.value = text; autosize(ta); }
    sendBtn.disabled = false;
  }
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !isComposingKey(e)) { e.preventDefault(); send(); } });
  ta.addEventListener("input", () => autosize(ta));
  sendBtn.addEventListener("click", send);

  mount(h("div", { class: "page-head" }, h("div", null, h("span", { class: "kicker", text: "Letters" }), h("h2", null, "쪽지함", h("small", { text: "두 인물만 읽을 수 있는 편지" })))), box);
  drawList(); drawThread();
  S.refresh = () => { drawList(); if (convId) { drawThread(); markRead(); } };
  if (convId && convParts(convId)) subscribe();
}

/* ============================== 인물록 ============================== */
function viewPeople() {
  const grid = h("div", { class: "people" });
  const filter = h("select", { class: "select", id: "aff-filter", "aria-label": "소속으로 거르기", style: "width:auto" },
    h("option", { value: "", text: "모든 소속" }), AFFILIATIONS.map(a => h("option", { value: a, text: a })));
  const search = h("input", { class: "input", type: "search", id: "people-search", placeholder: "이름 찾기", "aria-label": "이름 찾기", style: "width:auto;min-width:0;flex:1" });
  function draw() {
    const q = search.value.trim().toLowerCase(), f = filter.value;
    const list = S.charList.filter(c => (!f || c.affiliation === f) && (!q || (c.name || "").toLowerCase().includes(q) || (c.nameEn || "").toLowerCase().includes(q)));
    grid.replaceChildren(...(list.length ? list.map(c => h("a", { class: "card", href: "#/people/" + c.id },
      avatar(c, null, c.name),
      h("div", null, h("h3", { text: c.name }), c.nameEn ? h("div", { class: "en", text: c.nameEn }) : null),
      c.affiliation ? h("span", { class: "tag" + (c.ownerUid === uid() ? " mine" : ""), text: c.affiliation }) : null,
      isNpc(c) ? h("span", { class: "tag npc", text: "NPC · 자동으로 말함" }) : null,
      c.quote ? h("p", { class: "quote", text: `“${c.quote}”` }) : null))
      : [h("div", { class: "empty", style: "grid-column:1/-1" }, h("strong", { text: S.charList.length ? "조건에 맞는 인물이 없습니다" : "아직 등록된 인물이 없습니다" }), S.charList.length ? "" : h("a", { href: "#/me/new", text: "첫 인물 등록하기 →" }))]));
  }
  filter.addEventListener("change", draw); search.addEventListener("input", draw);
  mount(
    h("div", { class: "page-head" },
      h("div", null, h("span", { class: "kicker", text: "Register" }), h("h2", null, "인물록", h("small", { text: `등록된 인물 ${S.charList.length}명` }))),
      h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;min-width:0" }, search, filter)),
    grid);
  draw(); S.refresh = draw;
}

function viewProfile(charId) {
  const wrap = h("div");
  function draw() {
    const c = S.chars[charId];
    if (!c) { wrap.replaceChildren(h("div", { class: "empty" }, h("strong", { text: "인물을 찾을 수 없습니다" }), h("a", { href: "#/people", text: "인물록으로" }))); return; }
    const mine = c.ownerUid === uid();
    const me = activeChar();
    const facts = [["소속", c.affiliation], ["나이·학년", c.age], ["성별", c.gender], ["외모", c.appearance], ["성격", c.personality], ["소개", c.bio]].filter(([, v]) => v);
    wrap.replaceChildren(
      h("a", { href: "#/people", class: "linkbtn", text: "← 인물록" }),
      h("div", { class: "profile", style: "margin-top:12px" },
        avatar(c, null, c.name),
        h("div", null,
          h("span", { class: "kicker", text: mine ? "My Character" : isNpc(c) ? "NPC" : "Character" }),
          h("h2", { text: c.name }),
          c.nameEn ? h("p", { class: "en", text: c.nameEn }) : null,
          c.quote ? h("blockquote", { text: `“${c.quote}”` }) : null,
          facts.length ? h("dl", { class: "facts" }, facts.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])) : h("p", { class: "muted", text: "아직 적힌 소개가 없습니다." }),
          h("div", { class: "actions" },
            mine ? [
              h("a", { class: "btn", href: "#/me/edit/" + c.id, text: "프로필 고치기" }),
              S.activeId === c.id ? h("span", { class: "tag mine", text: "지금 말하는 인물" }) :
                h("button", { class: "btn", type: "button", text: "이 인물로 말하기", onclick: () => { S.activeId = c.id; saveActive(c.id); drawWhoami(); toast(`${c.name}(으)로 말합니다.`); draw(); } })
            ] : isNpc(c) ? h("p", { class: "notice", style: "margin:0", text: `이 인물은 운영자가 정해 둔 NPC입니다. 채널이나 게시판에서 ‘${c.name.split(" ")[0]}’처럼 이름을 부르면 보통 10~20분 안에 대답하고, 가끔 스스로 말을 남기거나 게시판에 글을 올립니다.` })
            : (me
              ? [h("a", { class: "btn primary", href: "#/mail/" + convIdFor(me.id, c.id), text: `${me.name}(으)로 쪽지 보내기` }),
                 h("a", { class: "btn", href: "#/rooms/new/" + c.id, text: "둘만의 방 열기" })]
              : needChar()),
            isAdmin() && isNpc(c) ? npcAvatarControls(c) : null,
            isAdmin() && !mine ? h("button", {
              class: "btn", type: "button", text: "관리자 권한으로 삭제",
              onclick: async () => { if (!confirm(`${c.name} 프로필을 삭제할까요?`)) return; try { await deleteDoc(doc(db, "characters", c.id)); location.hash = "#/people"; } catch (e) { toast(errText(e)); } }
            }) : null))));
  }
  mount(wrap); draw(); S.refresh = draw;
}

/* 관리자: NPC 프로필 그림 바꾸기 (고르기 → 1:1 자르기 → 도트 여부 → 저장) */
function npcAvatarControls(c) {
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", async () => {
    const fl = file.files && file.files[0]; file.value = ""; if (!fl) return;
    const crop = await openCropper(fl); if (!crop) return;
    const dots = confirm("도트(흑백 점묘)로 바꿀까요?\n‘취소’를 누르면 흑백 사진 느낌으로 저장합니다.");
    try {
      const data = await processAvatar(fl, dots, crop);
      await updateDoc(doc(db, "characters", c.id), { avatar: data, updatedAt: serverTimestamp() });
      toast(`${c.name}의 그림을 바꿨습니다.`);
    } catch (e) { toast(e && e.code ? errText(e) : "그림을 저장하지 못했습니다."); }
  });
  return h("span", { class: "npc-avatar-tools", style: "display:contents" },
    file,
    h("button", { class: "btn", type: "button", text: c.avatar ? "NPC 그림 바꾸기" : "NPC 그림 넣기", onclick: () => file.click() }),
    c.avatar ? h("button", { class: "btn", type: "button", text: "그림 지우기", onclick: async () => {
      if (!confirm(`${c.name}의 그림을 지울까요?`)) return;
      try { await updateDoc(doc(db, "characters", c.id), { avatar: "", updatedAt: serverTimestamp() }); toast("그림을 지웠습니다."); } catch (e) { toast(errText(e)); }
    } }) : null);
}

/* ============================== 계정 ============================== */
function accountBox() {
  const err = h("div", { class: "error", hidden: true });
  const cur = h("input", { class: "input", type: "password", id: "pw-cur", autocomplete: "current-password" });
  const nw = h("input", { class: "input", type: "password", id: "pw-new", autocomplete: "new-password", minlength: "6" });
  const nw2 = h("input", { class: "input", type: "password", id: "pw-new2", autocomplete: "new-password" });
  const btn = h("button", { class: "btn", type: "submit", text: "비밀번호 바꾸기" });
  const form = h("form", {
    class: "account-form", hidden: true,
    onsubmit: async (e) => {
      e.preventDefault(); err.hidden = true;
      if (nw.value.length < 6) { err.textContent = "새 비밀번호는 6자 이상이어야 합니다."; err.hidden = false; return; }
      if (nw.value !== nw2.value) { err.textContent = "새 비밀번호 확인이 일치하지 않습니다."; err.hidden = false; return; }
      btn.disabled = true;
      try {
        await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(S.user.email, cur.value));
        await updatePassword(auth.currentUser, nw.value);
        cur.value = nw.value = nw2.value = ""; form.hidden = true; toast("비밀번호를 바꿨습니다.");
      } catch (ex) { err.textContent = ex.code === "auth/invalid-credential" || ex.code === "auth/wrong-password" ? "지금 비밀번호가 맞지 않습니다." : errText(ex); err.hidden = false; }
      btn.disabled = false;
    }
  },
    err,
    h("div", { class: "form-grid" },
      h("div", { class: "field" }, h("label", { for: "pw-cur", text: "지금 비밀번호" }), cur),
      h("div", { class: "field" }),
      h("div", { class: "field" }, h("label", { for: "pw-new", text: "새 비밀번호" }), nw, h("span", { class: "hint", text: "6자 이상" })),
      h("div", { class: "field" }, h("label", { for: "pw-new2", text: "새 비밀번호 확인" }), nw2)),
    h("div", { class: "actions", style: "margin-top:0" }, btn, h("button", { class: "btn", type: "button", text: "취소", onclick: () => { form.hidden = true; } })));
  return h("section", { class: "account" },
    h("h3", { class: "room-sec", text: "✠ 계정" }),
    h("div", { class: "account-row" },
      h("span", null, "아이디 ", h("strong", { text: emailToId(S.user.email) }), isAdmin() ? h("span", { class: "tag mine", style: "margin-left:8px", text: "관리자" }) : null),
      h("button", { class: "btn small", type: "button", text: "비밀번호 바꾸기", onclick: () => { form.hidden = !form.hidden; if (!form.hidden) cur.focus(); } })),
    form);
}
function resetsBox() {
  const list = h("div", { class: "muted", text: "불러오는 중…" });
  const unsub = onSnapshot(collection(db, "resets"), (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.replaceChildren(...(rows.length ? rows.map(r => h("div", { class: "account-row" },
      h("span", null, h("strong", { text: r.username }), " 임시 비밀번호 ", h("code", { class: "temp-pw", text: r.tempPassword })),
      h("button", { class: "btn small", type: "button", text: "전달했어요 · 지우기", onclick: async () => { try { await deleteDoc(doc(db, "resets", r.id)); } catch (e) { toast(errText(e)); } } })))
      : [h("span", { text: "초기화 요청이 없습니다." })]));
  }, () => list.replaceChildren(h("span", { text: "목록을 불러오지 못했습니다." })));
  S.viewUnsubs.push(unsub);
  return h("section", { class: "account" },
    h("h3", { class: "room-sec", text: "✠ 비밀번호 초기화 (관리자)" }),
    h("p", { class: "muted", style: "margin:0 0 8px;font-size:.88rem", text: "GitHub 저장소 Actions 탭의 ‘비밀번호 초기화’에서 아이디를 넣고 실행하면 여기에 임시 비밀번호가 나타납니다. 본인에게 전달한 뒤 지워 주세요." }),
    list);
}

/* ============================== 설정: 내 캐릭터 · 알림 · 계정 · 관리 ============================== */
const SETTINGS_TABS = [
  { id: "chars", name: "내 캐릭터" },
  { id: "notify", name: "알림" },
  { id: "account", name: "계정" },
  { id: "admin", name: "관리", admin: true }
];
function viewSettings(tab) {
  const tabs = SETTINGS_TABS.filter(t => !t.admin || isAdmin());
  if (!tabs.some(t => t.id === tab)) { location.replace("#/settings/chars"); return; }
  const bar = h("nav", { class: "subtabs", "aria-label": "설정 메뉴" },
    tabs.map(t => h("a", { href: "#/settings/" + t.id, "aria-current": t.id === tab ? "page" : null, text: t.name })));
  const head = h("div", { class: "page-head" },
    h("div", null, h("span", { class: "kicker", text: "Settings" }), h("h2", null, "설정", h("small", { text: "내 캐릭터, 알림, 계정을 한곳에서" }))),
    tab === "chars" && S.myChars.length < MAX_CHARS ? h("a", { class: "btn primary", href: "#/me/new", text: "새 캐릭터" }) : null);
  if (tab === "chars") return viewMyChars(head, bar);
  let body;
  if (tab === "notify") body = [notifyBox()];
  else if (tab === "account") body = [accountBox(),
    h("section", { class: "account" },
      h("h3", { class: "room-sec", text: "✠ 로그아웃" }),
      h("div", { class: "account-row" },
        h("span", { text: "이 기기에서 로그아웃합니다. 이 기기의 푸시 알림도 함께 꺼집니다." }),
        h("button", { class: "btn small", type: "button", text: "로그아웃", onclick: async () => { await disablePush(); signOut(auth); } })))];
  else body = [resetsBox()];
  mount(head, bar, h("div", { class: "settings-body" }, ...body));
}
function viewMyChars(head, bar) {
  const list = h("div", { class: "mychars" });
  function draw() {
    list.replaceChildren(...(S.myChars.length ? S.myChars.map(c => h("div", { class: "mychar" + (c.id === S.activeId ? " active" : "") },
      avatar(c, 64, c.name),
      h("div", { class: "grow" },
        h("h3", null, h("a", { href: "#/people/" + c.id, text: c.name, style: "text-decoration:none" })),
        h("div", { class: "muted", style: "font-size:.88rem", text: [c.nameEn, c.affiliation].filter(Boolean).join(" · ") }),
        c.id === S.activeId ? h("span", { class: "tag mine", style: "margin-top:6px;display:inline-block", text: "지금 말하는 인물" }) : null),
      h("div", { class: "actions", style: "margin:0" },
        c.id === S.activeId ? null : h("button", { class: "btn small", type: "button", text: "이 인물로 말하기", onclick: () => { S.activeId = c.id; saveActive(c.id); drawWhoami(); draw(); } }),
        h("a", { class: "btn small", href: "#/me/edit/" + c.id, text: "고치기" }),
        h("button", {
          class: "btn small", type: "button", text: "삭제",
          onclick: async () => { if (!confirm(`${c.name}을(를) 삭제할까요? 지금까지 남긴 대화는 이름만 남습니다.`)) return; try { await deleteDoc(doc(db, "characters", c.id)); toast("삭제했습니다."); } catch (e) { toast(errText(e)); } }
        }))))
      : [h("div", { class: "empty" }, h("strong", { text: "아직 캐릭터가 없습니다" }), "이 세계에서 쓸 인물을 만들어 보세요.")]));
  }
  mount(head, bar,
    h("p", { class: "muted settings-note", text: `한 계정에 ${MAX_CHARS}명까지 만들 수 있습니다. ‘이 인물로 말하기’를 누르면 채팅·댓글에 그 인물 이름으로 남습니다.` }),
    list);
  draw(); S.refresh = draw;
}

function viewCharForm(charId) {
  const ex = charId ? S.chars[charId] : null;
  if (charId && (!ex || ex.ownerUid !== uid())) { mount(h("div", { class: "error", text: "고칠 수 있는 인물이 아닙니다." })); return; }
  if (!ex && S.myChars.length >= MAX_CHARS) { mount(h("div", { class: "error", text: `캐릭터는 ${MAX_CHARS}명까지 만들 수 있습니다.` })); return; }
  const v = (k) => (ex && ex[k]) || "";
  const err = h("div", { class: "error", hidden: true });
  const f = {
    name: h("input", { class: "input", id: "c-name", maxlength: "40", required: true, value: v("name") }),
    nameEn: h("input", { class: "input", id: "c-en", maxlength: "60", value: v("nameEn"), placeholder: "예: Eleanor Pagan" }),
    affiliation: h("select", { class: "select", id: "c-aff" }, AFFILIATIONS.map(a => h("option", { value: a, text: a }))),
    age: h("input", { class: "input", id: "c-age", maxlength: "40", value: v("age"), placeholder: "예: 17세 · 6학년" }),
    gender: h("input", { class: "input", id: "c-gender", maxlength: "30", value: v("gender") }),
    quote: h("input", { class: "input", id: "c-quote", maxlength: "120", value: v("quote"), placeholder: "인물을 대표하는 한마디" }),
    appearance: h("textarea", { class: "textarea", id: "c-look", maxlength: "1500", value: v("appearance") }),
    personality: h("textarea", { class: "textarea", id: "c-pers", maxlength: "1500", value: v("personality") }),
    bio: h("textarea", { class: "textarea", id: "c-bio", maxlength: "4000", style: "min-height:200px", value: v("bio") })
  };
  f.affiliation.value = v("affiliation") || AFFILIATIONS[0];
  let avatarData = ex ? (ex.avatar || "") : "";
  const preview = h("span");
  const dither = h("input", { type: "checkbox", id: "c-dither", checked: true });
  const file = h("input", { type: "file", id: "c-file", accept: "image/*", class: "input" });
  function drawPreview() { preview.replaceChildren(avatar({ name: f.name.value, avatar: avatarData }, 112, f.name.value)); }
  let srcFile = null, srcCrop = null;            // 고른 그림과 자른 위치 (도트 켜고 끌 때 다시 쓰려고 기억)
  const recrop = h("button", { class: "linkbtn", type: "button", text: "다시 자르기", hidden: true, style: "align-self:flex-start", onclick: () => pickCrop() });
  async function render() {
    if (!srcFile) return;
    try { avatarData = await processAvatar(srcFile, dither.checked, srcCrop); drawPreview(); }
    catch (e) { toast("이미지를 읽지 못했습니다."); }
  }
  async function pickCrop() {
    if (!srcFile) return;
    const c = await openCropper(srcFile);
    if (!c) return;                               // 취소하면 그대로
    srcCrop = c; recrop.hidden = false; render();
  }
  file.addEventListener("change", async () => {
    const fl = file.files && file.files[0]; if (!fl) return;
    const c = await openCropper(fl);
    file.value = "";                              // 같은 그림을 다시 골라도 열리게
    if (!c) return;
    srcFile = fl; srcCrop = c; recrop.hidden = false; render();
  });
  dither.addEventListener("change", render);
  const btn = h("button", { class: "btn primary", type: "submit", text: ex ? "저장" : "인물 등록" });

  mount(
    h("div", { class: "page-head" }, h("div", null, h("span", { class: "kicker", text: ex ? "Edit Profile" : "New Character" }), h("h2", { text: ex ? `${ex.name} 고치기` : "새 캐릭터" }))),
    h("form", {
      style: "max-width:820px",
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const data = {
          name: f.name.value.trim(), nameEn: f.nameEn.value.trim(), affiliation: f.affiliation.value,
          age: f.age.value.trim(), gender: f.gender.value.trim(), quote: f.quote.value.trim(),
          appearance: f.appearance.value.trim(), personality: f.personality.value.trim(), bio: f.bio.value.trim(),
          avatar: avatarData, ownerUid: uid(), updatedAt: serverTimestamp()
        };
        if (!data.name) { err.textContent = "이름을 적어 주세요."; err.hidden = false; return; }
        btn.disabled = true;
        try {
          if (ex) { await updateDoc(doc(db, "characters", ex.id), data); location.hash = "#/people/" + ex.id; }
          else {
            const ref = await addDoc(collection(db, "characters"), { ...data, createdAt: serverTimestamp() });
            if (!S.activeId) { S.activeId = ref.id; saveActive(ref.id); }
            location.hash = "#/people/" + ref.id;
          }
        } catch (ex2) { err.textContent = errText(ex2); err.hidden = false; btn.disabled = false; }
      }
    },
      err,
      h("div", { class: "field" },
        h("label", { for: "c-file", text: "프로필 그림" }),
        h("div", { class: "avatar-edit" }, preview,
          h("div", { style: "display:flex;flex-direction:column;gap:8px;min-width:0;flex:1" }, file, recrop,
            h("label", { class: "check", for: "c-dither" }, dither, "도트(흑백 점묘)로 바꾸기"),
            avatarData ? h("button", { class: "linkbtn", type: "button", text: "그림 지우기", style: "align-self:flex-start", onclick: () => { avatarData = ""; drawPreview(); } }) : null)),
        h("span", { class: "hint", text: "그림을 고르면 정사각형으로 자를 곳을 정할 수 있습니다. 작게 줄여 저장됩니다." })),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "c-name", text: "이름 *" }), f.name),
        h("div", { class: "field" }, h("label", { for: "c-en", text: "영문 이름" }), f.nameEn),
        h("div", { class: "field" }, h("label", { for: "c-aff", text: "소속" }), f.affiliation),
        h("div", { class: "field" }, h("label", { for: "c-age", text: "나이 · 학년" }), f.age),
        h("div", { class: "field" }, h("label", { for: "c-gender", text: "성별" }), f.gender),
        h("div", { class: "field" }, h("label", { for: "c-quote", text: "대표 대사" }), f.quote),
        h("div", { class: "field wide" }, h("label", { for: "c-look", text: "외모" }), f.appearance),
        h("div", { class: "field wide" }, h("label", { for: "c-pers", text: "성격" }), f.personality),
        h("div", { class: "field wide" }, h("label", { for: "c-bio", text: "소개 · 배경" }), f.bio, h("span", { class: "hint", text: "4,000자까지" }))),
      h("div", { class: "actions" }, btn, h("a", { class: "btn", href: ex ? "#/people/" + ex.id : "#/settings/chars", text: "취소" }))));
  f.name.addEventListener("input", drawPreview);
  drawPreview();
}

/* ============================== 둘만의 방 ============================== */
function roomMine(r) {
  const owned = (r.chars || []).filter(id => S.chars[id] && S.chars[id].ownerUid === uid());
  if (!owned.length) return null;
  return owned.includes(S.activeId) ? S.activeId : owned[0];
}
function roomOther(r, mineId) { return (r.chars || []).find(id => id !== mineId) || mineId; }

function viewRooms() {
  const list = h("div", { class: "room-list" });
  function row(r) {
    const mineId = roomMine(r), otherId = roomOther(r, mineId);
    const a = S.chars[mineId], b = S.chars[otherId];
    const unread = !r.closed && isUnread(r);
    return h("a", { class: "room-row" + (r.closed ? " closed" : ""), href: "#/rooms/" + r.id },
      h("span", { class: "room-pair" }, avatar(a, 34, a ? a.name : "?"), avatar(b, 34, b ? b.name : "?")),
      h("span", { class: "room-main" },
        h("strong", { text: r.place }),
        h("span", { class: "muted", text: `${a ? a.name : "사라진 인물"} · ${b ? b.name : "사라진 인물"}` }),
        h("span", { class: "room-last", text: r.lastText ? (r.lastSender === uid() ? "나: " : "") + r.lastText : (r.note || "아직 아무 말도 없습니다") })),
      h("time", { class: "msg-time", text: fmtShort(toDate(r.lastAt)) }),
      unread ? h("span", { class: "dot-new", "aria-label": "읽지 않음" }) : null);
  }
  function draw() {
    const open = S.rooms.filter(r => !r.closed), closed = S.rooms.filter(r => r.closed);
    list.replaceChildren(
      ...(open.length ? open.map(row) : [h("div", { class: "empty" }, h("strong", { text: "열린 방이 없습니다" }), "인물록에서 상대를 골라 ‘둘만의 방 열기’를 누르면 장소를 정해 방을 만들 수 있습니다.")]),
      closed.length ? h("h3", { class: "room-sec", text: "✠ 닫힌 방" }) : null,
      ...closed.map(row));
  }
  mount(
    h("div", { class: "page-head" },
      h("div", null, h("span", { class: "kicker", text: "Private Rooms" }), h("h2", null, "둘만의 방", h("small", { text: "두 인물만 들어올 수 있는 장소. 실시간으로 이야기합니다" }))),
      h("a", { class: "btn primary", href: "#/people", text: "새 방 열기" })),
    list);
  draw(); S.refresh = draw;
}

function viewRoomForm(otherId) {
  const me = activeChar(), other = S.chars[otherId];
  if (!me) { mount(needChar()); return; }
  if (!other || isNpc(other) || other.id === me.id) { mount(h("div", { class: "error", text: "이 인물과는 방을 열 수 없습니다." })); return; }
  const err = h("div", { class: "error", hidden: true });
  const place = h("select", { class: "select", id: "room-place" }, ROOM_PLACES.map(p => h("option", { value: p, text: p })), h("option", { value: "__custom", text: "직접 입력…" }));
  const custom = h("input", { class: "input", id: "room-custom", maxlength: "60", placeholder: "예: 시계탑 꼭대기 기계실", hidden: true });
  place.addEventListener("change", () => { custom.hidden = place.value !== "__custom"; if (!custom.hidden) custom.focus(); });
  const note = h("textarea", { class: "textarea", id: "room-note", maxlength: "500", placeholder: "예: 소등 시간이 지난 밤. 비가 그친 직후." });
  const btn = h("button", { class: "btn primary", type: "submit", text: "방 열기" });
  mount(
    h("div", { class: "page-head" }, h("div", null, h("span", { class: "kicker", text: "New Room" }), h("h2", { text: "둘만의 방 열기" }))),
    h("form", {
      style: "max-width:640px",
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const pl = place.value === "__custom" ? custom.value.trim() : place.value;
        if (!pl) { err.textContent = "장소를 정해 주세요."; err.hidden = false; return; }
        btn.disabled = true;
        try {
          const ref = await addDoc(collection(db, "rooms"), {
            participants: [uid(), other.ownerUid], chars: [me.id, other.id], place: pl, note: note.value.trim(),
            createdBy: uid(), createdAt: serverTimestamp(), lastAt: serverTimestamp(), lastText: "", lastSender: uid(),
            readAt: { [uid()]: serverTimestamp() }, closed: false
          });
          location.hash = "#/rooms/" + ref.id;
        } catch (ex) { err.textContent = errText(ex); err.hidden = false; btn.disabled = false; }
      }
    },
      err,
      h("div", { class: "room-who" }, avatar(me, 48, me.name), h("strong", { text: me.name }), h("span", { class: "muted", text: "와(과)" }), avatar(other, 48, other.name), h("strong", { text: other.name })),
      h("div", { class: "field" }, h("label", { for: "room-place", text: "장소" }), place, custom),
      h("div", { class: "field" }, h("label", { for: "room-note", text: "상황 메모" }), note, h("span", { class: "hint", text: "방 위쪽에 늘 보이는 장면 설명입니다. 500자까지." })),
      h("p", { class: "muted", style: "font-size:.88rem" }, "이 방은 두 사람만 볼 수 있고, 상대의 ‘둘만의 방’ 목록에 바로 나타납니다."),
      h("div", { class: "actions" }, btn, h("a", { class: "btn", href: "#/people/" + other.id, text: "취소" }))));
}

function viewRoom(roomId) {
  const log = h("div", { class: "log", role: "log", "aria-live": "polite", "aria-label": "방 대화" });
  const ta = h("textarea", { id: "room-input", rows: "1", "aria-label": "메시지" });
  const sendBtn = h("button", { class: "btn primary", type: "button", text: "보내기" });
  const who = h("div", { class: "who" });
  const head = h("div", { class: "room-head scene" });
  const foot = h("div");
  const box = h("section", { class: "chat solo" }, h("div", { class: "room" }, head, log, foot));
  let room = null, msgs = [], gone = false;
  const logState = { first: true };

  function markRead() {
    if (!room || room.closed || !isUnread(room) || S.marking.has(roomId)) return;
    S.marking.add(roomId);
    updateDoc(doc(db, "rooms", roomId), { ["readAt." + uid()]: serverTimestamp() })
      .catch(() => {}).finally(() => setTimeout(() => S.marking.delete(roomId), 1500));
  }
  function draw() {
    if (gone) { box.replaceWith(h("div", { class: "empty" }, h("strong", { text: "들어갈 수 없는 방입니다" }), h("a", { href: "#/rooms", text: "둘만의 방 목록으로" }))); return; }
    if (!room) return;
    const mineId = roomMine(room), otherId = roomOther(room, mineId);
    const me = S.chars[mineId], other = S.chars[otherId];
    head.replaceChildren(
      h("a", { class: "btn small", href: "#/rooms", text: "← 목록" }),
      h("div", { class: "scene-main" },
        h("h3", { text: room.place }),
        h("p", { class: "scene-pair", text: `${me ? me.name : "사라진 인물"} · ${other ? other.name : "사라진 인물"}` }),
        room.note ? h("p", { class: "scene-note", text: room.note }) : null),
      room.closed ? h("span", { class: "tag", text: "닫힌 방" }) : h("button", {
        class: "btn small", type: "button", text: "방 닫기",
        onclick: async () => { if (!confirm("방을 닫을까요? 닫으면 더 이상 말할 수 없고 기록만 남습니다.")) return; try { await updateDoc(doc(db, "rooms", roomId), { closed: true }); } catch (e) { toast(errText(e)); } }
      }));
    who.title = me ? me.name + "(으)로 말합니다" : ""; who.replaceChildren(avatar(me, 36, me ? me.name : "?"), h("span", { text: me ? me.name : "" }));
    if (room.closed) foot.replaceChildren(h("div", { class: "composer-tip", style: "padding:12px", text: "닫힌 방입니다. 기록만 볼 수 있습니다." }));
    else if (!foot.contains(ta)) foot.replaceChildren(h("div", { class: "composer" }, who, ta, sendBtn), h("div", { class: "composer-tip", text: "Enter 보내기 · Shift+Enter 줄바꿈 · /me 또는 *별표*로 행동 묘사 · 두 사람만 볼 수 있습니다" }));
    ta.placeholder = `${room.place}에서 말하기`;
    renderLog(log, msgs, logState, {
      delRef: (m) => doc(db, "rooms", roomId, "messages", m.id), readOnly: room.closed,
      emptyTitle: "둘만 남았습니다", emptyText: "먼저 말을 꺼내 보세요."
    });
  }
  async function send() {
    if (!room || room.closed) return;
    const mineId = roomMine(room); const me = S.chars[mineId];
    let text = ta.value.trim();
    if (!me || !text) return;
    const parsed = parseAction(text); const kind = parsed.kind; text = parsed.text;
    if (!text) return;
    if (text.length > 2000) { toast("2,000자까지 보낼 수 있습니다."); return; }
    ta.value = ""; autosize(ta);
    try {
      const b = writeBatch(db);
      b.set(doc(collection(db, "rooms", roomId, "messages")), { uid: uid(), charId: me.id, charName: me.name, text, kind, createdAt: serverTimestamp() });
      b.update(doc(db, "rooms", roomId), { lastText: (kind === "action" ? "*" + text + "*" : text).slice(0, 80), lastAt: serverTimestamp(), lastSender: uid(), ["readAt." + uid()]: serverTimestamp() });
      await b.commit();
      pushOut({ kind: "room", id: roomId });
    } catch (e) { toast(errText(e)); ta.value = text; autosize(ta); }
  }
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !isComposingKey(e)) { e.preventDefault(); send(); } });
  ta.addEventListener("input", () => autosize(ta));
  sendBtn.addEventListener("click", send);

  mount(box);
  S.refresh = () => { draw(); markRead(); };
  S.viewUnsubs.push(onSnapshot(doc(db, "rooms", roomId), (snap) => {
    if (!snap.exists()) { gone = true; draw(); return; }
    room = { id: snap.id, ...snap.data({ serverTimestamps: "estimate" }) }; draw(); markRead();
  }, () => { gone = true; draw(); }));
  S.viewUnsubs.push(onSnapshot(query(collection(db, "rooms", roomId, "messages"), orderBy("createdAt"), limitToLast(300)),
    (snap) => { msgs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); draw(); markRead(); },
    () => {}));
}

/* 프로필 그림: 정사각형으로 자르고 흑백(또는 1비트 도트)으로 줄여 저장 */
/* ---------- 1:1 자르기 창: 끌어서 옮기고, 막대·휠·두 손가락으로 확대 ---------- */
function openCropper(fileObj) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fileObj);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); toast("이미지를 읽지 못했습니다."); resolve(null); };
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const stage = h("div", { class: "crop-stage", tabindex: "0", "aria-label": "자를 곳. 끌어서 옮기고, 아래 막대로 확대합니다. 화살표 키로도 옮길 수 있습니다." });
      const pic = h("img", { class: "crop-img", src: url, alt: "", draggable: "false" });
      stage.append(pic, h("span", { class: "crop-grid", "aria-hidden": "true" }));
      const zoom = h("input", { type: "range", min: "1", max: "4", step: "0.01", value: "1", class: "crop-zoom", "aria-label": "확대" });
      let V = 0, base = 1, z = 1, x = 0, y = 0;
      const scale = () => base * z;
      function clamp() {
        const sw = W * scale(), sh = H * scale();
        x = Math.min(0, Math.max(V - sw, x)); y = Math.min(0, Math.max(V - sh, y));
      }
      function draw() { clamp(); pic.style.width = W * scale() + "px"; pic.style.height = H * scale() + "px"; pic.style.transform = `translate(${x}px, ${y}px)`; }
      function layout() {
        const old = V ? { cx: (V / 2 - x) / scale(), cy: (V / 2 - y) / scale() } : null;
        V = stage.clientWidth; base = V / Math.min(W, H);
        if (old) { x = V / 2 - old.cx * scale(); y = V / 2 - old.cy * scale(); }
        else { x = (V - W * scale()) / 2; y = (V - H * scale()) / 2; }
        draw();
      }
      function setZoom(nz, ax = V / 2, ay = V / 2) {   // ax, ay: 이 점을 중심으로 확대
        nz = Math.max(1, Math.min(4, nz));
        const ix = (ax - x) / scale(), iy = (ay - y) / scale();
        z = nz; x = ax - ix * scale(); y = ay - iy * scale();
        zoom.value = String(z); draw();
      }
      zoom.addEventListener("input", () => setZoom(parseFloat(zoom.value)));
      const pts = new Map(); let last = null;
      stage.addEventListener("pointerdown", (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = null; stage.classList.add("dragging"); });
      stage.addEventListener("pointermove", (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) { x += e.clientX - prev.x; y += e.clientY - prev.y; draw(); return; }
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), r = stage.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
        if (last) { x += mx - last.mx; y += my - last.my; setZoom(z * d / last.d, mx, my); }
        last = { d, mx, my };
      });
      const up = (e) => { pts.delete(e.pointerId); last = null; if (!pts.size) stage.classList.remove("dragging"); };
      stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
      stage.addEventListener("wheel", (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); setZoom(z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      stage.addEventListener("keydown", (e) => {
        const k = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
        if (k) { e.preventDefault(); x += k[0]; y += k[1]; draw(); }
        else if (e.key === "+" || e.key === "=") setZoom(z * 1.1);
        else if (e.key === "-") setZoom(z / 1.1);
      });
      function close(result) {
        window.removeEventListener("resize", layout); document.removeEventListener("keydown", onKey, true);
        overlay.remove(); URL.revokeObjectURL(url); resolve(result);
      }
      function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(null); } else if (e.key === "Enter" && e.target !== zoom) { e.preventDefault(); done(); } }
      function done() { const sc = scale(); close({ sx: -x / sc, sy: -y / sc, s: V / sc }); }
      const overlay = h("div", { class: "crop-overlay", role: "dialog", "aria-modal": "true", "aria-label": "프로필 그림 자르기" },
        h("div", { class: "crop-panel" },
          h("h3", { class: "room-sec", text: "✠ 정사각형으로 자르기" }),
          stage,
          h("div", { class: "crop-row" }, h("span", { class: "muted", text: "작게" }), zoom, h("span", { class: "muted", text: "크게" })),
          h("p", { class: "muted crop-help", text: "끌어서 옮기고, 막대나 두 손가락으로 크기를 맞추세요." }),
          h("div", { class: "actions", style: "margin:0;justify-content:flex-end" },
            h("button", { class: "btn", type: "button", text: "취소", onclick: () => close(null) }),
            h("button", { class: "btn primary", type: "button", text: "이대로 자르기", onclick: done }))));
      overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(null); });
      document.body.append(overlay);
      window.addEventListener("resize", layout); document.addEventListener("keydown", onKey, true);
      requestAnimationFrame(() => { layout(); stage.focus(); });
    };
    img.src = url;
  });
}

function processAvatar(fileObj, dots, crop) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileObj);
    const img = new Image();
    img.onload = () => {
      try {
        const N = dots ? 192 : 240;
        const cv = document.createElement("canvas"); cv.width = N; cv.height = N;
        const cx = cv.getContext("2d");
        const s0 = Math.min(img.width, img.height);
        const c = crop && crop.s > 0 ? crop : { sx: (img.width - s0) / 2, sy: (img.height - s0) / 2, s: s0 };
        cx.fillStyle = "#f3f2ed"; cx.fillRect(0, 0, N, N);
        cx.drawImage(img, c.sx, c.sy, c.s, c.s, 0, 0, N, N);
        const id = cx.getImageData(0, 0, N, N), px = id.data;
        const g = new Float32Array(N * N);
        let lo = 255, hi = 0;
        for (let i = 0; i < N * N; i++) { const v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; g[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
        const span = Math.max(1, hi - lo);
        for (let i = 0; i < N * N; i++) g[i] = (g[i] - lo) * 255 / span;
        if (dots) {
          const add = (x, y, e) => { if (x >= 0 && x < N && y < N) g[y * N + x] += e; };
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const i = y * N + x, old = g[i], nw = old < 128 ? 0 : 255, e = (old - nw) / 8;
            g[i] = nw; add(x + 1, y, e); add(x + 2, y, e); add(x - 1, y + 1, e); add(x, y + 1, e); add(x + 1, y + 1, e); add(x, y + 2, e);
          }
        }
        for (let i = 0; i < N * N; i++) {
          const on = g[i] >= 128;
          const v = dots ? null : Math.max(0, Math.min(255, g[i]));
          px[i * 4] = dots ? (on ? 0xf3 : 0x14) : v; px[i * 4 + 1] = dots ? (on ? 0xf2 : 0x14) : v; px[i * 4 + 2] = dots ? (on ? 0xed : 0x14) : v; px[i * 4 + 3] = 255;
        }
        cx.putImageData(id, 0, 0);
        resolve(dots ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.82));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}

/* 휴대폰: 옆으로 미는 메뉴에서 지금 탭이 화면 안에 보이게 */
function showCurrentTab() {
  const strip = document.getElementById("nav-links"), x = strip && strip.querySelector("a[aria-current]");
  if (!x || strip.scrollWidth <= strip.clientWidth) return;
  const l = x.offsetLeft, r = l + x.offsetWidth;
  if (l < strip.scrollLeft || r > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: Math.max(0, l - 24), behavior: "smooth" });
}
/* 휴대폰 메뉴: 끝까지 밀면 오른쪽 흐림 표시를 없앰 */
(function () {
  const strip = document.getElementById("nav-links"); if (!strip) return;
  const upd = () => strip.classList.toggle("at-end", strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2);
  strip.addEventListener("scroll", upd, { passive: true }); window.addEventListener("resize", upd); setTimeout(upd, 300);
})();
