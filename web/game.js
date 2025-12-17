// game.js
export function startGame(channel) {

  const ui = document.querySelector(".container");
  if (ui) ui.style.display = "block";

  const status = document.getElementById("dynamicText");
  // 次へボタン（predictNext/emotionNext/choice確定を全部これに統一）
  const nextButton = document.getElementById("nextButton");

  // 選択関連 DOM
  const btnGreen = document.getElementById("greenButton");
  const btnBlue = document.getElementById("blueButton");
  const choiceUI = document.getElementById("container_choice_button");

  //予測スライダー関連 DOM
  const predUI    = document.getElementById("coop_slider_container_act");
  const predSlider = document.getElementById("coop_Slider");

  // 感情スライダー関連 DOM
  const emoUI = document.getElementById("mental_sliders") || document.querySelector(".vertical-sliders");  
  const emo1    = document.getElementById("stress_Slider");
  const emo2    = document.getElementById("emotionalvalue_Slider");
  const emo3    = document.getElementById("moralburden_Slider");
  const emo4    = document.getElementById("fairness_Slider");
  const emo5    = document.getElementById("trust_Slider");
  const emo6    = document.getElementById("autonomy_Slider");
  const emo7    = document.getElementById("competence_Slider");

  // ラウンド数
  const roundEl = document.getElementById("round_N");

  function renderRound() {
    if (!roundEl) return;
    roundEl.textContent = String(currentRound);
  }

  // ===== UI 表示制御（honnbann 1.html の unvisible/disable/grayout 前提） =====
  const ANIM_MS = 1000; // time_animation と同じ

  function showBase(el) {
    if (!el) return;
    el.classList.remove("unvisible", "disable");
  }

  function hideBase(el) {
    if (!el) return;
    el.classList.add("unvisible", "disable");
  }

  function setGray(el, on) {
    if (!el) return;
    el.classList.toggle("grayout", !!on);// 表示の薄さ
    el.classList.toggle("disable", !!on);// 操作不能
  }

  function moveIn(el) {
    if (!el) return;
    el.classList.remove("out_position");
    el.classList.add("set_position");
  }
  function moveOut(el) {
    if (!el) return;
    el.classList.add("out_position");
    el.classList.remove("set_position");
  }

  // “フェードインして使える状態にする”
  function fadeInEnable(el) {
    if (!el) return;
    el.classList.remove("anim_fadeout");  // フェードアウト残骸を消す
    moveIn(el);                           // 位置を入れる（必要なUIだけ
    showBase(el);                         // 見える+操作可
    el.classList.add("anim_fadein");      // アニメ
    setTimeout(() => el.classList.remove("anim_fadein"), ANIM_MS);
  }

  // “フェードアウトして隠す”
  function fadeOutDisable(el) {
    if (!el) return;
    el.classList.remove("anim_fadein");
    el.classList.add("anim_fadeout");
    setTimeout(() => {
      el.classList.remove("anim_fadeout");
      hideBase(el);
      moveOut(el);
    }, ANIM_MS);
  }

  // 初期状態（予測/選択は非表示 + 操作不可）
  hideBase(choiceUI);
  moveOut(choiceUI);
  hideBase(predUI);
  moveOut(predUI);

  hideBase(nextButton);
  if (nextButton) nextButton.disabled = true;

  // mental_sliders は「常に表示してグレーアウト」で運用
  setGray(emoUI, true);


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
  let predictionDoneRound = null;
  let lastResultRoundHandled = null;
  let lastResultText = "";

  let canChoose = false;
  let hasChosenThisRound = false;
  let pollTimer = null;
  const history = []; // {round, me, opp, myPayoff, myTotal}

  let pendingChoice = null; // "C" or "D"（仮決定）

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
    renderRound();

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

  btnGreen.onclick = () => {
    if (!canChoose) return;
    pendingChoice = "C";
    status.textContent = `Round ${currentRound}/10: 緑（C）を選択中。次へで確定。`;
    updateNextEnabled();
  };

  btnBlue.onclick = () => {
    if (!canChoose) return;
    pendingChoice = "D";
    status.textContent = `Round ${currentRound}/10: 青（D）を選択中。次へで確定。`;
    updateNextEnabled();
  };

  nextButton.onclick = async () => {
    // 予測入力中なら予測確定
    if (waitingPrediction) {
      await submitPrediction();
      return;
    }
    // 感情入力中なら感情確定
    if (waitingEmotion) {
      await submitEmotion();
      return;
    }
    // 選択フェーズなら選択確定
    if (canChoose) {
      await submitChoice();
      return;
    }
  };

  async function submitChoice() {
    if (!canChoose) return;
    if (!pendingChoice) {
      status.textContent = `Round ${currentRound}/10: 緑か青を選んでください。`;
      return;
    }

    const choice = pendingChoice;
    pendingChoice = null;

    canChoose = false;
    setChoiceButtonsEnabled(false);
    hasChosenThisRound = true;

    // 反応時間（確定タイミング基準にするならここが自然）
    if (roundStartAt != null) {
      pendingRtMs = performance.now() - roundStartAt;
      rtList.push({ round: currentRound, rtMs: pendingRtMs });
    }

    status.textContent = `Round ${currentRound}/10: 確定=${choice}。相手の結果待ち…`;

    const body = { channel, playerId: pid, round: currentRound, choice };
    const resp = await fetch(`${API_BASE}/game/choice`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!resp.ok) {
      console.error("choice HTTP error", resp.status, data || text);
      status.textContent = `送信エラー(${resp.status}). ページ再読み込みしてください。`;
      return;
    }

    // 確定したので next は一旦無効（相手待ち）
    updateNextEnabled();
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
          renderRound();

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
            status.textContent = `Round ${currentRound}/10:  緑か青を選び、次へで確定してください`;
            
            // choice表示
            if (predUI) fadeOutDisable(predUI);
            setGray(emoUI, true);
            fadeInEnable(choiceUI);           
             // choice入力中は next を見せる（有効/無効は updateNextEnabled が管理）
            fadeInEnable(nextButton);
            
            canChoose = true;
            pendingChoice = null;
            setChoiceButtonsEnabled(true); // nextは pendingChoice が入るまで無効

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

          // status.textContent = `Round ${currentRound}/10 結果: あなた=${meChoice}, 相手=${oppChoice} ⇒ 利得 ${myPayoff}（累計 ${myTotal}）`;
          lastResultText = `Round ${currentRound}/10 結果: あなた=${meChoice}, 相手=${oppChoice} ⇒ 利得 ${myPayoff}（累計 ${myTotal}）`;

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
          if (emoUI && emo1 && emo2 && emo3 && emo4 && emo5 && emo6 && emo7) {
            waitingEmotion = true;
            
            // 表示切替（結果→心的状態入力）
            if (choiceUI) fadeOutDisable(choiceUI);
            if (predUI)  fadeOutDisable(predUI);
            setGray(emoUI, false);
            // 心的状態入力中は next を見せる（有効/無効は updateNextEnabled が管理）
            fadeInEnable(nextButton);

            // デフォルト値をリセット
            emo1.value = "0";
            emo2.value = "0";
            emo3.value = "0";
            emo4.value = "0";
            emo5.value = "0";
            emo6.value = "0";
            emo7.value = "0";

            status.textContent =
            `${lastResultText}\n` +
            `今の感情（評価）を入力して「次へ」で確定してください。`;            
            updateNextEnabled();
          }
        }
      } catch (e) {
        console.error("poll/state failed", e);
      }
    }, 800); // 800ms間隔ポーリング
  }
  function setButtonsEnabled(on) {
    if (btnGreen) btnGreen.disabled = !on;
    if (btnBlue) btnBlue.disabled = !on;
    if (nextButton) nextButton.disabled = !on;
  }

  function setChoiceButtonsEnabled(on) {
    btnGreen.disabled = !on;
    btnBlue.disabled  = !on;
    updateNextEnabled();
  }

  function updateNextEnabled() {
    // choice中は「仮決定がある時だけ next 有効」
    if (canChoose) {
      nextButton.disabled = !pendingChoice;
      return;
    }
    // predict/emotion中は next 有効、待機中は無効、など運用に合わせて
    if (waitingPrediction || waitingEmotion) {
      nextButton.disabled = false;
      return;
    }
    nextButton.disabled = true; // それ以外（相手待ちなど）
  }

  function showPredictionUI() {
    if (!predUI || !predSlider) return;

    waitingPrediction = true;

    // 表示切替
    if (choiceUI) fadeOutDisable(choiceUI);
    setGray(emoUI, true);
    fadeInEnable(predUI);
    // 予測入力中は next を見せる（有効/無効は updateNextEnabled が管理）
    fadeInEnable(nextButton);

    predSlider.value = predSlider.defaultValue || "0";
    status.textContent = `Round ${currentRound}/10: 相手が何を選ぶか予測してください`;

    updateNextEnabled();
  }

  async function submitPrediction() {
    if (!waitingPrediction) return;
    waitingPrediction = false;

    const v = Number(predSlider.value);
    predictionHistory.push({ round: currentRound, value: v });
    predictionDoneRound = currentRound;

    // 送信
    try {
      await fetch(`${API_BASE}/game/predict`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ channel, playerId: pid, round: currentRound, prediction: v }),
      });
    } catch (e) {
      console.error("game/predict failed", e);
    }

    // 相手待ち表示：予測UIは閉じる / next も隠す
    fadeOutDisable(predUI);
    hideBase(nextButton);
    status.textContent = `Round ${currentRound}/10: 相手の予測が終わるのを待っています…`;
    updateNextEnabled();
  }

  async function submitEmotion() {
    if (!waitingEmotion) return;
    waitingEmotion = false;

    const v1 = Number(emo1.value);
    const v2 = Number(emo2.value);
    const v3 = Number(emo3.value);
    const v4 = Number(emo4.value);
    const v5 = Number(emo5.value);
    const v6 = Number(emo6.value);
    const v7 = Number(emo7.value);

    emotionHistory.push({ round: currentRound, emo1:v1, emo2:v2, emo3:v3, emo4:v4, emo5:v5, emo6:v6, emo7:v7 });

    // UIを閉じる（心的状態は「グレーアウト」にする）
    setGray(emoUI, true);
    hideBase(nextButton);

    // サーバ送信（既存の /game/emotion をそのまま）
    try {
      await fetch(`${API_BASE}/game/emotion`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ channel, playerId: pid, round: currentRound, emo1:v1, emo2:v2, emo3:v3, emo4:v4, emo5:v5, emo6:v6, emo7:v7 }),
      });
    } catch (e) {
      console.error("game/emotion failed", e);
    }

    status.textContent = `Round ${currentRound}/10: 相手の感情入力が終わるのを待っています…`;
    updateNextEnabled();
  }
}