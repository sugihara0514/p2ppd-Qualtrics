// match.js
import { joinQueue, pollMatch, getToken } from "./api.js";
import { createRtc } from "./rtc.js";
import { startGame } from "./game.js";

let matching = false;       // 二重起動防止
let matchTimer = null;      // setInterval のハンドル

export async function enterFlow(APP_ID, useToken=true) {
  if (matching) return;
  matching = true;

  const rtc = createRtc(APP_ID);
  let channel;

  // 1) /join
  const reg = await joinQueue(); // {status:"paired", channel} or {status:"waiting", userId}
  if (reg.status === "paired") {
    channel = reg.channel;
    console.log("[MATCH] paired immediately:", channel);
  } else {
    const userId = reg.userId;
    console.log("[MATCH] waiting. userId=", userId);

    // 2) /match を 1本だけ回す
    await new Promise((resolve) => {
      matchTimer = setInterval(async () => {
        try {
          const m = await pollMatch(userId);
          console.log("[MATCH] poll =>", m);
          if (m && m.status === "paired" && m.channel) {
            channel = m.channel;
            clearInterval(matchTimer);
            matchTimer = null;
            resolve();
          }
        } catch (e) {
          console.warn("[MATCH] poll error", e);
        }
      }, 1500);
    });
  }

  // 3) Agora join
  // QualtricsのResponseIDを優先してハッシュ化、なければ乱数
  const rid = (window.__PD__ && window.__PD__.responseId) || "";
  const uid = rid
    ? Array.from(rid).reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 1315423911) >>> 0
    : Math.floor(Math.random() * 1e9);

  const { token } = await getToken(channel, uid);
  await rtc.join(channel, token, uid);
  console.log("[RTC] joined", { channel, uid });

  // QualtricsのEmbedded Dataにチャンネル名を保存（任意）
  if (window.Qualtrics && Qualtrics.SurveyEngine) {
    Qualtrics.SurveyEngine.setEmbeddedData("pd_channel", String(channel));
  }

  // 4) ゲーム開始
  startGame(channel);
  matching = false;

  // ページ離脱時にleaveできるようにフック（Qualtrics側のonUnloadから呼ぶ用）
  window.__PD_LEAVE__ = rtc.leave;

  // Qualtrics側で window.AGORA_APP_ID にIDを入れておく想定。
  // 無ければデフォルト値を使う。
  const DEFAULT_APP_ID = "YOUR_AGORA_APP_ID"; // ←仮でハードコードでもOK
  const appIdFromWindow =
    (typeof window !== "undefined" && window.AGORA_APP_ID) || DEFAULT_APP_ID;

  // 自動起動を止めたい場合は window.__PD_DISABLE_AUTO_START__ = true を先に立てる
  if (typeof window !== "undefined" && !window.__PD_DISABLE_AUTO_START__) {
    enterFlow(appIdFromWindow);
  }
}