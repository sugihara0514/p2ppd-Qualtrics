// game.js
export function startGame(channel, rtc) {

  const ui = document.querySelector(".container");

   // ゲーム開始後は待機用スタイルを解除
  ui?.classList.remove("pre_match");

  let baselineEmotionDone = false;
  let emotionRoundOverride = null; // 0回目用に round を上書き

  function showBaselineEmotionUI() {
    baselineEmotionDone = false;
    emotionRoundOverride = 0;

    setLayout("emopred");

    moveBlocksTo(layoutEmoPred, [blockScore, blockChat, blockEmo, blockNext]);

    waitingEmotion = true;
    // waitingPrediction = true; // 0回目は感情+予測

    // 表示：感情を開く、予測/選択は閉じる
    if (choiceUI) fadeOutDisable(choiceUI);
    setGray(emoUI, false);

    // if (predUI)  fadeInEnable(predUI);

    fadeInEnable(nextButton);

    // 初期化（既存と同じ）
    emo1.value = "50"; emo2.value = "50"; emo3.value = "50";
    emo4.value = "50"; emo5.value = "50"; emo6.value = "50"; emo7.value = "50";
    emo8.value = "50"; emo9.value = "50"; emo10.value = "50";

    // pred_slider.value = pred_slider.defaultValue || "50";

    setStatus("ゲーム開始前の現在の感情（評価）を入力して「次へ」で確定してください。", { typewriter:true, force:true });
    updateNextEnabled();
  }

  // レイアウト容器
  const layoutEmoPred = document.getElementById("layout_emopred");
  const layoutChoice  = document.getElementById("layout_choice");

  // 固定ブロック
  const blockScore = document.getElementById("block_score");

  // 移動するブロック
  const blockVideo  = document.getElementById("block_video");
  const blockMatrix = document.getElementById("block_matrix");
  const blockChat   = document.getElementById("block_chat");
  const blockEmo    = document.getElementById("block_emo");
  const blockChoice = document.getElementById("block_choice");
  const blockNext   = document.getElementById("block_next");

  function moveBlocksTo(container, blocks) {
    for (const b of blocks) {
      if (!b) continue;
      container.appendChild(b); // 毎回appendして順序を確定
    }
  }

  async function setRemoteAudio(on) {
    try {
      if (rtc && typeof rtc.setRemoteAudioEnabled === "function") {
        await rtc.setRemoteAudioEnabled(!!on);
      }
    } catch (e) {
      console.warn("setRemoteAudioEnabled failed", e);
    }
  }

  function setLayout(mode /* "emopred" | "choice" */) {
    if (!layoutEmoPred || !layoutChoice) return;

    layoutEmoPred.classList.toggle("is_active", mode === "emopred");
    layoutChoice .classList.toggle("is_active", mode === "choice");

    if (mode === "emopred") {
      setRemoteAudio(false); // 感情/予測は相手音声OFF

      // 映像は常にchoice側へ退避
      moveBlocksTo(layoutChoice, [blockVideo]);

      moveBlocksTo(layoutEmoPred, [blockScore, blockMatrix, blockChat, blockEmo, blockNext]);
    } else {
      setRemoteAudio(true); // 選択は相手音声ON

      moveBlocksTo(layoutChoice,  [blockScore, blockVideo, blockMatrix, blockChat, blockChoice, blockNext]);
    }
  }

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
  const emoUI   = document.getElementById("mental_slider_container") || document.querySelector(".vertical-sliders");  
  const emo1    = document.getElementById("emo1_slider");
  const emo2    = document.getElementById("emo2_slider");
  const emo3    = document.getElementById("emo3_slider");
  const emo4    = document.getElementById("emo4_slider");
  const emo5    = document.getElementById("emo5_slider");
  const emo6    = document.getElementById("emo6_slider");
  const emo7    = document.getElementById("emo7_slider");
  const emo8    = document.getElementById("emo8_slider");
  const emo9    = document.getElementById("emo9_slider");
  const emo10   = document.getElementById("emo10_slider");


  // ラウンド数
  const MAX_ROUNDS = 5; // 本番は20
  const round_N = document.getElementById("round_N");

  function renderRound() {
    if (!round_N) return;
    round_N.textContent = String(currentRound);
  }

  // 合計得点表示
  const opp_total_score = document.getElementById("opp_total_score");
  const you_total_score = document.getElementById("you_total_score");

  // カメラマイクミュート
  const micToggleBtn = document.getElementById("mic_button");
  const camToggleBtn = document.getElementById("cam_button");

  function renderMuteUI() {
    if (!rtc) return;
    const { micMuted, camMuted } = rtc.getMuteState();

    if (micToggleBtn) {
      micToggleBtn.setAttribute("aria-pressed", String(micMuted));
      micToggleBtn.textContent = micMuted ? "🎤 Mic OFF" : "🎤 Mic ON";
    }
    if (camToggleBtn) {
      camToggleBtn.setAttribute("aria-pressed", String(camMuted));
      camToggleBtn.textContent = camMuted ? "📷 Cam OFF" : "📷 Cam ON";
    }
  }

  micToggleBtn?.addEventListener("click", async () => {
    if (!rtc) return;
    await rtc.toggleMic();
    renderMuteUI();
  });

  camToggleBtn?.addEventListener("click", async () => {
    if (!rtc) return;
    await rtc.toggleCam();
    renderMuteUI();
  });

  renderMuteUI();

  const CHOICE_LABEL = { C: "緑", D: "青" };
  function choiceLabel(c) {
    return CHOICE_LABEL[c] ?? String(c ?? "");
  }

  // ===== 利得表（4セル）を薄くする制御 =====
  const cellCC = document.getElementById("cell_CC");
  const cellCD = document.getElementById("cell_CD");
  const cellDC = document.getElementById("cell_DC");
  const cellDD = document.getElementById("cell_DD");

  const matrixCells = {
    CC: cellCC,
    CD: cellCD,
    DC: cellDC,
    DD: cellDD,
  };

  function clearMatrixHighlight() {
    Object.values(matrixCells).forEach((el) => {
      if (!el) return;
      el.classList.remove("matrix_dim", "matrix_active");
    });
  }

  // 自分の選択だけ分かっている時：選んだ列(2セル)だけ通常、反対列(2セル)を薄く
  function highlightByYouChoice(youChoice /* "C"|"D" */) {
    clearMatrixHighlight();
    const keys = ["CC", "CD", "DC", "DD"];
    keys.forEach((k) => {
      const el = matrixCells[k];
      if (!el) return;
      const you = k[0]; // 1文字目があなた（C/D）
      if (you === youChoice) el.classList.add("matrix_active");
      else el.classList.add("matrix_dim");
    });
  }

  // 結果が分かった時：該当1セルだけ通常、他3セルを薄く
  function highlightByOutcome(youChoice /* "C"|"D" */, oppChoice /* "C"|"D" */) {
    clearMatrixHighlight();
    const key = `${youChoice}${oppChoice}`; // HTML id は cell_CC 等（あなた,相手）の順 :contentReference[oaicite:4]{index=4}
    Object.entries(matrixCells).forEach(([k, el]) => {
      if (!el) return;
      if (k === key) el.classList.add("matrix_active");
      else el.classList.add("matrix_dim");
    });
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
    pendingChoice = null;
    hideAllRects();
    clearMatrixHighlight();
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

  // フェードの予約を要素ごとに管理
  const __fadeTimers = new WeakMap();fadeInEnable

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

    // 過去のfadeOut予約が残ってたらキャンセル
    const t = __fadeTimers.get(el);
    if (t) {
      clearTimeout(t);
      __fadeTimers.delete(el);
    }

    el.classList.remove("anim_fadeout");  // フェードアウト残骸を消す
    moveIn(el);                           // 位置を入れる（必要なUIだけ
    showBase(el);                         // 見える+操作可
    el.classList.add("anim_fadein");      // アニメ
    setTimeout(() => el.classList.remove("anim_fadein"), ANIM_MS);
  }

  // “フェードアウトして隠す”
  function fadeOutDisable(el) {
    if (!el) return;

    // 同じ要素に予約があれば上書き（多重予約を防ぐ）
    const t = __fadeTimers.get(el);
    if (t) clearTimeout(t);

    el.classList.remove("anim_fadein");
    el.classList.add("anim_fadeout");

    const timer = setTimeout(() => {
      el.classList.remove("anim_fadeout");
      hideBase(el);
      moveOut(el);
      __fadeTimers.delete(el);
    }, ANIM_MS);

    __fadeTimers.set(el, timer);
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

  const API_BASE = "https://multimodalpd.onrender.com"; // APIのURL
  // playerId：QualtricsのResponseIDを優先し、なければlocalStorageのUUID
  let pid =
    (window.__PD__ && window.__PD__.responseId) ||
    localStorage.getItem("pd_player_id");

  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem("pd_player_id", pid);
  }

  let oppId = null; // 相手のID

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
  let emotionForRound = null; // 「感情（＋次回予測）」が対応するラウンド
  let predictionDoneRound = null;
  let lastResultRoundHandled = null;
  let lastResultText = "";
  
  let emotionUIShownForRound = null;

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

  let queuedPrediction = null; // { round: number, value: number }

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

    // 予測に入る前に 0回目感情
    showBaselineEmotionUI()

    // // 予測スライダーを表示
    // showPredictionUI();

    // // サーバ状態のポーリング開始
    // startPolling();
  }).catch(err => {
    console.error("game/join failed", err);
    setStatus("ゲーム初期化に失敗しました", { typewriter:false, force:true });
  });

  green_button.onclick = () => {
    if (!canChoose) return;
    pendingChoice = "C";
    showYouRect("C");
    highlightByYouChoice("C");
    setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 緑を選択中。次へで確定。`, { typewriter:true });
    updateNextEnabled();
  };

  blue_button.onclick = () => {
    if (!canChoose) return;
    pendingChoice = "D";
    showYouRect("D");
    highlightByYouChoice("D");
    setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 青を選択中。次へで確定。`, { typewriter:true });
    updateNextEnabled();
  };

  nextButton.onclick = async () => {
    if (tw.typing) { 
      finishTyping(); 
    }

    // // 感情+予測を同時確定
    // if (waitingEmotion && waitingPrediction) {
    //   await submitEmotionAndQueuePrediction();
    //   return;
    // }

    // // 予測入力中なら予測確定
    // if (waitingPrediction) {
    //   await submitPrediction();
    //   return;
    // }
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

    // 確定後は固定表示（実質何もしないでOKだが、念のため整形）
    if (lockedYouRect) {
      showYouRect(lockedYouRect);
      return;
    }

    // クリックで選択中なら、その選択（C/D）を表示し直す
    if (pendingChoice) {
      showYouRect(pendingChoice);
      return;
    }

    // 何も選んでいないなら消す
    hideEl(rect_you_green);
  });

  blue_button?.addEventListener("mouseenter", () => {
    if (!canChoose) return;
    if (lockedYouRect) return;
    showYouRect("D");
  });
  blue_button?.addEventListener("mouseleave", () => {
    if (!canChoose) return;

    // 確定後は固定表示（実質何もしないでOKだが、念のため整形）
    if (lockedYouRect) {
      showYouRect(lockedYouRect);
      return;
    }

    // クリックで選択中なら、その選択（C/D）を表示し直す
    if (pendingChoice) {
      showYouRect(pendingChoice);
      return;
    }

    // 何も選んでいないなら消す
    hideEl(rect_you_blue);
  });


  async function submitChoice() {
    if (!canChoose) return;
    if (!pendingChoice) {
      setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 緑か青を選んでください。`, { typewriter:false, force:true });
      return;
    }

    const choice = pendingChoice;

    // 自分の枠を確定・固定表示
    lockedYouRect = choice;
    showYouRect(choice);

    pendingChoice = null;

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

    setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 確定=${choiceLabel(choice)}。相手の結果待ち…`, { typewriter:false, force:true });
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
            
          setStatus(`ゲーム終了！あなたの合計=${finalTotal}。お疲れさまでした。「→」ボタンで次へ進んでください。`, { typewriter:false, force:true });
          lastResultRoundHandled = s.lastResult?.round ?? lastResultRoundHandled; // このラウンドはもう処理したマーク
          setButtonsEnabled(false);

          window.__PD_GAME_OVER__ = true;

          // ゲーム終了時に録画停止 + チャンネル離脱（match.jsの__PD_LEAVE__を呼ぶ）
          try {
            if (!window.__PD_LEAVE_CALLED__ && typeof window.__PD_LEAVE__ === "function") {
              window.__PD_LEAVE_CALLED__ = true; // 二重呼び出し防止
              window.__PD_LEAVE__();             // match.js内で rtc.leave → record/stop の順に実行される
            }
          } catch (e) {
            console.warn("leave on game over failed", e);
          }

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
          // lastResultRoundHandled  = null;
          waitingEmotion          = false;
          waitingPrediction       = false;
          predictionDoneRound     = null;
          roundStartAt = null;
          pendingRtMs = null;

          emotionUIShownForRound = null;

          canChoose = false;
          pendingChoice = null;
          hideBase(choiceUI);   // 表示状態も初期化しておくと安全
          moveOut(choiceUI);

          resetRectsForNewRound(); // 枠リセットhideAllRects
        }

        // ===== フェーズごとのUI制御 =====
        // 0) 準備フェーズ
        if (serverStage === "waiting") {
          setLayout("emopred");          // baseline画面のまま
          canChoose = false;
          setChoiceButtonsEnabled(false);
          if (choiceUI) fadeOutDisable(choiceUI);
          setGray(emoUI, true);
          hideBase(nextButton);

          setStatus("相手の準備が終わるのを待っています…", { typewriter:false });
          return;
        }

        // 1) 予測フェーズ（現在廃止）
        // if (serverStage === "predict") {
        //   setLayout("emopred");
        //   canChoose = false;
        //   setButtonsEnabled(false);

        //   // 既に送っているなら待機表示だけ
        //   if (predictionDoneRound === currentRound) {
        //     setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 相手の予測が終わるのを待っています…`, {
        //       typewriter:false
        //     });
        //     return;
        //   }

        //   // キューがあれば自動送信（UIは出さない）
        //   if (queuedPrediction && queuedPrediction.round === currentRound) {            
        //     const v = queuedPrediction.value;

        //     try {
        //       const resp = await fetch(`${API_BASE}/game/predict`, {
        //         method: "POST",
        //         headers: { "Content-Type":"application/json" },
        //         body: JSON.stringify({ channel, playerId: pid, round: currentRound, prediction: v }),
        //       });

        //       if (!resp.ok) {
        //         const t = await resp.text();
        //         console.error("game/predict HTTP error", resp.status, t);
        //         // 失敗したらキューを残して次回pollで再送
        //         setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 予測送信に失敗。再送します…`, { typewriter:false, force:true });
        //         return;
        //       }

        //       // 成功したら初めて確定
        //       predictionHistory.push({ round: currentRound, value: v });
        //       qSetRound(currentRound, { prediction: v });
        //       predictionDoneRound = currentRound;
        //       queuedPrediction = null;

        //       // 待機表示
        //       if (predUI) fadeOutDisable(predUI);
        //       hideBase(nextButton);
        //       setGray(emoUI, true);

        //       setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 相手の予測が終わるのを待っています…`, { typewriter:false, force:true });
        //       updateNextEnabled();
        //       return;
        //     } catch (e) {
        //       console.error("game/predict failed", e);
        //       setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 予測送信に失敗。再送します…`, { typewriter:false, force:true });
        //       return;
        //     }
        //   }

          
        //   setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 予測データが見つかりません（直前の感情+予測が未確定の可能性）。`, {
        //     typewriter:false,
        //     force:true
        //   });
        //   return;
        // }

        // 2) 選択フェーズ：C/D ボタンを有効化
        if (serverStage === "choice") {
          setLayout("choice");


          if (!hasChosenThisRound && !canChoose) {
            setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 緑か青を選び、次へで確定してください`, {
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
          return;
        }

        // 3) emotion（サーバの stage を尊重してここでだけ lastResult/感情入力）
        if (serverStage === "emotion") {
          if (s.lastResult && lastResultRoundHandled !== s.lastResult.round) {

            const resultRound = s.lastResult.round;

            // 既にこのラウンドの感情UIを開いているなら何もしない（無限初期化防止）
            if (emotionUIShownForRound === resultRound) return;
            emotionUIShownForRound = resultRound;

            const pair = Object.entries(s.lastResult.choices); // [[pid, "C"|"D"], ...]
            const youChoice = s.lastResult.choices[pid];

            const oppEntry = pair.find(([id]) => id !== pid);
            const oppIdNow = oppEntry ? oppEntry[0] : null;
            const oppChoice = oppEntry ? oppEntry[1] : "?";

            if (oppIdNow && !oppId) {
              oppId = oppIdNow;
              qSet("pd_opp_id", String(oppId));  // Qualtricsに保存
            }

            const youPayoff = s.lastResult.payoffs[pid];
            const youTotal = s.lastResult.totals[pid];
            const oppTotal = (oppIdNow && s.lastResult.totals) ? s.lastResult.totals[oppIdNow] : 0;  // 相手の合計

            if (you_total_score) you_total_score.textContent = String(youTotal ?? 0);
            if (opp_total_score) opp_total_score.textContent = String(oppTotal ?? 0);

            // 相手の枠を表示（確定後）
            showOppRect(oppChoice);

            // 追加：結果セル以外を薄く
            if ((youChoice === "C" || youChoice === "D") && (oppChoice === "C" || oppChoice === "D")) {
              highlightByOutcome(youChoice, oppChoice);
            }

            // status.textContent = `Round ${currentRound}/${MAX_ROUNDS} 結果: あなた=${youChoice}, 相手=${oppChoice} ⇒ 利得 ${youPayoff}（累計 ${youTotal}）`;
            lastResultText = `Round ${resultRound}/${MAX_ROUNDS} 結果: あなた=${choiceLabel(youChoice)}, 相手=${choiceLabel(oppChoice)} ⇒ 利得 ${youPayoff}（累計 ${youTotal}）`;

            // 履歴に追加してEmbedded Dataにも反映（途中経過も欲しければ）
            history.push({
              round: resultRound,
              you: youChoice,
              opp: oppChoice,
              youPayoff,
              youTotal,
            });

            qSet("pd_total", String(youTotal));
            // qSet("pd_history_json", history);

            // 個別保存（結果系）
            qSetRound(resultRound, {
              youChoice,
              oppChoice,
              youPayoff,
              youTotal,
            });

            // このラウンドの感情入力を開始
            if (emoUI && emo1 && emo2 && emo3 && emo4 && emo5 && emo6 && emo7 && emo8 && emo9 && emo10) {
              setLayout("emopred");
            
              emotionForRound = resultRound;

              waitingEmotion    = true;
              waitingPrediction = false;

              if (choiceUI) fadeOutDisable(choiceUI);
              canChoose = false;

              setGray(emoUI, false);

              // 予測UIは使わない
              if (predUI) fadeOutDisable(predUI);

              fadeInEnable(nextButton);

              // デフォルト値をリセット
              emo1.value = "50";
              emo2.value = "50";
              emo3.value = "50";
              emo4.value = "50";
              emo5.value = "50";
              emo6.value = "50";
              emo7.value = "50";
              emo8.value = "50";
              emo9.value = "50";
              emo10.value = "50";

              setStatus(`${lastResultText}\n今の感情を入力して「次へ」で確定してください。`, { typewriter:true, force:true });
              updateNextEnabled();
            }
          }
          return;
        }

        // 直近の結果が確定していて、そのラウンドが今のラウンドと同じなら表示
        
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
    setLayout("emopred");
    if (!predUI || !pred_slider) return;

    waitingPrediction = true;

    // 表示切替
    if (choiceUI) fadeOutDisable(choiceUI);
    setGray(emoUI, true);
    fadeInEnable(predUI);
    // 予測入力中は next を見せる（有効/無効は updateNextEnabled が管理）
    fadeInEnable(nextButton);

    pred_slider.value = pred_slider.defaultValue || "0";
    setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 相手が何を選ぶか予測してください`, { typewriter:true, force:true });
    updateNextEnabled();
  }

  // 予測フェーズ用（現在廃止）
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
    setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 相手の予測が終わるのを待っています…`, { typewriter:false, force:true });
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
    const v8 = Number(emo8.value);    
    const v9 = Number(emo9.value);
    const v10 = Number(emo10.value);


    // round の確定（0回目なら 0）
    const baseRound =
      (emotionRoundOverride != null) ? emotionRoundOverride :
      (emotionForRound != null) ? emotionForRound :
      currentRound;

    emotionHistory.push({ round: baseRound, emo1:v1, emo2:v2, emo3:v3, emo4:v4, emo5:v5, emo6:v6, emo7:v7, emo8:v8, emo9:v9, emo10:v10 });
    qSetRound(baseRound, { emo1:v1, emo2:v2, emo3:v3, emo4:v4, emo5:v5, emo6:v6, emo7:v7, emo8:v8, emo9:v9, emo10:v10, emotionAt: Date.now() });

    setGray(emoUI, true);
    hideBase(nextButton);

    // 0回目はサーバに送らない（サーバ側が round0 を想定してないなら）
    if (baseRound === 0) {
      emotionRoundOverride = null;
      baselineEmotionDone = true;

      // ★追加：baseline完了をサーバに通知（相手待ち制御用）
      try {
        await fetch(`${API_BASE}/game/ready`, {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ channel, playerId: pid }),
        });
      } catch (e) {
        console.error("game/ready failed", e);
      }

      // ここで通常フロー開始
      // showPredictionUI();
      startPolling();
      setStatus("相手の準備が終わるのを待っています…", { typewriter:false, force:true });
      return;
    }

    // サーバ送信（既存の /game/emotion をそのまま）
    try {
      await fetch(`${API_BASE}/game/emotion`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ channel, playerId: pid, round: currentRound, emo1:v1, emo2:v2, emo3:v3, emo4:v4, emo5:v5, emo6:v6, emo7:v7, emo8:v8, emo9:v9, emo10:v10 }),
      });
    } catch (e) {
      console.error("game/emotion failed", e);
    }

    setStatus(`Round ${currentRound}/${MAX_ROUNDS}: 相手の感情入力が終わるのを待っています…`, { typewriter:false, force:true });
    updateNextEnabled();
  }

  async function submitEmotionAndQueuePrediction() {

    if (!waitingEmotion) return;

    // まず状態を閉じる
    waitingEmotion = false;
    waitingPrediction = false;

    const v1 = Number(emo1.value);
    const v2 = Number(emo2.value);
    const v3 = Number(emo3.value);
    const v4 = Number(emo4.value);
    const v5 = Number(emo5.value);
    const v6 = Number(emo6.value);
    const v7 = Number(emo7.value);

    // 感情の保存ラウンド（0回目対応）
    // 0回目(override) > emotionForRound(結果ラウンド) > currentRound(フォールバック)
    const baseRound =
      (emotionRoundOverride != null) ? emotionRoundOverride :
      (emotionForRound != null) ? emotionForRound :
      currentRound;

    try {
      emotionHistory.push({ round: baseRound, emo1: v1, emo2: v2, emo3: v3, emo4: v4, emo5: v5, emo6: v6, emo7: v7 });
    } catch (_) {}

    qSetRound(baseRound, {
      emo1: v1, emo2: v2, emo3: v3, emo4: v4, emo5: v5, emo6: v6, emo7: v7,
      emotionAt: Date.now(),
    });

    // UIをいったん閉じる
    setGray(emoUI, true);
    if (predUI) fadeOutDisable(predUI);
    hideBase(nextButton);

    // 0回目はサーバ送信しない（現方針のまま）
    if (baseRound === 0) {
      emotionRoundOverride = null;
      baselineEmotionDone = true;

      // 予測は「Round1用」としてキュー
      const pv = Number(pred_slider.value);
      const targetRound = 1;

      queuedPrediction = { round: targetRound, value: pv };
      qSetRound(targetRound, { prediction: pv });

      // ポーリング開始（予測UIはもう出さない）
      startPolling();
      setStatus("開始を待っています…", { typewriter:false, force:true });
      updateNextEnabled();
      return;
    }

    // 通常ラウンドの感情はサーバ送信
    try {
      const resp = await fetch(`${API_BASE}/game/emotion`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ channel, playerId: pid, round: baseRound, emo1:v1, emo2:v2, emo3:v3, emo4:v4, emo5:v5, emo6:v6, emo7:v7 }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.error("game/emotion HTTP error", resp.status, t);
      }
    } catch (e) {
      console.error("game/emotion failed", e);
    }

    // 最後の投資（MAX_ROUNDS）は予測なし：キューしない
    if (baseRound < MAX_ROUNDS) {
      const pv = Number(pred_slider.value);
      const targetRound = baseRound + 1;

      queuedPrediction = { round: targetRound, value: pv };
      qSetRound(targetRound, { prediction: pv });
    } else {
      queuedPrediction = null;
    }

    setStatus(`Round ${baseRound}/${MAX_ROUNDS}: 次のラウンド開始を待っています…`, { typewriter:false, force:true });
    updateNextEnabled();
  }

}