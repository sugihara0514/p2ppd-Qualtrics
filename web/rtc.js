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
      // 何が起きても最後まで進む
      try {
        // 1) まず unpublish/leave（失敗しても次へ）
        if (joined) {
          try { await client.unpublish(); } catch (e) { console.warn("[RTC] client.unpublish error", e); }
          try { await client.leave(); } catch (e) { console.warn("[RTC] client.leave error", e); }
        }

        // 2) Agoraトラックの停止（失敗しても次へ）
        if (micTrack) {
          try { micTrack.stop(); } catch (e) { console.warn("[RTC] mic stop error", e); }
          try { micTrack.close(); } catch (e) { console.warn("[RTC] mic close error", e); }
          // 最後の手段：生トラックを止める
          try { micTrack.getMediaStreamTrack?.().stop(); } catch (e) {}
          micTrack = null;
        }

        if (camTrack) {
          try { camTrack.stop(); } catch (e) { console.warn("[RTC] cam stop error", e); }
          try { camTrack.close(); } catch (e) { console.warn("[RTC] cam close error", e); }
          // 最後の手段：生トラックを止める
          try { camTrack.getMediaStreamTrack?.().stop(); } catch (e) {}
          camTrack = null;
        }

        // remoteAudioTrack は stop が落ちやすいので、基本は参照を捨てるだけ
        if (remoteAudioTrack) {
          try { remoteAudioTrack.stop?.(); } catch (e) {}
          remoteAudioTrack = null;
      }

      } finally {
        joined = false;

        const lc = document.getElementById("localContainer");
        if (lc) lc.innerHTML = '<span class="label">Local</span>';
        const rc = document.getElementById("remoteContainer");
        if (rc) rc.innerHTML = '<span class="label">Remote</span>';
      }
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

      if (!remoteAudioTrack) return;

      try {
        // 可能なら setVolume で無音化（stopしない）
        if (typeof remoteAudioTrack.setVolume === "function") {
          remoteAudioTrack.setVolume(remoteAudioEnabled ? 100 : 0);

          // ON に戻すとき、念のため play を保険で（多重生成はしにくい）
          if (remoteAudioEnabled) {
            try { remoteAudioTrack.play(); } catch (e) {}
          }
          return;
        }

        // setVolume が無い環境のフォールバック
        if (remoteAudioEnabled) {
          remoteAudioTrack.play();
        } else {
          // stop は落ちやすいので、最後の手段として try/catch のみ
          try { remoteAudioTrack.stop(); } catch (e) {}
        }
      } catch (e) {
        console.warn("setRemoteAudioEnabled failed", e);
      }
    },
  };
}