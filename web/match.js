// match.js
console.log("[MATCH] match.js loaded");

import {
  API_BASE,
  joinQueue,
  pollMatch,
  getToken,
  postHeartbeat,
  finalizeMatch,
  readMatchCtx,
  writeMatchCtx,
  clearMatchCtx,
  sendPauseBeacon,
} from "./api.js";
import { createRtc } from "./rtc.js";
import { startGame } from "./game.js";

const API_BASE = "https://multimodalpd-9qz7.onrender.com";

let matching = false;       // 二重起動防止
let matchTimer = null;      // setInterval のハンドル
let heartbeatTimer = null;
const HEARTBEAT_MS = 5000;

let queueUserId = null;

function getParticipantId() {
  let pid =
    (window.__PD__ && (window.__PD__.participantId || window.__PD__.responseId)) ||
    localStorage.getItem("pd_player_id");

  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem("pd_player_id", pid);
  }
  return String(pid);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(ctx) {
  stopHeartbeat();
  const tick = async () => {
    try {
      const latest = readMatchCtx() || ctx;
      if (!latest?.participantId || !latest?.resumeToken || !latest?.channel) return;
      await postHeartbeat(latest);
    } catch (e) {
      console.warn("[MATCH] heartbeat failed", e);
    }
  };
  tick();
  heartbeatTimer = setInterval(tick, HEARTBEAT_MS);
}

function softPause() {
  try {
    const ctx = readMatchCtx();
    if (ctx?.participantId && ctx?.resumeToken) {
      sendPauseBeacon(ctx);
    }
  } catch (e) {
    console.warn("[MATCH] softPause failed", e);
  } finally {
    stopHeartbeat();
  }
}

window.__PD_SOFT_PAUSE__ = softPause;
window.addEventListener("pagehide", softPause, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    softPause();
    return;
  }
  const ctx = readMatchCtx();
  if (ctx?.channel) startHeartbeat(ctx);
});

window.__PD_CANCEL_MATCH__ = async () => {
  try {
    if (matchTimer) { clearInterval(matchTimer); matchTimer = null; }
    const ctx = readMatchCtx();
    if (ctx && !ctx.channel) {
      await finalizeMatch({ ...ctx, reason: "cancel_waiting" });
      clearMatchCtx();
      queueUserId = null;
    }
  } catch (e) {
    console.warn("[MATCH] cancel failed", e);
  }
};

export async function enterFlow(APP_ID, useToken = true) {
  console.log("[MATCH] enterFlow called with APP_ID=", APP_ID);
  if (matching) return;
  matching = true;

  const rtc = createRtc(APP_ID);
  let channel;
  let ctx = readMatchCtx();

  if (!ctx?.participantId) {
    ctx = {
      participantId: getParticipantId(),
      resumeToken: null,
      channel: null,
    };
  }

  // 1) /join
  const reg = await joinQueue({
    participantId: ctx.participantId,
    resumeToken: ctx.resumeToken,
  });

  ctx = writeMatchCtx({
    participantId: reg.participantId || ctx.participantId,
    resumeToken: reg.resumeToken || ctx.resumeToken,
    channel: reg.channel || null,
  });

  if (reg.status === "paired") {
    channel = reg.channel;
    ctx = writeMatchCtx({ ...ctx, channel });
    console.log("[MATCH] paired immediately:", channel);
  } else {
    queueUserId = ctx.participantId;
    console.log("[MATCH] waiting. participantId=", ctx.participantId);

    // 2) /match をポーリング
    await new Promise((resolve) => {
      matchTimer = setInterval(async () => {
        try {
          const m = await pollMatch(ctx);
          console.log("[MATCH] poll =>", m);
          if (m && m.status === "paired" && m.channel) {
            channel = m.channel;
            ctx = writeMatchCtx({
              participantId: m.participantId || ctx.participantId,
              resumeToken: m.resumeToken || ctx.resumeToken,
              channel,
            });
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

  const { token } = await getToken(channel, uid, ctx);
  await rtc.join(channel, token, uid);
  console.log("[RTC] joined", { channel, uid });

  ctx = writeMatchCtx({ ...ctx, channel });
  window.__PD_MATCH_CTX__ = { ...ctx, uid };
  startHeartbeat(ctx);

  // QualtricsのEmbedded Dataにチャンネル名を保存（任意）
  if (window.Qualtrics && Qualtrics.SurveyEngine) {
    Qualtrics.SurveyEngine.setEmbeddedData("pd_channel", String(channel));
  }

  // 4) ゲーム開始
  startGame(channel, rtc, {
    participantId: ctx.participantId,
    resumeToken: ctx.resumeToken,
  });
  matching = false;

  let leaving = false;

  // 明示的な最終離脱（緊急離脱 / ゲーム終了）用
  window.__PD_LEAVE__ = async (reason = "user_exit") => {

    if (leaving) return;
    leaving = true;

    stopHeartbeat();

    const latest = readMatchCtx() || ctx;

    try {
      await finalizeMatch({ ...latest, reason });
    } catch (e) {
      console.warn("[MATCH] finalizeMatch error", e);
    }

    try {
      await rtc.leave();
    } catch (e) {
      console.warn("[MATCH] rtc.leave error", e);
    }
    
    clearMatchCtx();
    window.__PD_MATCH_CTX__ = null;
  };
}

// ===== 自動起動ブロック =====

// Qualtrics側で window.AGORA_APP_ID にIDを入れておく想定。
// index.html テストでは index.html 内の <script> でセットする。
const DEFAULT_APP_ID = "YOUR_AGORA_APP_ID"; // テスト用、あとで実IDに置き換え or window側だけで設定でもOK
const appIdFromWindow =
  (typeof window !== "undefined" && window.AGORA_APP_ID) || DEFAULT_APP_ID;

// 自動起動を止めたい場合は window.__PD_DISABLE_AUTO_START__ = true を先に立てる
if (typeof window !== "undefined" && !window.__PD_DISABLE_AUTO_START__) {
  console.log("[MATCH] auto-start enterFlow with", appIdFromWindow);
  enterFlow(appIdFromWindow);
}
