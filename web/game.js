// game.js
export function startGame(channel) {
  const ui = document.getElementById("gameUI");
  ui.style.display = "block";
  const status = document.getElementById("gameStatus");
  const btnC = document.getElementById("btnC");
  const btnD = document.getElementById("btnD");

  const API_BASE = "https://p2ppd-agora-api.onrender.com"; // APIのURL
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
  }

  let currentRound = 1;
  let canChoose = false;
  let pollTimer = null;
  const history = []; // {round, me, opp, myPayoff, myTotal}

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
            Qualtrics.SurveyEngine.setEmbeddedData(
              "pd_total",
              String(myTotal)
            );
            Qualtrics.SurveyEngine.setEmbeddedData(
              "pd_history_json",
              JSON.stringify(history)
            );
          }

          // 次ラウンドが始まっていればボタンを再有効化
          if (s.round > currentRound) {
            currentRound = s.round;
            setTimeout(() => {
              status.textContent = `Round ${currentRound}/10: 選択してください`;
              setButtonsEnabled(true);
              canChoose = true;
            }, 600);
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
}