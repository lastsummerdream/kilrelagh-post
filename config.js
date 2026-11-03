// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹 앱)에 나오는 firebaseConfig 값을 그대로 붙여 넣으세요.
// 이 값들은 공개되어도 괜찮은 식별자입니다. 실제 보호는 firestore.rules(보안 규칙)가 맡습니다.
export const firebaseConfig = {
  apiKey: "AIzaSyA4797mp-qVQLA80M_N8jaXeElzYlPsfDA",
  authDomain: "the-kilrelagh-post.firebaseapp.com",
  projectId: "the-kilrelagh-post",
  storageBucket: "the-kilrelagh-post.firebasestorage.app",
  messagingSenderId: "772073932998",
  appId: "1:772073932998:web:ecb7da19a97bea31772fc7",
  measurementId: "G-428K48433H"
};

// 푸시 알림 — 호스팅 안내 12단계 ①의 '웹 푸시 키'와 ③의 '중계소 주소'를 따옴표 안에 넣으세요.
// 아직 없으면 비워 두어도 사이트는 그대로 동작합니다 (푸시만 꺼진 상태).
export const pushConfig = {
  vapidKey: "BPuBwzZywbHNW04Mpgu1Td0GBkginysyTQkXxh_5havvM9HNVrycROoXUGUch8ILiLp-HTJH8PUoNBDk019sKxc",
  relay: "https://kilrelagh-push.bucksve.workers.dev/"
};
