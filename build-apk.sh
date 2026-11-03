#!/usr/bin/env bash
# 킬렐러 우체국 — 안드로이드 앱(APK) 만들기
# GitHub Actions의 '안드로이드 앱 만들기'가 이 파일을 실행합니다. 직접 실행할 필요는 없습니다.
# 앱은 사이트(GitHub Pages)를 그대로 보여 주는 껍데기라서, 사이트를 고치면 앱을 다시 만들지 않아도 바로 반영됩니다.
set -euo pipefail

ROOT="$(pwd)"
OUT="$ROOT/android-build"
PKG="post.kilrelagh.app"
PKG_DIR="post/kilrelagh/app"

# 사이트 주소: 저장소 이름에서 자동으로 만듭니다 (SITE_URL을 넣으면 그 주소를 씁니다)
OWNER="$(echo "${GITHUB_REPOSITORY_OWNER:-lastsummerdream}" | tr '[:upper:]' '[:lower:]')"
FULL="${GITHUB_REPOSITORY:-lastsummerdream/kilrelagh-post}"; REPO="${FULL#*/}"
if [ "$(echo "$REPO" | tr '[:upper:]' '[:lower:]')" = "$OWNER.github.io" ]; then DEF_URL="https://$OWNER.github.io/"; else DEF_URL="https://$OWNER.github.io/$REPO/"; fi
SITE_URL="${SITE_URL:-$DEF_URL}"
SITE_HOST="$(echo "$SITE_URL" | sed -E 's#^https?://([^/]+).*#\1#')"
VERSION_CODE="${VERSION_CODE:-1}"
echo "사이트 주소: $SITE_URL  (버전 $VERSION_CODE)"

rm -rf "$OUT"
mkdir -p "$OUT/app/src/main/java/$PKG_DIR" \
         "$OUT/app/src/main/res/values" \
         "$OUT/app/src/main/res/drawable" \
         "$OUT/app/src/main/res/mipmap-xxxhdpi" \
         "$OUT/app/src/main/res/mipmap-anydpi-v26"

# ---------- 서명 열쇠 ----------
KS="$OUT/release.p12"
KS_PASS="kilrelagh-post"
KS_OK=0
if [ -n "${ANDROID_KEYSTORE:-}" ]; then
  # 붙여 넣을 때 섞인 공백·줄바꿈·따옴표 같은 것은 걸러 냄
  CLEAN="$(printf '%s' "$ANDROID_KEYSTORE" | tr -cd 'A-Za-z0-9+/=')"
  if printf '%s' "$CLEAN" | base64 -d > "$KS" 2>/dev/null \
     && keytool -list -keystore "$KS" -storetype PKCS12 -storepass "$KS_PASS" -alias kilrelagh >/dev/null 2>&1; then
    KS_OK=1; echo "저장해 둔 서명 열쇠(ANDROID_KEYSTORE)로 서명합니다."
  else
    echo "::warning::ANDROID_KEYSTORE 값이 올바르지 않습니다 (글자 수 ${#CLEAN}자, 정상은 3,456자 안팎). ANDROID_KEYSTORE.txt를 메모장으로 열어 Ctrl+A로 전부 복사해 Secret을 다시 넣어 주세요. 이번에는 임시 열쇠로 만듭니다."
  fi
fi
if [ "$KS_OK" != 1 ]; then
  rm -f "$KS"
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias kilrelagh -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kilrelagh Post" >/dev/null 2>&1
  [ -z "${ANDROID_KEYSTORE:-}" ] && echo "::warning::Secrets에 ANDROID_KEYSTORE가 없어 이번만 쓰는 임시 열쇠로 서명했습니다."
  echo "::warning::임시 열쇠로 만든 앱은 나중에 정식 열쇠로 만든 앱과 서로 덮어 설치되지 않습니다 (그때는 지우고 다시 설치)."
fi

# ---------- 푸시 알림 (Secrets의 GOOGLE_SERVICES_JSON이 있을 때만) ----------
PUSH=0
if [ -n "${GOOGLE_SERVICES_JSON:-}" ]; then
  printf '%s' "$GOOGLE_SERVICES_JSON" > "$OUT/app/google-services.json"
  if grep -q "\"package_name\": *\"$PKG\"" "$OUT/app/google-services.json"; then
    PUSH=1; echo "푸시 알림을 넣어 만듭니다."
  else
    echo "::error::GOOGLE_SERVICES_JSON 안에 패키지 이름 $PKG 가 없습니다. Firebase에 안드로이드 앱을 등록할 때 패키지 이름을 $PKG 로 넣었는지 확인하고, 그때 받은 google-services.json 내용을 다시 넣어 주세요."
    exit 1
  fi
else
  echo "::notice::GOOGLE_SERVICES_JSON이 없어 푸시 알림 없이 만듭니다 (앱이 열려 있을 때만 알림)."
fi

# ---------- 아이콘 ----------
cp "$ROOT/icon-192.png"      "$OUT/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"
cp "$ROOT/icon-maskable.png" "$OUT/app/src/main/res/mipmap-xxxhdpi/ic_launcher_fg.png"

# ---------- Gradle 설정 ----------
cat > "$OUT/settings.gradle" <<'EOF'
pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories { google(); mavenCentral() }
}
rootProject.name = "KilrelaghPost"
include ':app'
EOF

if [ "$PUSH" = 1 ]; then
  GMS_ROOT="id 'com.google.gms.google-services' version '4.4.2' apply false"
  GMS_APP="id 'com.google.gms.google-services'"
  GMS_DEP="dependencies { implementation 'com.google.firebase:firebase-messaging:24.0.0' }"
else
  GMS_ROOT=""; GMS_APP=""; GMS_DEP=""
fi

cat > "$OUT/build.gradle" <<EOF
plugins {
  id 'com.android.application' version '8.5.2' apply false
  $GMS_ROOT
}
EOF

cat > "$OUT/gradle.properties" <<'EOF'
org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
android.nonTransitiveRClass=true
android.useAndroidX=true
EOF

echo "sdk.dir=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}" > "$OUT/local.properties"

cat > "$OUT/app/build.gradle" <<EOF
plugins {
  id 'com.android.application'
  $GMS_APP
}
android {
  namespace '$PKG'
  compileSdk 34
  defaultConfig {
    applicationId '$PKG'
    minSdk 24
    targetSdk 34
    versionCode $VERSION_CODE
    versionName '1.$VERSION_CODE'
  }
  signingConfigs {
    release {
      storeFile file('$KS')
      storePassword '$KS_PASS'
      keyAlias 'kilrelagh'
      keyPassword '$KS_PASS'
      storeType 'pkcs12'
    }
  }
  buildTypes {
    release { minifyEnabled false; signingConfig signingConfigs.release }
  }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  lint { checkReleaseBuilds false; abortOnError false }
}
tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }
$GMS_DEP
EOF

# ---------- 앱 정보 ----------
if [ "$PUSH" = 1 ]; then
  PUSH_SERVICE='<service android:name=".PushService" android:exported="false"><intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter></service>'
else
  PUSH_SERVICE=""
fi
cat > "$OUT/app/src/main/AndroidManifest.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <application
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher"
      android:theme="@style/AppTheme"
      android:allowBackup="true"
      android:usesCleartextTraffic="false">
    <activity
        android:name=".MainActivity"
        android:exported="true"
        android:launchMode="singleTask"
        android:screenOrientation="portrait"
        android:windowSoftInputMode="adjustResize"
        android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboard|keyboardHidden|navigation|uiMode|density|fontScale">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    $PUSH_SERVICE
  </application>
</manifest>
EOF

cat > "$OUT/app/src/main/res/values/strings.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">킬렐러 우체국</string>
</resources>
EOF

cat > "$OUT/app/src/main/res/values/colors.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ink">#141414</color>
  <color name="paper">#F3F2ED</color>
  <color name="green">#1D4A36</color>
</resources>
EOF

cat > "$OUT/app/src/main/res/values/styles.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="AppTheme" parent="android:Theme.Material.Light.NoActionBar">
    <item name="android:statusBarColor">@color/ink</item>
    <item name="android:navigationBarColor">@color/ink</item>
    <item name="android:windowBackground">@color/paper</item>
    <item name="android:colorAccent">@color/green</item>
  </style>
</resources>
EOF

cat > "$OUT/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/paper" />
  <foreground android:drawable="@mipmap/ic_launcher_fg" />
</adaptive-icon>
EOF

# 알림 막대에 뜨는 작은 아이콘 (봉투)
cat > "$OUT/app/src/main/res/drawable/ic_stat_post.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:strokeColor="#FFFFFFFF" android:strokeWidth="2" android:fillColor="#00000000"
      android:strokeLineJoin="round"
      android:pathData="M3,5.5h18v13H3z M3.5,6l8.5,7l8.5,-7" />
</vector>
EOF

# ---------- 앱 본체 ----------
J="$OUT/app/src/main/java/$PKG_DIR"

# 알림 보여 주기 (앱 안의 사이트가 부를 때, 푸시가 왔을 때 둘 다 여기로)
cat > "$J/Notify.java" <<'EOF'
package post.kilrelagh.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public class Notify {
  static final String CHANNEL = "messages";

  static void channel(Context c) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationChannel ch = new NotificationChannel(CHANNEL, "쪽지와 대화", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("새 쪽지, 둘만의 방, 이름이 불린 말, 내 글의 댓글");
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    if (nm != null) nm.createNotificationChannel(ch);
  }

  static boolean allowed(Context c) {
    if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    return nm != null && nm.areNotificationsEnabled();
  }

  static void show(Context c, String title, String body, String hash) {
    if (!allowed(c)) return;
    channel(c);
    String h = (hash != null && hash.startsWith("#/") && hash.length() < 200) ? hash : "#/chat/square";
    Intent open = new Intent(c, MainActivity.class)
      .putExtra("hash", h).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pi = PendingIntent.getActivity(c, h.hashCode(), open,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
    String t = title == null ? "킬렐러 우체국" : title, m = body == null ? "" : body;
    b.setSmallIcon(R.drawable.ic_stat_post)
      .setColor(0xFF1D4A36)
      .setContentTitle(t)
      .setContentText(m)
      .setStyle(new Notification.BigTextStyle().bigText(m))
      .setAutoCancel(true)
      .setContentIntent(pi);
    if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    if (nm != null) nm.notify(h.hashCode(), b.build());
  }
}
EOF

if [ "$PUSH" = 1 ]; then
cat > "$J/Push.java" <<'EOF'
package post.kilrelagh.app;

import com.google.firebase.messaging.FirebaseMessaging;

public class Push {
  static final boolean ENABLED = true;
  static void init(MainActivity a) {
    try {
      FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
        if (task.isSuccessful() && task.getResult() != null) a.onPushToken(task.getResult());
      });
    } catch (Exception e) { }
  }
}
EOF
cat > "$J/PushService.java" <<'EOF'
package post.kilrelagh.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class PushService extends FirebaseMessagingService {
  @Override public void onNewToken(String token) {
    getSharedPreferences("kp", MODE_PRIVATE).edit().putString("pushToken", token).apply();
    MainActivity a = MainActivity.current;
    if (a != null) a.runOnUiThread(() -> a.onPushToken(token));
  }

  @Override public void onMessageReceived(RemoteMessage msg) {
    Map<String, String> d = msg.getData();
    if (d == null || d.isEmpty()) return;
    if (MainActivity.foreground) return;   // 앱을 보고 있으면 화면 안의 안내 띠가 알려 줌
    Notify.show(this, d.get("title"), d.get("body"), d.get("hash"));
  }
}
EOF
else
cat > "$J/Push.java" <<'EOF'
package post.kilrelagh.app;

public class Push {
  static final boolean ENABLED = false;
  static void init(MainActivity a) { }
}
EOF
fi

cat > "$J/MainActivity.java" <<'EOF'
package post.kilrelagh.app;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;

public class MainActivity extends Activity {
  static final String HOME = "__SITE_URL__";
  static final String HOST = "__SITE_HOST__";
  static final int FILE_REQ = 7, PERM_REQ = 9;
  static volatile MainActivity current;
  static volatile boolean foreground;

  WebView web;
  ValueCallback<Uri[]> fileCb;
  SharedPreferences prefs;

  @Override protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    current = this;
    prefs = getSharedPreferences("kp", MODE_PRIVATE);
    Notify.channel(this);

    web = new WebView(this);
    web.setBackgroundColor(0xFFF3F2ED);
    setContentView(web);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);   // 배경음악이 바로 나오게
    s.setAllowFileAccess(false);
    s.setTextZoom(100);                              // 휴대폰 글자 크기 설정과 관계없이 사이트 디자인 그대로
    s.setUserAgentString(s.getUserAgentString() + " KilrelaghPostApp/1");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
    web.addJavascriptInterface(new Bridge(), "KilrelaghApp");

    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
        Uri u = req.getUrl();
        if ("https".equals(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
        return true;   // 바깥 링크는 휴대폰 브라우저로
      }
      @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
        if (!req.isForMainFrame()) return;
        String page = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
          + "<body style='margin:0;background:#f3f2ed;color:#141414;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
          + "<div><p style='font-size:20px;font-weight:bold'>우체국에 닿지 않습니다</p>"
          + "<p style='font-size:15px'>인터넷 연결을 확인해 주세요.</p>"
          + "<button onclick=\"location.href='" + HOME + "'\" style='margin-top:12px;font-size:16px;padding:10px 22px;background:#1d4a36;color:#f3f2ed;border:0'>다시 시도</button></div>";
        v.loadDataWithBaseURL(null, page, "text/html", "utf-8", null);
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
        if (fileCb != null) fileCb.onReceiveValue(null);
        fileCb = cb;
        try { startActivityForResult(params.createIntent(), FILE_REQ); }
        catch (Exception e) { fileCb = null; return false; }
        return true;
      }
    });

    String hash = hashFrom(getIntent());
    if (saved != null && web.restoreState(saved) != null) {
      if (hash != null) goHash(hash);
    } else {
      web.loadUrl(HOME + (hash != null ? hash : ""));
    }
    Push.init(this);
  }

  // 푸시 주소(토큰)를 받으면 저장해 두고 사이트에 알려 줌 → 사이트가 Firestore에 등록
  void onPushToken(String token) {
    prefs.edit().putString("pushToken", token).apply();
    if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('kp-push-token'));", null);
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    String hash = hashFrom(intent);
    if (hash != null) goHash(hash);
  }

  static String hashFrom(Intent i) {
    if (i == null) return null;
    String h = i.getStringExtra("hash");
    return (h != null && h.startsWith("#/") && h.length() < 200) ? h : null;
  }

  void goHash(String hash) {
    web.evaluateJavascript("location.hash=" + JSONObject.quote(hash) + ";", null);
  }

  // 사이트에 '지금 앱이 안 보이는 중/다시 보이는 중'을 알려 줌 (음악 멈춤·알림 판단용)
  void tellPage(boolean hidden) {
    if (web == null) return;
    web.evaluateJavascript("window.__kpAppHidden=" + hidden + ";window.dispatchEvent(new Event('"
      + (hidden ? "kp-app-hidden" : "kp-app-visible") + "'));", null);
  }

  @Override protected void onPause() { super.onPause(); foreground = false; tellPage(true); }
  @Override protected void onResume() {
    super.onResume(); foreground = true; tellPage(false);
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm != null) nm.cancelAll();
  }
  @Override protected void onDestroy() { if (current == this) current = null; super.onDestroy(); }

  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

  @Override public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }

  @Override protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (req == FILE_REQ && fileCb != null) {
      fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
      fileCb = null;
    }
  }

  @Override public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
    super.onRequestPermissionsResult(req, perms, results);
    if (req == PERM_REQ) web.evaluateJavascript("window.dispatchEvent(new Event('kp-notify-perm'));", null);
  }

  String permissionState() {
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      return prefs.getBoolean("asked", false) ? "denied" : "default";
    }
    return Notify.allowed(this) ? "granted" : "denied";
  }

  class Bridge {
    @JavascriptInterface public String permission() { return permissionState(); }

    @JavascriptInterface public String pushToken() { return Push.ENABLED ? prefs.getString("pushToken", "") : ""; }

    @JavascriptInterface public void requestPermission() {
      runOnUiThread(() -> {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
          prefs.edit().putBoolean("asked", true).apply();
          requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, PERM_REQ);
        } else {
          web.evaluateJavascript("window.dispatchEvent(new Event('kp-notify-perm'));", null);
        }
      });
    }

    @JavascriptInterface public void show(String title, String body, String hash) {
      Notify.show(MainActivity.this, title, body, hash);
    }
  }
}
EOF
sed -i "s#__SITE_URL__#$SITE_URL#; s#__SITE_HOST__#$SITE_HOST#" "$J/MainActivity.java"

# ---------- 만들기 ----------
cd "$OUT"
gradle --no-daemon --stacktrace assembleRelease
cp "$OUT/app/build/outputs/apk/release/app-release.apk" "$ROOT/kilrelagh-post.apk"
ls -la "$ROOT/kilrelagh-post.apk"
echo "완성: kilrelagh-post.apk"
