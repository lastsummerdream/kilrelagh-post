// 킬렐러 우체국 — 비밀번호 초기화 (GitHub Actions에서 관리자가 실행)
// 아이디를 받아 임시 비밀번호로 바꾸고, 그 비밀번호를 관리자만 볼 수 있는 곳(사이트의 '내 캐릭터' 화면 아래)에 남깁니다.
// 임시 비밀번호는 실행 기록(로그)에 찍히지 않습니다. 공개 저장소라도 다른 사람이 볼 수 없습니다.
import { randomInt } from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const ID_DOMAIN = "users.kilrelagh.post";
const username = (process.env.RESET_USERNAME || "").trim().toLowerCase();
if (!/^[a-z0-9_]{3,20}$/.test(username)) { console.error("아이디 형식이 맞지 않습니다: 영문 소문자, 숫자, 밑줄(_) 3~20자"); process.exit(1); }
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.error("Secrets에 FIREBASE_SERVICE_ACCOUNT를 넣어 주세요."); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const auth = getAuth();
const db = getFirestore();

let user;
try { user = await auth.getUserByEmail(`${username}@${ID_DOMAIN}`); }
catch { console.error(`'${username}' 아이디를 찾을 수 없습니다.`); process.exit(1); }

// 헷갈리는 글자(0/o, 1/l 등)를 뺀 10자리 임시 비밀번호
const ABC = "abcdefghjkmnpqrstuvwxyz23456789";
const temp = Array.from({ length: 10 }, () => ABC[randomInt(ABC.length)]).join("");
await auth.updateUser(user.uid, { password: temp });
await db.doc(`resets/${user.uid}`).set({ username, tempPassword: temp, createdAt: FieldValue.serverTimestamp() });
console.log(`'${username}'의 비밀번호를 초기화했습니다. 임시 비밀번호는 사이트의 '내 캐릭터' 화면 맨 아래(관리자만 보임)에서 확인하세요.`);
