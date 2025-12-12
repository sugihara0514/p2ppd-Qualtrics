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
  let lastResultRoundHandled = null;


  //予測スライダー関連 DOM
  const predUI    = document.getElementById("predictUI");
  const predSlider = document.getElementById("predictSlider");
  const predNext   = document.getElementById("predictNext");
  let lastStage = null;
  let predictionDoneRound = null;

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
    // Qualtrics.SurveyEngine.setEmbeddedData("pd_player_id", String(pid));
    Qualtrics.SurveyEngine.setJSEmbeddedData("pd_player_id", String(pid));
  }

  let currentRound = 1;
  let canChoose = false;
  let hasChosenThisRound = false;
  let pollTimer = null;
  const history = []; // {round, me, opp, myPayoff, myTotal}

  // 感情スライダーの履歴: [{ round, emo1, emo2, emo3 }, ...]
  const emotionHistory = [];
  let waitingEmotion = false; // このラウンドの感情入力待ちか

  const predictionHistory = [];   //　追加 [{ round, value }, ...]
  let waitingPrediction = false;  // このラウンドの予測入力待ちか


   // 反応時間用
  let roundStartAt = null;        // そのラウンドが「選択可能になった」時刻
  let pendingRtMs  = null;        // 直近ラウンドのRT（ms）
  const rtList     = [];          // [{ round, rtMs }, ...]

  // ゲーム参加宣言
  fetch(`${API_BASE}/game/join`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ channel, playerId: pid })
  })
  .then(r => r.json())
  .then(init => {
    currentRound = init.round || 1;

    // 最初は「相手の選択予測」フェーズ
    status.textContent = `Round ${currentRound}/10: 相手が何を選ぶか予測してください`;
    setButtonsEnabled(false);
    canChoose = false;

    // 予測スライダーを表示
    showPredictionUI();

    // サーバ状態のポーリング開始
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
    hasChosenThisRound = true;            // このラウンドはもう選択済み

    // 反応時間計測
    if (roundStartAt != null) {
      pendingRtMs = performance.now() - roundStartAt; // ms
      rtList.push({ round: currentRound, rtMs: pendingRtMs });

      // 必要ならラウンドごとに Embedded Data にも保存
      if (window.Qualtrics && Qualtrics.SurveyEngine) {
        // Qualtrics.SurveyEngine.setJSEmbeddedData(
        //   `pd_rt_round${currentRound}`,
        //   String(Math.round(pendingRtMs))
        // );
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

          // if (window.Qualtrics && Qualtrics.SurveyEngine) {
          //   // ラウンドごとの反応時間を保存
          //   Qualtrics.SurveyEngine.setJSEmbeddedData(
          //     "pd_rt_json",
          //     JSON.stringify(rtList)
          //   );
          //   // ラウンドごとの感情
          //   Qualtrics.SurveyEngine.setJSEmbeddedData(
          //     "pd_emotion_json",
          //     JSON.stringify(emotionHistory)
          //   );
          //   // ラウンドごとの選択
          //   Qualtrics.SurveyEngine.setJSEmbeddedData(
          //     "pd_history_json",
          //     JSON.stringify(history)
          //   );
          // }
          return;
        }
        const serverStage = s.stage || "choice";
        const serverRound = s.round || currentRound;

        // ラウンド番号をサーバに合わせる（感情完了後に +1 される）
        if (serverRound !== currentRound) {
          currentRound = serverRound;

          // 新しいラウンドなのでフラグ類をリセット
          hasChosenThisRound      = false;
          lastResultRoundHandled  = null;
          waitingEmotion          = false;
          waitingPrediction       = false;
          predictionDoneRound     = null;
        }

        // ===== フェーズごとのUI制御 =====

        // 1) 予測フェーズ：まだ自分が予測していなければスライダーを出す
        if (serverStage === "predict") {
          if (predictionDoneRound !== currentRound) {
            // まだこのラウンドで自分の予測を送っていない
            if (!waitingPrediction && predUI) {
              status.textContent = `Round ${currentRound}/10: 相手が何を選ぶか予測してください`;
              setButtonsEnabled(false);
              canChoose = false;
              showPredictionUI();  // このタイミングで1回だけ開く
            }
          } else {
            // 自分はもう予測済み → 相手待ち表示に固定
            status.textContent = `Round ${currentRound}/10: 相手の予測が終わるのを待っています…`;
            setButtonsEnabled(false);
            canChoose = false;
          }
        }

        // 2) 選択フェーズ：C/D ボタンを有効化
        if (serverStage === "choice") {
          if (!hasChosenThisRound && !canChoose) {
            status.textContent = `Round ${currentRound}/10: 選択してください`;
            setButtonsEnabled(true);
            canChoose = true;

            roundStartAt = performance.now();
            pendingRtMs = null;
          }
        }

        // 直近の結果が確定していて、そのラウンドが今のラウンドと同じなら表示
        if (
          s.lastResult && 
          s.lastResult.round === currentRound && 
          lastResultRoundHandled !== currentRound
        ) {

          lastResultRoundHandled = currentRound;  // このラウンドはもう処理したマーク

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
            // Qualtrics.SurveyEngine.setJSEmbeddedData(
            //   "pd_total",
            //   String(myTotal)
            // );
            // Qualtrics.SurveyEngine.setJSEmbeddedData(
            //   "pd_history_json",
            //   JSON.stringify(history)
            // );
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
            emoNext.onclick = async () => {
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
                // Qualtrics.SurveyEngine.setJSEmbeddedData(
                //   `pd_emo1_round${currentRound}`,
                //   String(v1)
                // );
                // Qualtrics.SurveyEngine.setJSEmbeddedData(
                //   `pd_emo2_round${currentRound}`,
                //   String(v2)
                // );
                // Qualtrics.SurveyEngine.setJSEmbeddedData(
                //   `pd_emo3_round${currentRound}`,
                //   String(v3)
                // );

                // // 全ラウンド分をJSONでまとめるなら
                // Qualtrics.SurveyEngine.setJSEmbeddedData(
                //   "pd_emotion_json",
                //   JSON.stringify(emotionHistory)
                // );
                console.log("Saving emotion", currentRound, v1, v2, v3, emotionHistory);
              }

              // スライダーパネルを隠す
              emoUI.style.display = "none";

               // サーバに感情データを送信
              try {
                await fetch(`${API_BASE}/game/emotion`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    channel,
                    playerId: pid,
                    round: currentRound,
                    emo1: v1,
                    emo2: v2,
                    emo3: v3,
                  }),
                });
              } catch (e) {
                console.error("game/emotion failed", e);
              }

              // 自分の感情入力は完了。相手待ち。
              status.textContent = `Round ${currentRound}/10: 相手の感情入力が終わるのを待っています…`;
            };
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

  function showPredictionUI() {
    if (!predUI || !predSlider || !predNext) return;

    waitingPrediction = true;
    predUI.style.display = "block";

    // 初期値リセット（必要に応じて）
    predSlider.value = predSlider.defaultValue || "0";

    predNext.onclick = async () => {
      if (!waitingPrediction) return;
      waitingPrediction = false;

      const v = Number(predSlider.value);
      predictionHistory.push({ round: currentRound, value: v });

      predictionDoneRound = currentRound;  // ★このラウンドは予測済み
      predUI.style.display = "none";

      // サーバに予測結果を送る
      try {
        await fetch(`${API_BASE}/game/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            playerId: pid,
            round: currentRound,
            prediction: v,
          }),
        });
      } catch (e) {
        console.error("game/predict failed", e);
      }

      // 自分の予測は完了。相手待ち。
      predUI.style.display = "none";
      status.textContent = `Round ${currentRound}/10: 相手の予測が終わるのを待っています…`;
    };
  }

}