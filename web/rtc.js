export function createRtc(APP_ID) {
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  let micTrack = null, camTrack = null, joined = false;

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") user.videoTrack.play("remoteContainer");
    if (mediaType === "audio") user.audioTrack.play();
  });
  client.on("user-unpublished", () => {
    document.getElementById("remoteContainer").innerHTML = '<span class="label">Remote</span>';
  });

  return {
    async join(channel, token=null, uid=null) {
      const myUid = await client.join(APP_ID, channel, token, uid);
      [micTrack, camTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      camTrack.play("localContainer");
      await client.publish([micTrack, camTrack]);
      joined = true;
      return myUid;
    },
    async leave() {
      if (micTrack) { micTrack.stop(); micTrack.close(); micTrack = null; }
      if (camTrack) { camTrack.stop(); camTrack.close(); camTrack = null; }
      if (joined) { await client.leave(); joined = false; }
      document.getElementById("localContainer").innerHTML = '<span class="label">Local</span>';
      document.getElementById("remoteContainer").innerHTML = '<span class="label">Remote</span>';
    }
  };
}