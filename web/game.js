// game.js
export function startGame(channel) {
  const ui = document.getElementById("gameUI");
  ui.style.display = "block";
  const status = document.getElementById("gameStatus");
  const btnC = document.getElementById("btnC");
  const btnD = document.getElementById("btnD");

  // 感情スライダー関連 DOM
  const emoUI   = document.getElementById("emotionUI");
  const emo1    = document.getElementById("emo1");
  const emo2    = document.getElementById("emo2");
  const emo3    = document.getElementById("emo3");
  const emoNext = document.getElementById("emotionNext");

  const API_BASE = "https://p2ppd-qualtrics.onrender.com"; // APIのURL
  // playerId：QualtricsのResponseIDを優先し、なければlocalStorageのUUID
  let pid =
    (window.__PD__ && window.__PD__.responseId) ||
    localStorage.getItem("pd_player_id");

  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem("pd_player_id", pid);
  }

  // Qualtrics側にも保存（任意）
  if (window.Qualtrics && Qualtrics.SurveyEngine) {
    Qualtrics.SurveyEngine.setEmbeddedData("pd_player_id", String(pid));
    Qualtrics.SurveyEngine.setJSEmbeddedData("pd_player_id", String(pid));
  }

  let currentRound = 1;
  let canChoose = false;
  let pollTimer = null;
  const history = []; // {round, me, opp, myPayoff, myTotal}

  // 感情スライダーの履歴: [{ round, emo1, emo2, emo3 }, ...]
  const emotionHistory = [];
  let waitingEmotion = false; // このラウンドの感情入力待ちか

   // 反応時間用
  let roundStartAt = null;        // そのラウンドが「選択可能になった」時刻
  let pendingRtMs  = null;        // 直近ラウンドのRT（ms）
  const rtList     = [];          // [{ round, rtMs }, ...]
  let pendingRound = null;        // サーバー側で用意された次ラウンド番号

  // ゲーム参加宣言
  fetch(`${API_BASE}/game/join`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ channel, playerId: pid })
  })
  .then(r => r.json())
  .then(init => {
    currentRound = init.round || 1;
    status.textContent = `Round ${currentRound}/10: 選択してください`;
    setButtonsEnabled(true);
    canChoose = true;

    // RT計測：ラウンド開始時刻を記録
    roundStartAt = performance.now();
    pendingRtMs = null;

    startPolling();
  }).catch(err => {
    console.error("game/join failed", err);
    status.textContent = "ゲーム初期化に失敗しました";
  });

  btnC.onclick = () => choose("C");
  btnD.onclick = () => choose("D");

  async function choose(choice) {
    if (!canChoose) return;
    canChoose = false;
    setButtonsEnabled(false);

    // 反応時間計測
    if (roundStartAt != null) {
      pendingRtMs = performance.now() - roundStartAt; // ms
      rtList.push({ round: currentRound, rtMs: pendingRtMs });

      // 必要ならラウンドごとに Embedded Data にも保存
      if (window.Qualtrics && Qualtrics.SurveyEngine) {
        Qualtrics.SurveyEngine.setJSEmbeddedData(
          `pd_rt_round${currentRound}`,
          String(Math.round(pendingRtMs))
        );
      }
    }

    status.textContent = `Round ${currentRound}/10: あなたは ${choice} を選びました。相手の結果待ち…`;

    const body = { channel, playerId: pid, round: currentRound, choice };
    console.log("[GAME] POST /game/choice", body);

    try {
      const resp = await fetch(`${API_BASE}/game/choice`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(body),
      });

      // fetchは400/500でも例外にしない→ここで判断
      const text = await resp.text();
      let data = null;
      try { 
        data = text ? JSON.parse(text) : null; 
      } catch (e) { /* サーバが空や非JSONでも続行 */ }

      if (!resp.ok) {
        console.error("choice HTTP error", resp.status, data || text);
        status.textContent = `送信エラー(${resp.status}). ページ再読み込みしてください。`;
        return;
      }

      console.log("[GAME] choice resp", data);
      // 以降の進行はポーリング(/game/state)で拾う
    } catch (err) {
      console.error("game/choice failed", err);
      status.textContent = "送信失敗（ネットワーク）。ページ再読み込みしてください。";
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/game/state?channel=${encodeURIComponent(channel)}&playerId=${encodeURIComponent(pid)}`);
        const s = await r.json();
        if (!s.exists) return;

        // 終了
        if (s.over) {
          clearInterval(pollTimer);
          const my = s.myTotal ?? 0;
          status.textContent = `終了！あなたの合計=${my}`;
          setButtonsEnabled(false);

          if (window.Qualtrics && Qualtrics.SurveyEngine) {
            // ラウンドごとの反応時間を保存
            Qualtrics.SurveyEngine.setJSEmbeddedData(
              "pd_rt_json",
              JSON.stringify(rtList)
            );
            // ラウンドごとの感情
            Qualtrics.SurveyEngine.setJSEmbeddedData(
              "pd_emotion_json",
              JSON.stringify(emotionHistory)
            );
            // ラウンドごとの選択
            Qualtrics.SurveyEngine.setJSEmbeddedData(
              "pd_history_json",
              JSON.stringify(history)
            );
          }
          return;
        }

        // 直近の結果が確定していて、そのラウンドが今のラウンドと同じなら表示
        if (s.lastResult && s.lastResult.round === currentRound) {
          const pair = Object.entries(s.lastResult.choices); // [[pid, "C"|"D"], ...]
          const meChoice = s.lastResult.choices[pid];
          const oppEntry = pair.find(([id]) => id !== pid);
          const oppChoice = oppEntry ? oppEntry[1] : "?";
          const myPayoff = s.lastResult.payoffs[pid];
          const myTotal = s.lastResult.totals[pid];

          status.textContent = `Round ${currentRound}/10 結果: あなた=${meChoice}, 相手=${oppChoice} ⇒ 利得 ${myPayoff}（累計 ${myTotal}）`;

          // 履歴に追加してEmbedded Dataにも反映（途中経過も欲しければ）
          history.push({
            round: currentRound,
            me: meChoice,
            opp: oppChoice,
            myPayoff,
            myTotal,
          });
          if (window.Qualtrics && Qualtrics.SurveyEngine) {
            Qualtrics.SurveyEngine.setJSEmbeddedData(
              "pd_total",
              String(myTotal)
            );
            Qualtrics.SurveyEngine.setJSEmbeddedData(
              "pd_history_json",
              JSON.stringify(history)
            );
            console.log("Saving total & history", myTotal, history);
          } else {
            console.warn("Qualtrics not found when saving total/history");
          }

          // このラウンドの感情入力を開始
          if (emoUI && emo1 && emo2 && emo3 && emoNext) {
            waitingEmotion = true;
            emoUI.style.display = "block";

            // デフォルト値をリセット
            emo1.value = "0";
            emo2.value = "0";
            emo3.value = "0";

            // 「次へ」ボタンのクリックハンドラをセット（多重登録を防ぐため一旦解除）
            emoNext.onclick = () => {
              if (!waitingEmotion) return;
              waitingEmotion = false;

              const v1 = Number(emo1.value);
              const v2 = Number(emo2.value);
              const v3 = Number(emo3.value);

              emotionHistory.push({
                round: currentRound,
                emo1: v1,
                emo2: v2,
                emo3: v3,
              });

              if (window.Qualtrics && Qualtrics.SurveyEngine) {
                // ラウンドごとに保存したければ
                Qualtrics.SurveyEngine.setJSEmbeddedData(
                  `pd_emo1_round${currentRound}`,
                  String(v1)
                );
                Qualtrics.SurveyEngine.setJSEmbeddedData(
                  `pd_emo2_round${currentRound}`,
                  String(v2)
                );
                Qualtrics.SurveyEngine.setJSEmbeddedData(
                  `pd_emo3_round${currentRound}`,
                  String(v3)
                );

                // 全ラウンド分をJSONでまとめるなら
                Qualtrics.SurveyEngine.setJSEmbeddedData(
                  "pd_emotion_json",
                  JSON.stringify(emotionHistory)
                );
                console.log("Saving emotion", currentRound, v1, v2, v3, emotionHistory);
              }

              // スライダーパネルを隠す
              emoUI.style.display = "none";

              // サーバー側ですでに pendingRound がセットされていれば、ここで次ラウンド開始
              beginNextRound();
            };
          }

           // 次ラウンドがサーバー側で始まっていたら pendingRound に記録
          if (s.round > currentRound) {
            // サーバーが次ラウンドに進んだことだけ覚えておく
            pendingRound = s.round;

            // 感情スライダー入力待ちでなければ、すぐ次ラウンドを開始
            if (!waitingEmotion) {
              setTimeout(() => {
                beginNextRound();  // 下の方で定義している関数
              }, 600);
            }
          }
        }
      } catch (e) {
        console.error("poll/state failed", e);
      }
    }, 800); // 800ms間隔ポーリング
  }

  function setButtonsEnabled(on) {
    btnC.disabled = !on;
    btnD.disabled = !on;
  }

  function beginNextRound() {
    if (pendingRound == null) return;

    currentRound = pendingRound;
    pendingRound = null;

    status.textContent = `Round ${currentRound}/10: 選択してください`;
    setButtonsEnabled(true);
    canChoose = true;
    roundStartAt = performance.now();
  }
}