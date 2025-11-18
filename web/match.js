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

  // 3) Agora join（トークン有りに統一）
  const uid = 0;
  const { token } = await getToken(channel, uid);
  await rtc.join(channel, token, uid);
  console.log("[RTC] joined", { channel, uid });

  // 4) ゲーム開始
  startGame(channel);
  matching = false;
}