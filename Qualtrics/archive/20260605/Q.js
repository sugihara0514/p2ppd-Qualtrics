Qualtrics.SurveyEngine.addOnload(function () {
  var q = this;
  
  window.__PD_GAME_OVER__ = false;
  window.__PD_SURVEY_READY__ = false;
  window.__PD_REMATCHING__ = false;

  var btn = document.getElementById("exit_button");
  if (btn) {
    btn.addEventListener("click", function () {
      var ok = window.confirm(
        "これは緊急離脱用のボタンです。\n緊急離脱するとゲームは中断され、追加報酬も受け取れません。\nよろしいですか？"
      );
      if (!ok) return;

      btn.disabled = true;

      // 1) Qualtricsに離脱フラグ（分岐用）
      try {
        Qualtrics.SurveyEngine.setEmbeddedData("pd_exit", "1");
        Qualtrics.SurveyEngine.setEmbeddedData("pd_exit_reason", "user_exit");
        Qualtrics.SurveyEngine.setEmbeddedData("pd_exit_at", String(Date.now()));
      } catch (e) {}

      // 2) 待機解除 → 3) ゲーム離脱通知 → 4) RTC切断（順に、可能なものだけ）
      var p = Promise.resolve();

      p = p.then(function () {
        try {
          if (window.__PD_CANCEL_MATCH__) return window.__PD_CANCEL_MATCH__();
        } catch (e) {}
      }).then(function () {
        try {
          if (!window.__PD_LEAVE_CALLED__ && typeof window.__PD_LEAVE__ === "function") {
            window.__PD_LEAVE_CALLED__ = true;
            return window.__PD_LEAVE__("user_exit");
          }
        } catch (e) {}
      }).finally(function () {
        // 5) 次へ
        q.showNextButton();
        var nb = document.getElementById("NextButton");
        if (nb) nb.click();
      });
    });
  }

  q.hideNextButton();
  q.hidePreviousButton();

  // マッチング中の見た目
  var container = document.querySelector(".container");
  if (container) container.classList.add("pre_match");

  // ゲーム開始検知（layout_choice が active になったら）
  var startWatch = setInterval(function () {
    var lc = document.getElementById("layout_choice");
    if (lc && lc.classList.contains("is_active")) {
      if (container) container.classList.remove("pre_match");
      clearInterval(startWatch);
    }
  }, 200);

  // 正式終了フラグ監視
  var interval = setInterval(function () {
    if (window.__PD_SURVEY_READY__ === true) {
      clearInterval(interval);

      // 同じQualtrics設問が再ロードされてもゲームを再スタートしないための印
      try {
        var pidForFinish =
          (window.__PD__ && window.__PD__.participantId) ||
          (window.__PD__ && window.__PD__.responseId) ||
          "";
        if (pidForFinish) {
          localStorage.setItem("pd_finished_" + pidForFinish, "1");
        }
      } catch (e) {}

      var leavePromise = Promise.resolve();

      try {
        if (!window.__PD_LEAVE_CALLED__ && typeof window.__PD_LEAVE__ === "function") {
          window.__PD_LEAVE_CALLED__ = true;
          leavePromise = window.__PD_LEAVE__("game_finished");
        }
      } catch (e) {}

      Promise.resolve(leavePromise).finally(function () {
        q.showNextButton();

        // 戻るボタンはゲーム画面へ戻る原因になるので出さない
        q.hidePreviousButton();

        var els = document.querySelectorAll("#NextButton, #Buttons");
        for (var i = 0; i < els.length; i++) {
          els[i].style.setProperty("display", "block", "important");
          els[i].style.setProperty("visibility", "visible", "important");
          els[i].style.setProperty("pointer-events", "auto", "important");
        }

        var prev = document.getElementById("PreviousButton");
        if (prev) {
          prev.style.setProperty("display", "none", "important");
          prev.style.setProperty("visibility", "hidden", "important");
          prev.style.setProperty("pointer-events", "none", "important");
        }
      });
    }
  }, 300);
});


Qualtrics.SurveyEngine.addOnReady(function () {
  var q = this;

  // ResponseID共有
  var rid = "${e://Field/ResponseID}";
  var pid = rid;
  try {
    if (!pid) {
      pid = localStorage.getItem("pd_player_id");
      if (!pid && window.crypto && crypto.randomUUID) {
        pid = crypto.randomUUID();
        localStorage.setItem("pd_player_id", pid);
      }
    }
  } catch (e) {}

  window.__PD__ = {
    responseId: rid,
    participantId: pid || "",
  };

  // すでにゲーム終了済みなら、match.jsを読み込まない
  try {
    var finishedKey = pid ? "pd_finished_" + pid : "";
    if (finishedKey && localStorage.getItem(finishedKey) === "1") {
      window.__PD_DISABLE_AUTO_START__ = true;
  
      q.showNextButton();
      q.hidePreviousButton();
  
      var els = document.querySelectorAll("#NextButton, #Buttons");
      for (var i = 0; i < els.length; i++) {
        els[i].style.setProperty("display", "block", "important");
        els[i].style.setProperty("visibility", "visible", "important");
        els[i].style.setProperty("pointer-events", "auto", "important");
      }
  
      var prev = document.getElementById("PreviousButton");
      if (prev) {
        prev.style.setProperty("display", "none", "important");
        prev.style.setProperty("visibility", "hidden", "important");
        prev.style.setProperty("pointer-events", "none", "important");
      }
  
      return;
    }
  } catch (e) {}

  // Agora App ID
  window.AGORA_APP_ID = "5280cae082864cb9bcd37f818be5ca34";

  // Agora SDK
  var rtc = document.createElement("script");
  rtc.src = "https://download.agora.io/sdk/release/AgoraRTC_N-4.20.0.js";
  rtc.onload = function () {
    // match.js (module)
    var app = document.createElement("script");
    app.type = "module";
    app.src = "https://multimodalpd-static-65p9.onrender.com/match.js";
    document.head.appendChild(app);
  };
  document.head.appendChild(rtc);
});

Qualtrics.SurveyEngine.addOnUnload(function () {
  try {
    // リロード時は「最終離脱」にしない。
    // ここでは soft pause だけ送る。
    if (typeof window.__PD_SOFT_PAUSE__ === "function") {
      window.__PD_SOFT_PAUSE__();
    }
  } catch (e) {}
});
