// api.js
// renderのリンク
export const API_BASE = "https://multimodalpd-9qz7.onrender.com";
export const MATCH_CTX_KEY = "pd_match_ctx_v1";
export const MATCH_CTX_BACKUP_KEY = "pd_match_ctx_backup_v1";

export function readMatchCtx() {
  try {
    const s = sessionStorage.getItem(MATCH_CTX_KEY);
    if (s) return JSON.parse(s);
  } catch (e) {
    console.warn("[API] sessionStorage read failed", e);
  }

  try {
    const b = localStorage.getItem(MATCH_CTX_BACKUP_KEY);
    if (b) {
      const ctx = JSON.parse(b);

      // sessionStorageにも戻しておく
      try {
        sessionStorage.setItem(MATCH_CTX_KEY, JSON.stringify(ctx));
      } catch (e) {}

      return ctx;
    }
  } catch (e) {
    console.warn("[API] localStorage backup read failed", e);
  }

  return null;
}

export function writeMatchCtx(ctx) {
  const text = JSON.stringify(ctx);

  try {
    sessionStorage.setItem(MATCH_CTX_KEY, text);
  } catch (e) {
    console.warn("[API] sessionStorage write failed", e);
  }

  try {
    localStorage.setItem(MATCH_CTX_BACKUP_KEY, text);
  } catch (e) {
    console.warn("[API] localStorage backup write failed", e);
  }

  return ctx;
}

export function clearMatchCtx() {
  try {
    sessionStorage.removeItem(MATCH_CTX_KEY);
  } catch (e) {}

  try {
    localStorage.removeItem(MATCH_CTX_BACKUP_KEY);
  } catch (e) {}
}

export async function joinQueue({ participantId, resumeToken = null }) {
  const r = await fetch(`${API_BASE}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ participantId, resumeToken }),
  });

  const data = await r.json().catch(() => null);

  if (!r.ok) {
    console.warn("[API] joinQueue failed", r.status, data);
  }

  return data || { error: "invalid_json", statusCode: r.status };
}

export async function pollMatch({ participantId, resumeToken }) {
  const qs = new URLSearchParams({
    participantId: String(participantId),
    resumeToken: String(resumeToken || ""),
  });
  const r = await fetch(`${API_BASE}/match?${qs.toString()}`, {
    credentials: "omit",
  });
  return r.json();
}

export async function getToken(channel, uid = 0, { participantId, resumeToken }) {
  const qs = new URLSearchParams({
    channel: String(channel),
    uid: String(uid),
    participantId: String(participantId),
    resumeToken: String(resumeToken || ""),
  });
  const r = await fetch(`${API_BASE}/rtc/token?${qs.toString()}`, {
    credentials: "omit",
  });
  return r.json();
}

export async function postHeartbeat({ participantId, resumeToken, channel = null }) {
  const r = await fetch(`${API_BASE}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
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
    credentials: "omit",
    body: JSON.stringify({ participantId, resumeToken }),
  });
  return r.json();
}

export function sendPauseBeacon({ participantId, resumeToken, channel = null }) {
  if (!participantId || !resumeToken) return;

  try {
    const body = new URLSearchParams();
    body.set("participantId", String(participantId));
    body.set("resumeToken", String(resumeToken));
    if (channel) body.set("channel", String(channel));

    fetch(`${API_BASE}/pause`, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      mode: "cors",
    }).catch((e) => {
      console.warn("[API] pause keepalive failed", e);
    });
  } catch (e) {
    console.warn("[API] sendPauseBeacon failed", e);
  }
}