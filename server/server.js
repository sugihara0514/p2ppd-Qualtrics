// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuid } from "uuid";
import pkg from "agora-access-token";
const { RtcTokenBuilder, RtcRole } = pkg;

const MAX_ROUNDS = 5; // 本番は20

// QualtricsのURLを許可する
const allowedOrigin = [
  "https://survey.syd1.qualtrics.com", 
  "https://multimodalpd-static-65p9.onrender.com",
];
const corsOptions = {
  origin: allowedOrigin,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  optionsSuccessStatus: 204, // プリフライトに 204 を返す
};

dotenv.config();
const app = express();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

const APP_ID = process.env.AGORA_APP_ID;
const CERT   = process.env.AGORA_APP_CERT;
const TTL    = Number(process.env.TOKEN_TTL_SEC || 3600);

// ===== Cloud Recording  =====
const AGORA_CUSTOMER_ID     = process.env.AGORA_CUSTOMER_ID;
const AGORA_CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET;

// Basic 認証ヘッダ作成
function agoraAuthHeader() {
  const base = Buffer.from(
    `${AGORA_CUSTOMER_ID}:${AGORA_CUSTOMER_SECRET}`
  ).toString("base64");
  return `Basic ${base}`;
}

// channel を fileNamePrefix 用に安全な形（英数字のみ）にする
function safePrefixSegment(channel) {
  const cleaned = String(channel).replace(/[^a-zA-Z0-9]/g, "");
  // もし全部消えて空になったら保険で "room" にする
  return cleaned || "room";
}

// 保存先ストレージ設定（Supabase Storage を S3互換で使う想定）
function buildStorageConfig(channel) {
  const vendor = Number(process.env.AGORA_STORAGE_VENDOR || 11); // 11 = S3互換
  const region = Number(process.env.AGORA_STORAGE_REGION || 10);
  const bucket = process.env.AGORA_STORAGE_BUCKET;
  const accessKey = process.env.AGORA_STORAGE_ACCESS_KEY;
  const secretKey = process.env.AGORA_STORAGE_SECRET_KEY;
  const endpoint  = process.env.AGORA_STORAGE_ENDPOINT; // Supabase の S3 endpoint

  const safeSegment = safePrefixSegment(channel);
  
  const cfg = {
    vendor,
    region,
    bucket,
    accessKey,
    secretKey,
    // バケット内のパス: pd/<channel>/...
    fileNamePrefix: ["pd", safeSegment], //supabaseのpdフォルダに録画を保存
  };
  if (endpoint) {
    cfg.extensionParams = { endpoint };
  }
  return cfg;
}

// Cloud Recording のセッション情報を保持（簡易: メモリ）
const recordings = new Map(); // channel -> { resourceId, sid, uid }

// 録画用 UID（通常の参加者と被らない値）
const RECORD_UID = Number(process.env.AGORA_RECORD_UID || 9999);

// Cloud Recording 開始ヘルパー
async function startCloudRecording(channel) {
  try {
    if (recordings.has(channel)) {
      return recordings.get(channel);
    }

    // 1) acquire
    const acquireResp = await fetch(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/acquire`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          Authorization: agoraAuthHeader(),
        },
        body: JSON.stringify({
          cname: channel,
          uid: String(RECORD_UID),
          clientRequest: {
            resourceExpiredHour: 24,
            scene: 0,
          },
        }),
      }
    );
    const acquireData = await acquireResp.json();
    if (!acquireResp.ok) {
      console.error("[recording] acquire failed", acquireData);
      return null;
    }
    const resourceId = acquireData.resourceId;

    // 録画クライアント用トークン（CERT がない場合は省略）
    let recToken = undefined;
    if (CERT) {
      const role = RtcRole.PUBLISHER;
      const expire = Math.floor(Date.now() / 1000) + TTL;
      recToken = RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        CERT,
        channel,
        RECORD_UID,
        role,
        expire
      );
    }

    const storageConfig = buildStorageConfig(channel);

    // 2) start
    const clientRequest = {
      recordingConfig: {
        channelType: 0,  // 0: 通話
        streamTypes: 2,  // 2: audio + video
        videoStreamType: 0,
        maxIdleTime: 30,

      // 左右1:1の横長レイアウト
      transcodingConfig: {
        width: 1280,    // 出力mp4の解像度（横長）
        height: 720,
        fps: 30,
        bitrate: 2800,  // 必要に応じて調整

      // 3 = カスタムレイアウト（layoutConfigを使う）
      mixedVideoLayout: 3,

      // 2人を左右に均等配置
      layoutConfig: [
        {
          // 左の人
          // uidを省略すると「映像を送ってきた順」に割当てられる
          x_axis: 0.0,
          y_axis: 0.0,
          width: 0.5,    // 画面左半分
          height: 1.0,   // 全高さ
          alpha: 1.0,
          // 1 = Fit（黒帯出てもいいから切り取りを減らす）
          render_mode: 1,
        },
        {
          // 右の人
          x_axis: 0.5,
          y_axis: 0.0,
          width: 0.5,    // 画面右半分
          height: 1.0,
          alpha: 1.0,
          render_mode: 1,
        },
      ],
    },
  },

  // HLS + MP4
  recordingFileConfig: {
    avFileType: ["hls", "mp4"],
  },

  storageConfig,
};

if (recToken) clientRequest.token = recToken;


    const startResp = await fetch(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          Authorization: agoraAuthHeader(),
        },
        body: JSON.stringify({
          cname: channel,
          uid: String(RECORD_UID),
          clientRequest,
        }),
      }
    );
    const startData = await startResp.json();
    if (!startResp.ok) {
      console.error("[recording] start failed", startData);
      return null;
    }

    const { sid } = startData;
    const info = { resourceId, sid, uid: RECORD_UID };
    recordings.set(channel, info);
    console.log("[recording] started", channel, info);
    return info;
  } catch (err) {
    console.error("[recording] start error", err);
    return null;
  }
}

// Cloud Recording 停止ヘルパー
async function stopCloudRecording(channel) {
  try {
    const info = recordings.get(channel);
    if (!info) return;

    recordings.delete(channel);

    const { resourceId, sid, uid } = info;
    const stopResp = await fetch(
      `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          Authorization: agoraAuthHeader(),
        },
        body: JSON.stringify({
          cname: channel,
          uid: String(uid),
          clientRequest: {},
        }),
      }
    );
    const stopData = await stopResp.json();
    if (!stopResp.ok) {
      console.error("[recording] stop failed", stopData);
    } else {
      console.log("[recording] stopped", channel, stopData);
      console.log("[recording] uploadingStatus", stopData?.serverResponse?.uploadingStatus);
      console.log("[recording] fileList", JSON.stringify(stopData?.serverResponse?.fileList, null, 2));
    }
  } catch (err) {
    console.error("[recording] stop error", err);
  }
}

// --- 待機と部屋管理 ---
const queue = []; // [{id, at}]
const rooms = new Map(); // channel -> { users:[id1,id2] }
const userToChannel = new Map(); // userId -> channel

// 60秒以上の古い待機は除去
const now = Date.now();
while (queue.length && now - queue[0].at > 60 * 15 * 1000) queue.shift();

app.post("/join", (req, res) => {
  const userId = uuid();

  // 古い待機者を掃除（任意）
  while (queue.length && Date.now() - queue[0].at > 60 * 15 * 1000) queue.shift();

  const waiting = queue.shift(); // 誰か待機している？
  if (waiting) {
    const a = waiting.id;
    const b = userId;
    const channel = `room-${uuid()}`;
    rooms.set(channel, { users: [a, b] });
    userToChannel.set(a, channel);
    userToChannel.set(b, channel);
    return res.json({ status: "paired", channel, userId });
  }

  // 誰もいなければ自分を待機に
  queue.push({ id: userId, at: Date.now() });
  res.json({ status: "waiting", userId });
});

app.get("/match", (req, res) => {
  const userId = String(req.query.userId || "");
  const channel = userToChannel.get(userId);

  if (channel) {
    return res.json({ status: "paired", channel });
  }
  return res.json({ status: "waiting" });
});

// --- Agora Token（本番用） ---
app.get("/rtc/token", (req, res) => {
  const channel = (req.query.channel || "").trim();
  const uid     = Number(req.query.uid ?? 0);
  if (!channel) return res.status(400).json({ error: "channel required" });

  const role = RtcRole.PUBLISHER;
  const expire = Math.floor(Date.now()/1000) + TTL;
  const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, CERT, channel, uid, role, expire);
  res.json({ appId: APP_ID, channel, uid, token, expire });
});

app.get("/", (req, res) => res.send("pd-api ok"));
app.get("/healthz", (req, res) => res.json({ ok: true }));


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));

// --- 囚人のジレンマ ---
const PAYOFF = { CC:[2,2], CD:[0,3], DC:[3,0], DD:[1,1] };
const games = new Map();

// ゲーム参加（channel と client側で作った playerId を紐づけ）
app.post("/game/join", async (req, res) => {
  const { channel, playerId } = req.body || {};
  if (!channel || !playerId) return res.status(400).json({ error: "channel and playerId required" });

  if (!games.has(channel)) {
    games.set(channel, {
      round: 1,
      players: new Set(),
      stage: "waiting",          // 初期wating、その後emotion、choice
      ready: new Set(),          // baseline完了した人
      predictions: new Map(),    // playerId -> predictionValue
      choices: new Map(),        // playerId -> "C" | "D"
      emotions: new Map(),       // playerId -> { emo1, emo2, emo3, ・・・ }
      totals: new Map(),
      lastResult: null,
      over: false,
    });
  }
  const g = games.get(channel);
  g.players.add(String(playerId));
  if (!g.totals.has(String(playerId))) g.totals.set(String(playerId), 0);

  // プレイヤーが2人揃ったら録画開始（既に開始済みなら内部でなにもしない）
  // 一時録画停止中!
  if (g.players.size >= 2) {
    startCloudRecording(channel); // await してもいいが、レスポンスを遅らせたくないなら fire-and-forget でOK
  }

  return res.json({
    ok: true,
    round: g.round,
    players: Array.from(g.players),
    totals: Object.fromEntries(g.totals.entries()),
    over: g.over,
    lastResult: g.lastResult
  });
});

// 録画を外部から明示的に止めるAPI
app.post("/record/stop", async (req, res) => {
  const { channel } = req.body || {};
  if (!channel) {
    return res.status(400).json({ error: "channel required" });
  }
  await stopCloudRecording(channel);  // 既に録画終了済みなら何もしない実装にしておく
  return res.json({ ok: true });
});

// 相手の選択予測をサーバに送信
app.post("/game/predict", (req, res) => {
  const { channel, playerId, round, prediction } = req.body || {};
  if (!channel || !playerId || prediction == null) {
    return res.status(400).json({
      error: "missing_fields",
      need: ["channel","playerId","round","prediction"],
      got: req.body
    });
  }
  const g = games.get(channel);
  if (!g) return res.status(400).json({ error: "game_not_found", channel });
  if (g.over) return res.status(400).json({ error: "game_over" });

  // 予測フェーズ以外なら一応受けるが、ステージは変えない
  if (!g.stage) g.stage = "predict";

  // プレイヤー登録漏れ対策
  g.players.add(String(playerId));
  if (!g.totals.has(String(playerId))) g.totals.set(String(playerId), 0);

  const rNow = g.round;
  if (Number(round) !== rNow) {
    console.warn("[PREDICT] round mismatch: client=", round, "server=", rNow);
  }

  g.predictions.set(String(playerId), Number(prediction));

  // 2人分そろったら次は「選択フェーズ」
  if (g.predictions.size >= g.players.size) {
    g.stage = "choice";
  }

  return res.json({ ok: true, round: g.round, stage: g.stage });
});

// 選択をサーバに送信
app.post("/game/choice", async (req, res) => {
  const { channel, playerId, round, choice } = req.body || {};
  if (!channel || !playerId || !choice) {
    return res.status(400).json({
      error: "missing_fields",
      need: ["channel","playerId","round","choice"],
      got: req.body
    });
  }
  const g = games.get(channel);
  if (!g) return res.status(400).json({ error: "game_not_found", channel });
  if (g.over) return res.status(400).json({ error: "game_over" });
  if (!["C","D"].includes(choice)) return res.status(400).json({ error: "invalid_choice", choice });

  // ラウンド厳密一致にこだわらず、サーバ側の現在ラウンドを採用
  const rNow = g.round;
  if (Number(round) !== rNow) {
    // 参考情報として返すだけで、処理は続行
    console.warn("[CHOICE] round mismatch: client=", round, "server=", rNow);
  }

  // プレイヤー登録漏れ対策：/game/join を呼んでいなくても一応登録
  g.players.add(String(playerId));
  if (!g.totals.has(String(playerId))) g.totals.set(String(playerId), 0);

  // 記録
  g.choices.set(String(playerId), choice);

  // 2人そろったら判定
  if (g.choices.size >= 2 && g.players.size >= 2) {
    const [p1, p2] = Array.from(g.players);
    const c1 = g.choices.get(p1) ?? "C";
    const c2 = g.choices.get(p2) ?? "C";
    const key = c1 + c2;
    const [pay1, pay2] = PAYOFF[key];

    g.totals.set(p1, (g.totals.get(p1) || 0) + pay1);
    g.totals.set(p2, (g.totals.get(p2) || 0) + pay2);

    g.lastResult = {
      round: rNow,
      choices: { [p1]: c1, [p2]: c2 },
      payoffs: { [p1]: pay1, [p2]: pay2 },
      totals: Object.fromEntries(g.totals.entries())
    };
    g.choices.clear();

    // 感情スライダーバーに移行
    g.stage = "emotion";
  }

  return res.json({ ok: true, serverRound: g.round });
});

// 感情スライダーの結果を送信
app.post("/game/emotion", (req, res) => {
  const { channel, playerId, round, emo1, emo2, emo3, emo4, emo5, emo6, emo7, emo8, emo9, emo10 } = req.body || {};
  if (!channel || !playerId ||
      emo1 == null || emo2 == null || emo3 == null || emo4 == null || emo5 == null ||
      emo6 == null || emo7 == null || emo8 == null || emo9 == null || emo10 == null) {
    return res.status(400).json({
      error: "missing_fields",
      need: ["channel","playerId","round","emo1","emo2","emo3","emo4","emo5","emo6","emo7","emo8","emo9","emo10"],
      got: req.body
    });
  }
  const g = games.get(channel);
  if (!g) return res.status(400).json({ error: "game_not_found", channel });
  if (g.over) return res.status(400).json({ error: "game_over" });

  const rNow = g.round;
  if (Number(round) !== rNow) {
    console.warn("[EMOTION] round mismatch: client=", round, "server=", rNow);
  }

  if (!g.stage) g.stage = "emotion";
  g.players.add(String(playerId));

  g.emotions.set(String(playerId), {
    round: rNow,
    emo1: Number(emo1),
    emo2: Number(emo2),
    emo3: Number(emo3),
    emo4: Number(emo4),
    emo5: Number(emo5),
    emo6: Number(emo6),
    emo7: Number(emo7),
    emo8: Number(emo8),
    emo9: Number(emo9),
    emo10: Number(emo10),
  });

  // 2人分そろったら次ラウンドへ
  if (g.players.size >= 2 && g.emotions.size >= 2) {
    g.emotions.clear();
    g.predictions.clear();
    g.choices.clear();

    if (rNow >= MAX_ROUNDS) {
      g.over = true;
      g.stage = "done";
    } else {
      g.round = rNow + 1;
      g.stage = "choice";  // 次ラウンドは直接選択へ
    }
  }

  return res.json({
    ok: true,
    round: g.round,
    stage: g.stage,
    over: g.over,
  });
});

// baseline（0回目）完了通知
app.post("/game/ready", (req, res) => {
  const { channel, playerId } = req.body || {};
  if (!channel || !playerId) {
    return res.status(400).json({ error: "channel and playerId required" });
  }
  const g = games.get(channel);
  if (!g) return res.status(400).json({ error: "game_not_found", channel });
  if (g.over) return res.status(400).json({ error: "game_over" });

  g.players.add(String(playerId));
  if (!g.ready) g.ready = new Set();
  g.ready.add(String(playerId));

  // 2人揃うまでは waiting
  if (g.players.size >= 2 && g.ready.size >= 2) {
    g.stage = "choice";
  } else {
    g.stage = "waiting";
  }

  return res.json({ ok: true, stage: g.stage, ready: g.ready.size, players: g.players.size });
});

// クライアントが状態をポーリングで取得
app.get("/game/state", (req, res) => {
  const channel = String(req.query.channel || "");
  const playerId = String(req.query.playerId || "");
  const g = games.get(channel);
  if (!g) return res.json({ exists: false });

  const myTotal = g.totals.get(playerId) || 0;
  return res.json({
    exists: true,
    round: g.round,
    over: g.over,
    stage: g.stage || "choice",
    lastResult: g.lastResult, // 直近の確定結果（null のこともある）
    myTotal,
    overReason: g.overReason || null,
    leftBy: g.leftBy || null,
    leftReason: g.leftReason || null,
  });
});

app.post("/leave", (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });

  // queue から削除
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].id === userId) queue.splice(i, 1);
  }

  // 既にチャンネル割当済みなら紐付けも削除（保険）
  const ch = userToChannel.get(userId);
  if (ch) {
    userToChannel.delete(userId);
    const room = rooms.get(ch);
    if (room) {
      room.users = room.users.filter(u => u !== userId);
      if (room.users.length === 0) rooms.delete(ch);
      else rooms.set(ch, room);
    }
  }

  return res.json({ ok: true });
});

app.post("/game/leave", (req, res) => {
  const { channel, playerId, reason } = req.body || {};
  if (!channel || !playerId) return res.status(400).json({ error: "channel and playerId required" });

  const g = games.get(channel);
  if (!g) return res.json({ ok: true, exists: false }); // idempotent

  g.over = true;
  g.stage = "done";
  g.overReason = "player_left";
  g.leftBy = String(playerId);
  g.leftReason = reason || "user_exit";

  return res.json({ ok: true });
});
