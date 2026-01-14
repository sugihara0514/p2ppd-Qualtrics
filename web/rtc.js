// rtc.js
export function createRtc(APP_ID) {
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  let micTrack = null, camTrack = null, joined = false;

  // 現在のミュート状態
  let micMuted = false;
  let camMuted = false;

  let remoteAudioTrack = null;
  let remoteAudioEnabled = true; // デフォルトはON

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") user.videoTrack.play("remoteContainer");
    if (mediaType === "audio") {
      remoteAudioTrack = user.audioTrack;

      if (remoteAudioEnabled) {
        remoteAudioTrack.play();
      } else {
        // OFF中に来た場合は再生しない（または音量0）
        // remoteAudioTrack.setVolume?.(0);
      }
    }
  });
  client.on("user-unpublished", (user, mediaType) => {
  if (mediaType === "video") {
    // 映像が止まったときだけ remoteContainer を消す
    document.getElementById("remoteContainer").innerHTML = '<span class="label">Remote</span>';
  }
  if (mediaType === "audio") {
    // 音声が止まっても映像は消さない（必要ならUIだけ更新）
    remoteAudioTrack = null;
  }
});

  async function applyMuteState() {
    // join前に押されても安全に無視できるように
    if (micTrack) await micTrack.setEnabled(!micMuted);
    if (camTrack) await camTrack.setEnabled(!camMuted);
  }

  return {
    async join(channel, token=null, uid=null) {
      const myUid = await client.join(APP_ID, channel, token, uid);
      [micTrack, camTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      camTrack.play("localContainer");
      await client.publish([micTrack, camTrack]);
      joined = true;

      // 追加：join直後に、現在のミュート状態を反映
      await applyMuteState();

      return myUid;
    },
    async leave() {
      if (remoteAudioTrack) { remoteAudioTrack.stop(); remoteAudioTrack = null; }
      if (micTrack) { micTrack.stop(); micTrack.close(); micTrack = null; }
      if (camTrack) { camTrack.stop(); camTrack.close(); camTrack = null; }
      if (joined) { await client.leave(); joined = false; }

      document.getElementById("localContainer").innerHTML = '<span class="label">Local</span>';
      document.getElementById("remoteContainer").innerHTML = '<span class="label">Remote</span>';
    },

    // 外から状態取得（UI更新用）
    getMuteState() {
      return { micMuted, camMuted, joined };
    },
    
    // ミュート切替
    async setMicMuted(muted) {
      micMuted = !!muted;
      await applyMuteState();
      return this.getMuteState();
    },
    async toggleMic() {
      return this.setMicMuted(!micMuted);
    },

    async setCamMuted(muted) {
      camMuted = !!muted;
      await applyMuteState();
      return this.getMuteState();
    },
    async toggleCam() {
      return this.setCamMuted(!camMuted);
    },

    async setRemoteAudioEnabled(enabled) {
      remoteAudioEnabled = !!enabled;

      // すでに受信済みのトラックがあれば即反映
      if (remoteAudioTrack) {
        if (remoteAudioEnabled) {
          remoteAudioTrack.play();
          // remoteAudioTrack.setVolume?.(100);
        } else {
          remoteAudioTrack.stop();      // 相手の音声を止める
          // remoteAudioTrack.setVolume?.(0);
        }
      }
    },
  };
}