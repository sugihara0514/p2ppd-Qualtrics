// game.js
export function startGame(channel) {

  const ui = document.querySelector(".container");
  if (ui) ui.style.display = "block";

  const status = document.getElementById("dynamicText");
  // 次へボタン
  const nextButton = document.getElementById("next_button");

  // 選択関連 DOM
  const green_button = document.getElementById("green_button");
  const blue_button = document.getElementById("blue_button");
  const choiceUI = document.getElementById("choice_button_container");

  //予測スライダー関連 DOM
  const predUI = document.getElementById("pred_slider_container");
  const pred_slider = document.getElementById("pred_slider");

  // 感情スライダー関連 DOM
  const emoUI = document.getElementById("mental_slider_container") || document.querySelector(".vertical-sliders");  
  const emo1    = document.getElementById("stress_slider");
  const emo2    = document.getElementById("emotionalvalue_slider");
  const emo3    = document.getElementById("moralburden_slider");
  const emo4    = document.getElementById("fairness_slider");
  const emo5    = document.getElementById("trust_slider");
  const emo6    = document.getElementById("autonomy_slider");
  const emo7    = document.getElementById("competence_slider");

  // ラウンド数
  const round_N = document.getElementById("round_N");

  // 合計得点表示
  const opp_total_score = document.getElementById("opp_total_score");
  const you_total_score = document.getElementById("you_total_score");

  function renderRound() {
    if (!round_N) return;
    round_N.textContent = String(currentRound);
  }

  // ===== 利得表の矩形枠 =====
  const rect_you_blue  = document.getElementById("rectangle_you_blue");
  const rect_you_green = document.getElementById("rectangle_you_green");
  const rect_opp_green = document.getElementById("rectangle_opp_green");
  const rect_opp_blue  = document.getElementById("rectangle_opp_blue");

  // 自分の枠を「確定して固定」しているか
  let lockedYouRect = null; // "C" or "D" or null

  function showEl(el) { if (el) el.classList.remove("unvisible"); }
  function hideEl(el) { if (el) el.classList.add("unvisible"); }

  function hideAllRects() {
    hideEl(rect_you_blue);
    hideEl(rect_you_green);
    hideEl(rect_opp_green);
    hideEl(rect_opp_blue);
  }

  function showYouRect(choice) {
    // choice: "C"(緑) or "D"(青)
    hideEl(rect_you_blue);
    hideEl(rect_you_green);
    if (choice === "C") showEl(rect_you_green);
    if (choice === "D") showEl(rect_you_blue);
  }

  function showOppRect(choice) {
    hideEl(rect_opp_green);
    hideEl(rect_opp_blue);
    if (choice === "C") showEl(rect_opp_green);
    if (choice === "D") showEl(rect_opp_blue);
  }

  function resetRectsForNewRound() {
    lockedYouRect = null;
    hideAllRects();
  }


  // ===== Typewriter（テキストを少しずつ流す）=====
  const TEXT_ADD_SPEED = 30; // 1文字あたり(ms) 好みで調整

  const tw = {
    timer: null,
    target: "",
    current: "",
    typing: false,
    lastRequested: null,
  };

  function setStatus(text, opts = {}) {
    if (!status) return;

    const {
      typewriter = true,
      speed = TEXT_ADD_SPEED,
      lockNextWhileTyping = false,
      force = false,
    } = opts;

    // ポーリングで同じ文を何度も流さないためのガード
    if (!force && tw.lastRequested === text) return;
    tw.lastRequested = text;

    // 前のタイプ中を停止
    if (tw.timer) {
      clearInterval(tw.timer);
      tw.timer = null;
    }
    tw.target = String(text);

    // すぐ出すモード
    if (!typewriter) {
      tw.typing = false;
      status.textContent = tw.target;
      // typing が終わった扱いなので next 状態を戻す
      updateNextEnabled?.();
      return;
    }

    // タイプ開始
    tw.typing = true;
    tw.current = "";
    status.textContent = "";

    if (lockNextWhileTyping && nextButton) nextButton.disabled = true;

    tw.timer = setInterval(() => {
      if (tw.current.length < tw.target.length) {
        tw.current += tw.target[tw.current.length];
        status.textContent = tw.current;
      } else {
        clearInterval(tw.timer);
        tw.timer = null;
        tw.typing = false;
        updateNextEnabled?.();
      }
    }, speed);
  }

  function finishTyping() {
    if (!tw.typing) return;
    if (tw.timer) clearInterval(tw.timer);
    tw.timer = null;
    tw.typing = false;
    status.textContent = tw.target;
    updateNextEnabled?.();
  }

  // 任意：テキスト部分をクリックで全文表示
  status?.addEventListener("click", finishTyping);


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

  // Qualtrics側に保存
  function qSet(key, val) {
    try {
      if (!(window.Qualtrics && Qualtrics.SurveyEngine)) return false;
      const se = Qualtrics.SurveyEngine;
      const v = (typeof val === "string") ? val : JSON.stringify(val);
      if (typeof se.setJSEmbeddedData === "function") {
        se.setJSEmbeddedData(key, v);
        return true;
      }
      if (typeof se.setEmbeddedData === "function") {
        se.setEmbeddedData(key, v);
        return true;
      }
    } catch (e) {
      console.warn("qSet failed", key, e);
    }
    return false;
  }

  // round付きで Embedded Data をまとめて保存
  function qSetRound(round, obj, prefix = "pd") {
    if (!obj) return;
    const r = String(round);
    for (const [k, v] of Object.entries(obj)) {
      qSet(`${prefix}_r${r}_${k}`, v);
    }
  }

  if (window.Qualtrics && Qualtrics.SurveyEngine) {
    qSet("pd_player_id", String(pid));
  }

  let currentRound = 1;
  let predictionDoneRound = null;
  let lastResultRoundHandled = null;
  let lastResultText = "";

  let canChoose = false;
  let hasChosenThisRound = false;
  let pollTimer = null;
  const history = []; // {round, me, opp, youPayoff, youTotal}

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
    setButtonsEnabled(false);
    canChoose = false;

    // 予測スライダーを表示
    showPredictionUI();

    // サーバ状態のポーリング開始
    startPolling();
  }).catch(err => {
    console.error("game/join failed", err);
    setStatus("ゲーム初期化に失敗しました", { typewriter:false, force:true });
  });

  green_button.onclick = () => {
    if (!canChoose) return;
    pendingChoice = "C";
    setStatus(`Round ${currentRound}/10: 緑（C）を選択中。次へで確定。`, { typewriter:true });
    updateNextEnabled();
  };

  blue_button.onclick = () => {
    if (!canChoose) return;
    pendingChoice = "D";
    setStatus(`Round ${currentRound}/10: 青（D）を選択中。次へで確定。`, { typewriter:true });
    updateNextEnabled();
  };

  nextButton.onclick = async () => {
    if (tw.typing) { 
      finishTyping(); 
    }
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

  // ホバー中だけ表示（未確定時）
  green_button?.addEventListener("mouseenter", () => {
    if (!canChoose) return;
    if (lockedYouRect) return;        // 確定後は固定表示なのでホバー無視
    showYouRect("C");
  });
  green_button?.addEventListener("mouseleave", () => {
    if (!canChoose) return;
    if (lockedYouRect) return;
    // 未確定なら消す（pendingChoice を残しているなら「選択中は残す」でもOK）
    hideEl(rect_you_green);
  });

  blue_button?.addEventListener("mouseenter", () => {
    if (!canChoose) return;
    if (lockedYouRect) return;
    showYouRect("D");
  });
  blue_button?.addEventListener("mouseleave", () => {
    if (!canChoose) return;
    if (lockedYouRect) return;
    hideEl(rect_you_blue);
  });


  async function submitChoice() {
    if (!canChoose) return;
    if (!pendingChoice) {
      setStatus(`Round ${currentRound}/10: 緑か青を選んでください。`, { typewriter:false, force:true });
      return;
    }

    const choice = pendingChoice;
    pendingChoice = null;

     // 自分の枠を確定・固定表示
    lockedYouRect = choice;
    showYouRect(choice);

    canChoose = false;
    setChoiceButtonsEnabled(false);
    hasChosenThisRound = true;

    // 反応時間
    if (roundStartAt != null) {
      pendingRtMs = performance.now() - roundStartAt;
      rtList.push({ round: currentRound, rtMs: pendingRtMs });
      // qSet("pd_decision_rt_json", rtList);  // 各ラウンドで都度保存
      qSetRound(currentRound, { rtMs: pendingRtMs });
      roundStartAt = null;
    }

    setStatus(`Round ${currentRound}/10: 確定=${choice}。相手の結果待ち…`, { typewriter:false, force:true });
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
      setStatus(`送信エラー(${resp.status}). ページ再読み込みしてください。`, { typewriter:false, force:true });
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
          // 最終ラウンドの結果が入っていればそれを採用
          const finalTotal =
            s.lastResult?.totals?.[pid] ??
            history[history.length - 1]?.youTotal ??
            0;
            
          setStatus(`終了！あなたの合計=${finalTotal}`, { typewriter:false, force:true });
          setButtonsEnabled(false);

          // qSet("pd_prediction_json", predictionHistory);
          // qSet("pd_emotion_json", emotionHistory);
          // qSet("pd_history_json", history);

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
          roundStartAt = null;
          pendingRtMs = null;

          resetRectsForNewRound(); // 枠リセット
        }

        // ===== フェーズごとのUI制御 =====

        // 1) 予測フェーズ：まだ自分が予測していなければスライダーを出す
        if (serverStage === "predict") {
          if (predictionDoneRound !== currentRound) {
            // まだこのラウンドで自分の予測を送っていない
            if (!waitingPrediction && predUI) {
              // setStatus(`Round ${currentRound}/10: 相手が何を選ぶか予測してください`, {
              //   typewriter: true,
              //   speed: TEXT_ADD_SPEED,
              //   lockNextWhileTyping: false, // 必要なら true
              // });
              setButtonsEnabled(false);
              canChoose = false;
              showPredictionUI();  // このタイミングで1回だけ開く
            }
          } else {
            // 自分はもう予測済み → 相手待ち表示に固定
            setStatus(`Round ${currentRound}/10: 相手の予測が終わるのを待っています…`, {
              typewriter: false
            });
            setButtonsEnabled(false);
            canChoose = false;
          }
        }

        // 2) 選択フェーズ：C/D ボタンを有効化
        if (serverStage === "choice") {
          if (!hasChosenThisRound && !canChoose) {
            setStatus(`Round ${currentRound}/10: 緑か青を選び、次へで確定してください`, {
              typewriter: true,
              force: true
            });
            
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
          const youChoice = s.lastResult.choices[pid];

          const oppEntry = pair.find(([id]) => id !== pid);
          const oppId = oppEntry ? oppEntry[0] : null;
          const oppChoice = oppEntry ? oppEntry[1] : "?";

          const youPayoff = s.lastResult.payoffs[pid];
          const youTotal = s.lastResult.totals[pid];
          const oppTotal = (oppId && s.lastResult.totals) ? s.lastResult.totals[oppId] : 0;  // 相手の合計

          if (you_total_score) you_total_score.textContent = String(youTotal ?? 0);
          if (opp_total_score) opp_total_score.textContent = String(oppTotal ?? 0);

          // 相手の枠を表示（確定後）
          showOppRect(oppChoice);

          // status.textContent = `Round ${currentRound}/10 結果: あなた=${youChoice}, 相手=${oppChoice} ⇒ 利得 ${youPayoff}（累計 ${youTotal}）`;
          lastResultText = `Round ${currentRound}/10 結果: あなた=${youChoice}, 相手=${oppChoice} ⇒ 利得 ${youPayoff}（累計 ${youTotal}）`;

          // 履歴に追加してEmbedded Dataにも反映（途中経過も欲しければ）
          history.push({
            round: currentRound,
            you: youChoice,
            opp: oppChoice,
            youPayoff,
            youTotal,
          });

          qSet("pd_total", String(youTotal));
          // qSet("pd_history_json", history);

          // 個別保存（結果系）
          qSetRound(currentRound, {
            youChoice,
            oppChoice,
            youPayoff,
            youTotal,
          });

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

            setStatus(
              `${lastResultText}\n今の感情（評価）を入力して「次へ」で確定してください。`,
              { typewriter:true, force:true }
            );          
            updateNextEnabled();
          }
        }
      } catch (e) {
        console.error("poll/state failed", e);
      }
    }, 800); // 800ms間隔ポーリング
  }
  function setButtonsEnabled(on) {
    if (green_button) green_button.disabled = !on;
    if (blue_button) blue_button.disabled = !on;
    if (nextButton) nextButton.disabled = !on;
  }

  function setChoiceButtonsEnabled(on) {
    if (green_button) green_button.disabled = !on;
    if (blue_button) blue_button.disabled = !on;
    updateNextEnabled();
  }

  function updateNextEnabled() {
    // choice中は「仮決定がある時だけ next 有効」
    if (!nextButton) return;

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
    if (!predUI || !pred_slider) return;

    waitingPrediction = true;

    // 表示切替
    if (choiceUI) fadeOutDisable(choiceUI);
    setGray(emoUI, true);
    fadeInEnable(predUI);
    // 予測入力中は next を見せる（有効/無効は updateNextEnabled が管理）
    fadeInEnable(nextButton);

    pred_slider.value = pred_slider.defaultValue || "0";
    setStatus(`Round ${currentRound}/10: 相手が何を選ぶか予測してください`, { typewriter:true, force:true });
    updateNextEnabled();
  }

  async function submitPrediction() {
    if (!waitingPrediction) return;
    waitingPrediction = false;

    const v = Number(pred_slider.value);
    predictionHistory.push({ round: currentRound, value: v });
    // qSet("pd_prediction_json", predictionHistory);
    // 個別保存（ラウンド別）
    qSetRound(currentRound, { prediction: v });
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
    setStatus(`Round ${currentRound}/10: 相手の予測が終わるのを待っています…`, { typewriter:false, force:true });
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
    // qSet("pd_emotion_json", emotionHistory);

     // 個別保存（ラウンド別・感情）
    qSetRound(currentRound, {
      emo1: v1,
      emo2: v2,
      emo3: v3,
      emo4: v4,
      emo5: v5,
      emo6: v6,
      emo7: v7,
      emotionAt: Date.now(), // 任意
    });

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

    setStatus(`Round ${currentRound}/10: 相手の感情入力が終わるのを待っています…`, { typewriter:false, force:true });
    updateNextEnabled();
  }
}