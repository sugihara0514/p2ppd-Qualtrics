// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuid } from "uuid";
import pkg from "agora-access-token";
const { RtcTokenBuilder, RtcRole } = pkg;

const MAX_ROUNDS = 5;

// QualtricsのURLを許可する
const allowedOrigin = [
  "https://survey.syd1.qualtrics.com", 
  "https://multimodalpd-static-65p9.onrender.com",
];
const corsOptions = {
  origin: allowedOrigin,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204, // プリフライトに 204 を返す
};

dotenv.config();
const app = express();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

console.log("[env-check]", {
  hasSUPABASE_URL: !!process.env.SUPABASE_URL,
  hasSUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseUrlHost: (process.env.SUPABASE_URL || "").split("/").slice(0,3).join("/"),
  hasAGORA_STORAGE_ACCESS_KEY: !!process.env.AGORA_STORAGE_ACCESS_KEY,
  hasAGORA_STORAGE_SECRET_KEY: !!process.env.AGORA_STORAGE_SECRET_KEY,
  AGORA_STORAGE_ENDPOINT: process.env.AGORA_STORAGE_ENDPOINT,
  AGORA_STORAGE_BUCKET: process.env.AGORA_STORAGE_BUCKET,
  AGORA_STORAGE_VENDOR: process.env.AGORA_STORAGE_VENDOR,
  AGORA_STORAGE_REGION: process.env.AGORA_STORAGE_REGION,
});


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
  const region = Number(process.env.AGORA_STORAGE_REGION || 0);
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
    fileNamePrefix: ["0605", safeSegment], //supabaseのpdフォルダに録画を保存
  };
  if (endpoint) {
    cfg.extensionParams = { endpoint };
  }
  return cfg;
}

// Cloud Recording のセッション情報を保持（簡易: メモリ）
const recordings = new Map(); // channel -> { resourceId, sid, uid }
const recordingStates = new Map(); // channel -> { status, ...diagnostics }

// 録画用 UID（通常の参加者と被らない値）
const RECORD_UID = Number(process.env.AGORA_RECORD_UID || 9999);

const phaseEvents = new Map(); // channel -> [{ atMs, round, phase, participantId, seat }]

function logPhaseEvent(channel, event) {
  if (!phaseEvents.has(channel)) phaseEvents.set(channel, []);
  phaseEvents.get(channel).push({
    atMs: nowMs(),
    ...event,
  });
}

// Cloud Recording 開始ヘルパー
async function startCloudRecording(channel) {
  try {
    if (recordings.has(channel)) {
      const existing = recordings.get(channel);
      recordingStates.set(channel, {
        status: "started",
        sid: existing.sid,
        startedAtMs: existing.startedAtMs,
      });
      return recordings.get(channel);
    }

    const room = rooms.get(channel);
    if (!room?.seats) {
      console.warn("[recording] seats not ready", channel);
      recordingStates.set(channel, {
        status: "waiting_for_seats",
        atMs: nowMs(),
      });
      return null;
    }

    const leftPid = room.seats.left;
    const rightPid = room.seats.right;
    const leftUid = room.uidMap?.[leftPid];
    const rightUid = room.uidMap?.[rightPid];

    if (!leftUid || !rightUid) {
      console.warn("[recording] uidMap not ready", { channel, leftPid, rightPid, uidMap: room.uidMap });
      recordingStates.set(channel, {
        status: "waiting_for_uids",
        atMs: nowMs(),
        leftPid,
        rightPid,
        hasLeftUid: !!leftUid,
        hasRightUid: !!rightUid,
      });
      return null;
    }

    recordingStates.set(channel, {
      status: "starting",
      atMs: nowMs(),
      leftPid,
      rightPid,
      leftUid,
      rightUid,
    });

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
      recordingStates.set(channel, {
        status: "failed",
        step: "acquire",
        atMs: nowMs(),
        detail: acquireData,
      });
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
          uid: String(leftUid),
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
          uid: String(rightUid),
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
      recordingStates.set(channel, {
        status: "failed",
        step: "start",
        atMs: nowMs(),
        detail: startData,
      });
      return null;
    }

    const { sid } = startData;
    const info = {
      resourceId,
      sid,
      uid: RECORD_UID,
      startedAtMs: nowMs(),
      leftPid,
      rightPid,
      leftUid,
      rightUid,
    };
    recordings.set(channel, info);
    recordingStates.set(channel, {
      status: "started",
      sid,
      startedAtMs: info.startedAtMs,
      leftPid,
      rightPid,
      leftUid,
      rightUid,
    });
    console.log("[recording] started", channel, info);

    logPhaseEvent(channel, {
      round: 0,
      phase: "recording_started",
      participantId: null,
      seat: null,
    });

    return info;
  } catch (err) {
    console.error("[recording] start error", err);
    recordingStates.set(channel, {
      status: "failed",
      step: "exception",
      atMs: nowMs(),
      message: err?.message || String(err),
    });
    return null;
  }
}

// Cloud Recording 停止ヘルパー
async function stopCloudRecording(channel) {
  try {
    const info = recordings.get(channel);
    if (!info) {
      console.warn("[recording] stop skipped: no active recording", { channel });
      return null;
    }

    const { resourceId, sid, uid } = info;

    console.log("[recording] stopping", {
      channel,
      resourceId,
      sid,
      uid,
    });

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

    const stopText = await stopResp.text();
    let stopData = null;
    try {
      stopData = stopText ? JSON.parse(stopText) : null;
    } catch {
      stopData = { raw: stopText };
    }

    console.log("[recording] stop status", stopResp.status);
    console.log("[recording] stop body", JSON.stringify(stopData, null, 2));

    if (!stopResp.ok) {
      console.error("[recording] stop failed", {
        channel,
        status: stopResp.status,
        body: stopData,
      });
      return null;
    }

    recordings.delete(channel);
    recordingStates.set(channel, {
      status: stopResp.ok ? "stopped" : "stop_failed",
      atMs: nowMs(),
      httpStatus: stopResp.status,
      uploadingStatus: stopData?.serverResponse?.uploadingStatus || null,
      fileList: stopData?.serverResponse?.fileList || null,
    });

    console.log("[recording] stopped", channel, stopData);
    console.log("[recording] uploadingStatus", stopData?.serverResponse?.uploadingStatus);
    console.log("[recording] fileList", JSON.stringify(stopData?.serverResponse?.fileList, null, 2));

    return stopData;
  } catch (err) {
    console.error("[recording] stop error", err);
    recordingStates.set(channel, {
      status: "stop_failed",
      atMs: nowMs(),
      message: err?.message || String(err),
    });
    return null;
  }
}

// --- 待機と部屋管理（resume / heartbeat / limited rematch）---
const WAIT_TTL_MS = 15 * 60 * 1000;
const HEARTBEAT_TTL_MS = 15 * 1000;
const REMATCH_GRACE_MS = 45 * 1000;

const queue = [];                  // participantId[]
const participants = new Map();   // participantId -> { participantId, resumeToken, channel, lastSeenAt, disconnectedAt, finalLeft }
const rooms = new Map();          // channel -> { channel, users:[participantId1, participantId2], createdAt }

function nowMs() {
  return Date.now();
}

function touchParticipant(p) {
  p.lastSeenAt = nowMs();
  p.disconnectedAt = null;
  p.finalLeft = false;
  return p;
}

function markPaused(p) {
  if (!p) return;
  if (!p.disconnectedAt) p.disconnectedAt = nowMs();
}

function refreshConnectivity(p) {
  if (!p) return null;
  if (!p.disconnectedAt && nowMs() - p.lastSeenAt > HEARTBEAT_TTL_MS) {
    p.disconnectedAt = p.lastSeenAt;
  }
  return p;
}

function isConnected(p) {
  refreshConnectivity(p);
  return !!p && !p.finalLeft && !p.disconnectedAt;
}

function cleanQueue() {
  for (let i = queue.length - 1; i >= 0; i--) {
    const id = queue[i];
    const p = participants.get(id);
    if (!p) {
      queue.splice(i, 1);
      continue;
    }
    refreshConnectivity(p);
    if (p.finalLeft || p.channel || nowMs() - p.lastSeenAt > WAIT_TTL_MS) {
      queue.splice(i, 1);
    }
  }
}

function removeFromQueue(participantId) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i] === participantId) queue.splice(i, 1);
  }
}

function dequeueWaitingOpponent(exceptId) {
  cleanQueue();
  while (queue.length) {
    const id = queue.shift();
    if (id === exceptId) continue;
    const p = participants.get(id);
    if (!p) continue;
    refreshConnectivity(p);
    if (p.finalLeft || p.channel) continue;
    if (nowMs() - p.lastSeenAt > WAIT_TTL_MS) continue;
    return p;
  }
  return null;
}

function getOpponentId(channel, participantId) {
  const room = rooms.get(channel);
  if (!room) return null;
  return room.users.find((id) => id !== participantId) || null;
}

function getSeatForParticipant(channel, participantId) {
  const room = rooms.get(channel);
  if (!room?.seats) return null;
  if (room.seats.left === participantId) return "left";
  if (room.seats.right === participantId) return "right";
  return null;
}

function buildMatchResponse(p) {
  if (p.channel && rooms.has(p.channel)) {
    return {
      status: "paired",
      participantId: p.participantId,
      userId: p.participantId,
      resumeToken: p.resumeToken,
      channel: p.channel,
    };
  }
  if (queue.includes(p.participantId)) {
    return {
      status: "waiting",
      participantId: p.participantId,
      userId: p.participantId,
      resumeToken: p.resumeToken,
    };
  }
  return {
    status: "idle",
    participantId: p.participantId,
    userId: p.participantId,
    resumeToken: p.resumeToken,
  };
}

function pairParticipants(a, b) {
  const channel = `room-${uuid()}`;
  rooms.set(channel, {
    channel,
    users: [a.participantId, b.participantId],
    seats: {
      left: a.participantId,
      right: b.participantId,
    },
    uidMap: {},
    createdAt: nowMs(),
  });
  a.channel = channel;
  b.channel = channel;
  touchParticipant(a);
  touchParticipant(b);
  return channel;
}

function enqueueOrPair(p) {
  cleanQueue();

  if (p.channel && rooms.has(p.channel)) {
    return buildMatchResponse(p);
  }

  if (queue.includes(p.participantId)) {
    return buildMatchResponse(p);
  }

  const other = dequeueWaitingOpponent(p.participantId);
  if (other) {
    const channel = pairParticipants(other, p);
    return {
      status: "paired",
      participantId: p.participantId,
      userId: p.participantId,
      resumeToken: p.resumeToken,
      channel,
    };
  }

  queue.push(p.participantId);
  return {
    status: "waiting",
    participantId: p.participantId,
    userId: p.participantId,
    resumeToken: p.resumeToken,
  };
}

function findAuthedParticipant(participantId, resumeToken) {
  const p = participants.get(String(participantId || ""));
  if (!p) return null;
  if (!resumeToken) return null;
  if (p.resumeToken !== String(resumeToken)) return null;
  return p;
}

async function finalizeRoom(channel, { overReason = "player_left", leftBy = null, leftReason = "user_exit" } = {}) {
  const room = rooms.get(channel);
  if (!room) return;

  const g = games.get(channel);
  if (g && !g.over) {
    g.over = true;
    g.stage = "done";
    g.overReason = overReason;
    g.leftBy = leftBy;
    g.leftReason = leftReason;
  }

  for (const pid of room.users) {
    const p = participants.get(pid);
    if (p && p.channel === channel) p.channel = null;
  }

  rooms.delete(channel);
  await stopCloudRecording(channel);

  // 再戦用に閉じた旧ゲームは消す
  if (overReason === "opponent_disconnected") {
    games.delete(channel);
    phaseEvents.delete(channel);
  }
}

app.post("/join", (req, res) => {
  const participantId = String(req.body?.participantId || "");
  const resumeToken = String(req.body?.resumeToken || "");
  if (!participantId) {
    return res.status(400).json({ error: "participantId required" });
  }

  let p = participants.get(participantId);

  // 正しい resumeToken があるなら復帰
  if (p && resumeToken && p.resumeToken === resumeToken && !p.finalLeft) {
    touchParticipant(p);
    return res.json(enqueueOrPair(p));
  }

  // 既存の active session があるのに token なし/不一致なら拒否
  if (p && !p.finalLeft && (p.channel || queue.includes(participantId))) {
    return res.status(409).json({ error: "resume_token_required" });
  }

  if (!p) {
    p = {
      participantId,
      resumeToken: uuid(),
      channel: null,
      lastSeenAt: nowMs(),
      disconnectedAt: null,
      finalLeft: false,
    };
    participants.set(participantId, p);
  } else {
    p.resumeToken = uuid();
    p.channel = null;
    p.finalLeft = false;
    p.disconnectedAt = null;
    p.lastSeenAt = nowMs();
  }

  return res.json(enqueueOrPair(p));
});

app.get("/match", (req, res) => {
  const participantId = String(req.query.participantId || req.query.userId || "");
  const resumeToken = String(req.query.resumeToken || "");
  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p) return res.status(404).json({ status: "not_found" });

  touchParticipant(p);
  return res.json(buildMatchResponse(p));
});

app.post("/heartbeat", (req, res) => {
  const { participantId, resumeToken } = req.body || {};
  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p) return res.status(401).json({ error: "unauthorized" });

  touchParticipant(p);

  const oppId = p.channel ? getOpponentId(p.channel, p.participantId) : null;
  const opp = oppId ? participants.get(oppId) : null;
  refreshConnectivity(opp);

  const opponentConnected = !!oppId && isConnected(opp);
  const rematchEligible =
    !!oppId &&
    !!opp &&
    (opp.finalLeft || (!!opp.disconnectedAt && (nowMs() - opp.disconnectedAt >= REMATCH_GRACE_MS)));
  return res.json({
    ok: true,
    channel: p.channel || null,
    opponentConnected,
    rematchEligible,
  });
});

app.post("/pause", (req, res) => {
  const { participantId, resumeToken } = req.body || {};
  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p) return res.json({ ok: true });
  markPaused(p);
  return res.json({ ok: true });
});

// --- Agora Token（本番用） ---
app.get("/rtc/token", (req, res) => {
  const channel = (req.query.channel || "").trim();
  const uid     = Number(req.query.uid ?? 0);
  const participantId = String(req.query.participantId || "");
  const resumeToken = String(req.query.resumeToken || "");
  if (!channel) return res.status(400).json({ error: "channel required" });

  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p || p.channel !== channel) {
    return res.status(403).json({ error: "forbidden" });
  }

  const role = RtcRole.PUBLISHER;
  const expire = Math.floor(Date.now()/1000) + TTL;
  const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, CERT, channel, uid, role, expire);
  res.json({ appId: APP_ID, channel, uid, token, expire });
});

app.post("/rtc/register", async (req, res) => {
  const { channel, participantId, resumeToken, uid } = req.body || {};
  if (!channel || !participantId || !resumeToken || uid == null) {
    return res.status(400).json({ error: "channel, participantId, resumeToken, uid required" });
  }

  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p || p.channel !== channel) {
    return res.status(403).json({ error: "forbidden" });
  }

  const room = rooms.get(channel);
  if (!room) {
    return res.status(404).json({ error: "room_not_found" });
  }

  if (!room.uidMap) room.uidMap = {};
  room.uidMap[String(participantId)] = Number(uid);

  const leftPid = room.seats?.left;
  const rightPid = room.seats?.right;
  const leftUid = leftPid ? room.uidMap[leftPid] : null;
  const rightUid = rightPid ? room.uidMap[rightPid] : null;

  if (leftUid && rightUid && !recordings.has(channel)) {
    await startCloudRecording(channel);
  }

  return res.json({
    ok: true,
    seat: getSeatForParticipant(channel, String(participantId)),
    seats: room.seats || null,
    uidMap: room.uidMap,
  });
});

app.get("/", (req, res) => res.send("pd-api ok"));
app.get("/healthz", (req, res) => res.json({ ok: true }));


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));

// --- 囚人のジレンマ ---
// const PAYOFF = { CC:[2,2], CD:[0,3], DC:[3,0], DD:[1,1] };

// --- Split or Steal ---
const PAYOFF = {
  CC: [400, 400], // Split / Split
  CD: [0, 600],    // Split / Steal
  DC: [600, 0],    // Steal / Split
  DD: [200, 200],       // Steal / Steal
};

function getRoundPayoff(round, key) {
  // 1,2ラウンド目は練習
  if (round < MAX_ROUNDS) return [0, 0];

  // 3ラウンド目のみ本番
  return PAYOFF[key] || [0, 0];
}

const games = new Map();

function buildGameSnapshot(channel, playerId) {
  const g = games.get(channel);
  const room = rooms.get(channel);

    if (!g || !room) return { exists: false };

  const meId = String(playerId || "");
  const myTotal = g.totals.get(meId) || 0;

  const oppId = room?.users?.find((id) => id !== meId) || null;
  const opp = oppId ? participants.get(oppId) : null;
  refreshConnectivity(opp);

  const opponentConnected = !!oppId && isConnected(opp);
  const rematchEligible = !!oppId && !!opp?.disconnectedAt && (nowMs() - opp.disconnectedAt >= REMATCH_GRACE_MS);

  const seat = getSeatForParticipant(channel, meId);
  const seats = room?.seats || null;
  const leftTotal = seats?.left ? (g.totals.get(seats.left) || 0) : 0;
  const rightTotal = seats?.right ? (g.totals.get(seats.right) || 0) : 0;
  const rec = recordings.get(channel) || null;
  const recordingState = recordingStates.get(channel) || null;

  return {
    exists: true,
    round: g.round,
    over: g.over,
    stage: g.stage || "choice",
    lastResult: g.lastResult,
    myTotal,
    overReason: g.overReason || null,
    leftBy: g.leftBy || null,
    leftReason: g.leftReason || null,
    baselineDone: g.ready?.has(meId) || false,
    myChoiceSubmitted: g.choices.has(meId),
    myEmotionSubmitted: g.emotions.has(meId),
    opponentConnected,
    rematchEligible,
    opponentId: oppId,
    seat,
    seats,
    leftTotal,
    rightTotal,
    recordingStarted: !!rec,
    recordingSid: rec?.sid || null,
    recordingStatus: recordingState?.status || (rec ? "started" : "not_started"),
    recordingState,
  };
}

// ゲーム参加（channel と client側で作った playerId を紐づけ）
app.post("/game/join", async (req, res) => {
  const { channel, playerId } = req.body || {};
  if (!channel || !playerId) {
    return res.status(400).json({ error: "channel and playerId required" });
  }

  const room = rooms.get(channel);
  if (!room) {
    return res.status(404).json({ error: "room_not_found", exists: false });
  }

  if (!games.has(channel)) {
    games.set(channel, {
      round: 1,
      players: new Set(),
      stage: "waiting",          // 初期wating、その後emotion、choice
      ready: new Set(),          // baseline完了した人
      predictions: new Map(),    // playerId -> predictionValue
      choices: new Map(),        // playerId -> "C" | "D"
      emotions: new Map(),       // playerId -> { emo1, emo2, emo3, ・・・ }
      choiceLedger: new Map(),   // `${round}:${playerId}` -> choice
      emotionLedger: new Map(),  // `${round}:${playerId}` -> emotion payload
      totals: new Map(),
      lastResult: null,
      over: false,
    });
  }
  const g = games.get(channel);
  g.players.add(String(playerId));
  if (!g.totals.has(String(playerId))) g.totals.set(String(playerId), 0);

  // プレイヤーが2人揃ったら録画開始（既に開始済みなら内部でなにもしない）
  // 録画停止してテストする場合はここをコメントアウト
  if (g.players.size >= 2) {
    startCloudRecording(channel);
  }

  return res.json({
    ok: true,
    players: Array.from(g.players),
    totals: Object.fromEntries(g.totals.entries()),
    ...buildGameSnapshot(channel, playerId),
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

app.get("/record/meta", (req, res) => {
  const channel = String(req.query.channel || "");
  const room = rooms.get(channel);
  const rec = recordings.get(channel);

  return res.json({
    channel,
    seats: room?.seats || null,
    uidMap: room?.uidMap || null,
    recording: rec || null,
    recordingState: recordingStates.get(channel) || null,
    phaseEvents: phaseEvents.get(channel) || [],
  });
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

  const roundKey = `${Number(round)}:${String(playerId)}`;
  if (g.choiceLedger?.has(roundKey)) {
    return res.json({ ok: true, duplicate: true, serverRound: g.round, stage: g.stage });
  }

  const rNow = g.round;
  if (Number(round) !== rNow) {
    return res.status(409).json({
      error: "round_mismatch",
      serverRound: rNow,
      stage: g.stage,
    });
   }

  if (g.stage !== "choice") {
    return res.status(409).json({
      error: "invalid_stage",
      serverRound: rNow,
      stage: g.stage,
    });
  }

  // プレイヤー登録漏れ対策：/game/join を呼んでいなくても一応登録
  g.players.add(String(playerId));
  if (!g.totals.has(String(playerId))) g.totals.set(String(playerId), 0);

  // 記録
  g.choices.set(String(playerId), choice);
  g.choiceLedger.set(roundKey, choice);

  logPhaseEvent(channel, {
    round: rNow,
    phase: "choice_submitted",
    participantId: String(playerId),
    seat: getSeatForParticipant(channel, String(playerId)),
  });

  // 2人そろったら判定
  if (g.choices.size >= 2 && g.players.size >= 2) {
    const [p1, p2] = Array.from(g.players);
    const c1 = g.choices.get(p1) ?? "C";
    const c2 = g.choices.get(p2) ?? "C";
    const key = c1 + c2;
    // const [pay1, pay2] = PAYOFF[key];
    const [pay1, pay2] = getRoundPayoff(rNow, key);

    g.totals.set(p1, (g.totals.get(p1) || 0) + pay1);
    g.totals.set(p2, (g.totals.get(p2) || 0) + pay2);

    g.lastResult = {
      round: rNow,
      choices: { [p1]: c1, [p2]: c2 },
      payoffs: { [p1]: pay1, [p2]: pay2 },
      totals: Object.fromEntries(g.totals.entries())
    };

    const room = rooms.get(channel);
    const leftPid = room?.seats?.left || null;
    const rightPid = room?.seats?.right || null;

    logPhaseEvent(channel, {
      round: rNow,
      phase: "result",
      leftPid,
      rightPid,
      leftChoice: leftPid ? (g.lastResult.choices[leftPid] || "") : "",
      rightChoice: rightPid ? (g.lastResult.choices[rightPid] || "") : "",
      leftPayoff: leftPid ? (g.lastResult.payoffs[leftPid] || 0) : 0,
      rightPayoff: rightPid ? (g.lastResult.payoffs[rightPid] || 0) : 0,
      leftTotal: leftPid ? (g.lastResult.totals[leftPid] || 0) : 0,
      rightTotal: rightPid ? (g.lastResult.totals[rightPid] || 0) : 0,
    });

    g.choices.clear();

    // 感情スライダーバーに移行
    g.stage = "emotion";

    logPhaseEvent(channel, {
      round: rNow,
      phase: "emotion_started",
      participantId: null,
      seat: null,
      leftPid,
      rightPid,
      leftChoice: leftPid ? (g.lastResult?.choices?.[leftPid] || "") : "",
      rightChoice: rightPid ? (g.lastResult?.choices?.[rightPid] || "") : "",
      leftTotal: leftPid ? (g.lastResult?.totals?.[leftPid] || 0) : 0,
      rightTotal: rightPid ? (g.lastResult?.totals?.[rightPid] || 0) : 0,
    });
  }

  return res.json({ ok: true, serverRound: g.round, stage: g.stage });
});

// 感情スライダーの結果を送信
app.post("/game/emotion", async (req, res) => {
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

  const roundKey = `${Number(round)}:${String(playerId)}`;
  if (g.emotionLedger?.has(roundKey)) {
    return res.json({ ok: true, duplicate: true, round: g.round, stage: g.stage, over: g.over });
  }

  const rNow = g.round;
  if (Number(round) !== rNow) {
    return res.status(409).json({
      error: "round_mismatch",
      serverRound: rNow,
      stage: g.stage,
    });
  }

  if (g.stage !== "emotion") {
    return res.status(409).json({
      error: "invalid_stage",
      serverRound: rNow,
      stage: g.stage,
    });
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

  g.emotionLedger.set(roundKey, {
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

  logPhaseEvent(channel, {
    round: rNow,
    phase: "emotion_submitted",
    participantId: String(playerId),
    seat: getSeatForParticipant(channel, String(playerId)),
  });

  // 2人分そろったら次ラウンドへ
  if (g.players.size >= 2 && g.emotions.size >= 2) {
    g.emotions.clear();
    g.predictions.clear();
    g.choices.clear();

    if (rNow >= MAX_ROUNDS) {
      g.over = true;
      g.stage = "done";
      g.overReason = "game_finished";

      const room = rooms.get(channel);
      const leftPid = room?.seats?.left || null;
      const rightPid = room?.seats?.right || null;

      logPhaseEvent(channel, {
        round: rNow,
        phase: "game_finished",
        participantId: null,
        seat: null,
        leftPid,
        rightPid,
        leftTotal: leftPid ? (g.totals.get(leftPid) || 0) : 0,
        rightTotal: rightPid ? (g.totals.get(rightPid) || 0) : 0,
      });

      // 正式終了時点で録画を停止する
      if (!g.recordingStopRequested) {
        g.recordingStopRequested = true;
        await stopCloudRecording(channel);
      }
    } else {
      g.round = rNow + 1;
      g.stage = "choice";
      const room = rooms.get(channel);
      const leftPid = room?.seats?.left || null;
      const rightPid = room?.seats?.right || null;
      logPhaseEvent(channel, {
        round: g.round,
        phase: "next_round_started",
        participantId: null,
        seat: null,
        leftPid,
        rightPid,
        leftTotal: leftPid ? (g.totals.get(leftPid) || 0) : 0,
        rightTotal: rightPid ? (g.totals.get(rightPid) || 0) : 0,
      });
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

  logPhaseEvent(channel, {
    round: 0,
    phase: "baseline_done",
    participantId: String(playerId),
    seat: getSeatForParticipant(channel, String(playerId)),
  });

  // 2人揃うまでは waiting
  if (g.players.size >= 2 && g.ready.size >= 2) {
    g.stage = "choice";
  } else {
    g.stage = "waiting";
  }

  return res.json({
    ok: true,
    stage: g.stage,
    ready: g.ready.size,
    players: g.players.size,
    ...buildGameSnapshot(channel, playerId),
  });
});

// クライアントが状態をポーリングで取得
app.get("/game/state", (req, res) => {
  const channel = String(req.query.channel || "");
  const playerId = String(req.query.playerId || "");
  return res.json(buildGameSnapshot(channel, playerId));
});

app.post("/leave", async (req, res) => {
  const participantId = String(req.body?.participantId || req.body?.userId || "");
  const resumeToken = String(req.body?.resumeToken || "");
  const reason = String(req.body?.reason || "user_exit");
  if (!participantId) return res.status(400).json({ error: "participantId required" });

  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p) return res.json({ ok: true });

  removeFromQueue(participantId);

  // 正式終了後の離脱。
  // 録画は /game/emotion 側で止まる想定だが、保険でここでも止める。
  if (reason === "game_finished" && p.channel && rooms.has(p.channel)) {
    const oldChannel = p.channel;
    const g = games.get(oldChannel);
    const room = rooms.get(oldChannel);

    if (g) {
      g.over = true;
      g.stage = "done";
      g.overReason = "game_finished";

      if (!g.recordingStopRequested) {
        g.recordingStopRequested = true;
        await stopCloudRecording(oldChannel);
      }
    } else {
      await stopCloudRecording(oldChannel);
    }

    p.finalLeft = true;
    p.disconnectedAt = nowMs();
    p.channel = null;

    // 2人とも最終離脱したら掃除する
    const everyoneLeft = room?.users?.every((pid) => {
      const pp = participants.get(pid);
      return !pp || pp.finalLeft || pp.channel !== oldChannel;
    });

    if (everyoneLeft) {
      rooms.delete(oldChannel);
      games.delete(oldChannel);
      phaseEvents.delete(oldChannel);
    }

    return res.json({ ok: true, reason: "game_finished" });
  }

  // 緊急離脱は「相手だけ再マッチ可能」にするため、部屋はすぐ閉じない
  if (reason === "user_exit" && p.channel && rooms.has(p.channel)) {
    const oldChannel = p.channel;

    const g = games.get(oldChannel);
    if (g && !g.over) {
      g.leftBy = participantId;
      g.leftReason = reason;
      g.overReason = "opponent_left";
      // g.over は立てない
      // g.stage も done にしない
    }

    // 緊急離脱時点で旧録画は止める。
    // 相手が再マッチする場合は、新しい room で新しい録画を開始する。
    if (g && !g.recordingStopRequested) {
      g.recordingStopRequested = true;
      await stopCloudRecording(oldChannel);
    } else {
      await stopCloudRecording(oldChannel);
    }

    p.finalLeft = true;
    p.disconnectedAt = nowMs();
    p.channel = null;   // 離脱した本人だけ外す

    return res.json({ ok: true, rematchForOpponent: true });
  }

  // それ以外の離脱は従来どおり
  if (p.channel && rooms.has(p.channel)) {
    await finalizeRoom(p.channel, {
      overReason: "player_left",
      leftBy: participantId,
      leftReason: reason,
    });
  }

  p.finalLeft = true;
  p.channel = null;
  p.disconnectedAt = nowMs();

  return res.json({ ok: true });
});

app.post("/game/leave", async (req, res) => {
  const { channel, playerId, reason } = req.body || {};
  if (!channel || !playerId) return res.status(400).json({ error: "channel and playerId required" });

  const g = games.get(channel);
  if (!g) return res.json({ ok: true, exists: false }); // idempotent

  g.over = true;
  g.stage = "done";
  g.overReason = "player_left";
  g.leftBy = String(playerId);
  g.leftReason = reason || "user_exit";

  if (!g.recordingStopRequested) {
    g.recordingStopRequested = true;
    await stopCloudRecording(channel);
  }

  return res.json({ ok: true });
});

app.post("/rematch", async (req, res) => {
  const participantId = String(req.body?.participantId || "");
  const resumeToken = String(req.body?.resumeToken || "");
  const p = findAuthedParticipant(participantId, resumeToken);
  if (!p) return res.status(401).json({ error: "unauthorized" });
  if (!p.channel || !rooms.has(p.channel)) {
    return res.status(400).json({ error: "no_active_room" });
  }

  const oppId = getOpponentId(p.channel, p.participantId);
  const opp = oppId ? participants.get(oppId) : null;
  refreshConnectivity(opp);

  const eligible = !!opp && !!opp.disconnectedAt && (nowMs() - opp.disconnectedAt >= REMATCH_GRACE_MS);
  if (!eligible) {
    return res.status(403).json({ error: "rematch_not_allowed" });
  }

  const oldChannel = p.channel;
  await finalizeRoom(oldChannel, {
    overReason: "opponent_disconnected",
    leftBy: oppId,
    leftReason: "connection_lost",
  });

  touchParticipant(p);
  return res.json(enqueueOrPair(p));
});

app.post("/agora/ncs", express.json({ type: "*/*" }), (req, res) => {
  console.log("[NCS]", JSON.stringify(req.body, null, 2));
  res.status(200).json({ ok: true }); // 10秒以内に200を返すのが重要
});
