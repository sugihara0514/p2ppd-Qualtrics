// api.js
// renderのリンク
export const API_BASE = "https://multimodalpd-9qz7.onrender.com"; 

export async function joinQueue() {
  const r = await fetch(`${API_BASE}/join`, { method: "POST" });
  return r.json(); // { status:"paired", channel } or { status:"waiting", userId }
}
export async function pollMatch(userId) {
  const r = await fetch(`${API_BASE}/match?userId=${encodeURIComponent(userId)}`);
  return r.json(); // { status:"paired", channel } or { status:"waiting" }
}
export async function getToken(channel, uid=0) {
  const r = await fetch(`${API_BASE}/rtc/token?channel=${encodeURIComponent(channel)}&uid=${uid}`);
  return r.json(); // { token, appId, uid, expire }
}