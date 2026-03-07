// api.js
// renderのリンク
export const API_BASE = "https://multimodalpd-9qz7.onrender.com";
export const MATCH_CTX_KEY = "pd_match_ctx_v2";

export function readMatchCtx() {
  try {
    return JSON.parse(sessionStorage.getItem(MATCH_CTX_KEY) || "null");
  } catch {
    return null;
  }
}

export function writeMatchCtx(ctx) {
  sessionStorage.setItem(MATCH_CTX_KEY, JSON.stringify(ctx));
  return ctx;
}

export function clearMatchCtx() {
  sessionStorage.removeItem(MATCH_CTX_KEY);
}

export async function joinQueue({ participantId, resumeToken = null }) {
  const r = await fetch(`${API_BASE}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, resumeToken }),
  });
  return r.json();
}

export async function pollMatch({ participantId, resumeToken }) {
  const qs = new URLSearchParams({
    participantId: String(participantId),
    resumeToken: String(resumeToken || ""),
  });
  const r = await fetch(`${API_BASE}/match?${qs.toString()}`);
  return r.json();
}

export async function getToken(channel, uid = 0, { participantId, resumeToken }) {
  const qs = new URLSearchParams({
    channel: String(channel),
    uid: String(uid),
    participantId: String(participantId),
    resumeToken: String(resumeToken || ""),
  });
  const r = await fetch(`${API_BASE}/rtc/token?${qs.toString()}`);
  return r.json();
}

export async function postHeartbeat({ participantId, resumeToken, channel = null }) {
  const r = await fetch(`${API_BASE}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, resumeToken, channel }),
  });
  return r.json();
}

export async function finalizeMatch({ participantId, resumeToken, channel = null, reason = "user_exit" }) {
  const r = await fetch(`${API_BASE}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, resumeToken, channel, reason }),
  });
  return r.json();
}

export async function requestRematch({ participantId, resumeToken }) {
  const r = await fetch(`${API_BASE}/rematch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, resumeToken }),
  });
  return r.json();
}

export function sendPauseBeacon({ participantId, resumeToken, channel = null }) {
  if (!participantId || !resumeToken || !navigator.sendBeacon) return;
  const blob = new Blob(
    [JSON.stringify({ participantId, resumeToken, channel })],
    { type: "application/json" }
  );
  navigator.sendBeacon(`${API_BASE}/pause`, blob);
}